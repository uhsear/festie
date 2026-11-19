#!/usr/bin/env bash
set -euo pipefail
# =============================================================================
# backup-offsite-git.sh
#
# Off-site, encrypted, version-controlled DB backups for Festie prod.
#
# WHAT IT DOES
#   1. Finds the NEWEST fp_*.dump in $BACKUP_DIR (default ~/backups/festie),
#      ignoring *_weekly.dump copies. Fails (exit 1) when it is older than 26 h
#      (2 h while ~/.festie-festival-mode exists) or fails pg_restore --list;
#      a corrupt dump is renamed *.dump.bad.
#   2. Encrypts it with GPG symmetric AES256 using $BACKUP_GPG_PASSPHRASE
#      (read from ../.env). The passphrase NEVER leaves the server.
#   3. Pushes the encrypted blob to a PRIVATE GitHub repo ($BACKUP_GIT_REPO)
#      over SSH using a dedicated, write-only deploy key. The repo is the
#      off-site store -- no third-party cloud account required.
#      The dump's .counts row-count sidecar is pushed next to it (counts and
#      timestamps only, no PII).
#   4. Prunes the repo by scripts/lib/backup-retention.cjs: every dump from the
#      last 48 h, the newest per day for 30 days, the newest per ISO week for
#      12 weeks. Older ones are git-removed and committed.
#   5. Takes the shared $BACKUP_DIR/.backup.lock (same as backup-pg.sh). Waits
#      BACKUP_LOCK_WAIT seconds (default 120; 0 = do not wait), then exits 75.
#
# This is a SUPPLEMENT to the on-host 6-hourly pg backups (backup-pg.sh). This git path is the working off-site copy.
#
# CONFIG (in ../.env):
#   BACKUP_GPG_PASSPHRASE   strong random passphrase (generated, stored once)
#   (BACKUP_DIR comes from the environment only, default $HOME/backups/festie,
#   the same as backup-pg.sh; a value in .env is ignored.)
#
# FAILURE ALERT: on any non-zero exit, if ~/.config/festie-ntfy-topic exists and
# is non-empty, a short message is POSTed to https://ntfy.sh/<topic>. The topic
# is never logged or echoed.
#
# Deploy key:  $BACKUP_DEPLOY_KEY (default ~/.ssh/festie_backups_deploy; ed25519, no passphrase)
# Local clone: $BACKUP_GIT_CLONE   (default ~/festie-backups-git; shallow)
# Repo:        $BACKUP_GIT_REPO    (required, set in ../.env or the environment)
#
# -----------------------------------------------------------------------------
# RESTORE PROCEDURE
# -----------------------------------------------------------------------------
#   On any trusted machine with git, gpg and Postgres client tools:
#
#   1. Clone the private backups repo (needs read access to it):
#        git clone <the BACKUP_GIT_REPO address>
#        cd <cloned repo>/dumps
#
#   2. Pick the dump you want (filenames carry the original timestamp), then
#      decrypt it. You will be prompted for BACKUP_GPG_PASSPHRASE
#      (stored in prod's festival-planner/.env, key BACKUP_GPG_PASSPHRASE):
#        gpg --output restored.dump --decrypt fp_YYYYMMDD_HHMMSS.dump.gpg
#      (non-interactive: gpg --batch --passphrase "$BACKUP_GPG_PASSPHRASE" \
#                            --output restored.dump --decrypt FILE.gpg)
#
#   3. Restore into a Postgres database with pg_restore. Example into a fresh DB:
#        createdb festie_restore
#        pg_restore --no-owner --no-privileges -d festie_restore restored.dump
#      Or restore in place (DESTRUCTIVE -- coordinate, this is prod data):
#        pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" restored.dump
#
#   4. Verify: psql -d festie_restore -c '\dt' and spot-check row counts.
#
#   The dumps are custom-format (pg_dump -Fc), so pg_restore --list works to
#   inspect contents before restoring:
#        pg_restore --list restored.dump | head
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# BACKUP_DIR resolves exactly as in backup-pg.sh (caller env, else the default), so
# both scripts share one directory and one lock; a BACKUP_DIR in .env is ignored.
CALLER_BACKUP_DIR="${BACKUP_DIR:-}"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

BACKUP_DIR="${CALLER_BACKUP_DIR:-$HOME/backups/festie}"
LOG_FILE="$BACKUP_DIR/offsite-git.log"
DEPLOY_KEY="${BACKUP_DEPLOY_KEY:-$HOME/.ssh/festie_backups_deploy}"
REPO_SSH="${BACKUP_GIT_REPO:?BACKUP_GIT_REPO is required: set it in .env or the environment to the private backups repo SSH address}"
CLONE_DIR="${BACKUP_GIT_CLONE:-$HOME/festie-backups-git}"
DUMPS_SUBDIR="dumps"
LOCK_WAIT="${BACKUP_LOCK_WAIT:-120}"
FESTIVAL_MODE_FLAG="${FESTIVAL_MODE_FLAG:-$HOME/.festie-festival-mode}"

NTFY_TOPIC_FILE="$HOME/.config/festie-ntfy-topic"

mkdir -p "$BACKUP_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

# Alert on ANY non-zero exit (set -e abort or explicit exit 1). A failed alert
# must not mask the original exit status, so curl errors are swallowed.
alert_on_failure() {
  local rc=$?
  [ "$rc" -eq 0 ] && return 0
  [ -s "$NTFY_TOPIC_FILE" ] && [ -r "$NTFY_TOPIC_FILE" ] || return 0
  local topic
  topic="$(tr -d '[:space:]' < "$NTFY_TOPIC_FILE")"
  [ -n "$topic" ] || return 0
  curl -fsS -m 10 -d "Festie off-site git backup FAILED (exit $rc). See offsite-git.log." \
    "https://ntfy.sh/$topic" >/dev/null 2>&1 || true
}
trap alert_on_failure EXIT

# The lock fd (9) must not leak into children that outlive this run (git's
# detached gc, a gpg-agent), or they would hold the lock after we exit.
git() { command git "$@" 9>&-; }

export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

if [ -z "${BACKUP_GPG_PASSPHRASE:-}" ]; then
  log "ERROR: BACKUP_GPG_PASSPHRASE not set in .env -- aborting (no off-site backup made)."
  exit 1
fi

# 0. One lock for all backup runs (shared with backup-pg.sh)
exec 9>"$BACKUP_DIR/.backup.lock"
if [ "$LOCK_WAIT" = "0" ]; then FLOCK_ARGS=(-n); else FLOCK_ARGS=(-w "$LOCK_WAIT"); fi
if ! flock "${FLOCK_ARGS[@]}" 9; then
  log "lock held, skipped"
  exit 75
fi

# 1. Newest dump by the timestamp in its name. *_weekly.dump is a copy of a daily
# dump with no sidecar, so it is never selected.
NEWEST=""
for f in "$BACKUP_DIR"/fp_*.dump; do
  [ -f "$f" ] && [[ "$f" != *_weekly.dump ]] && NEWEST="$f"   # glob order is sorted, so the last is the newest
done
if [ -z "$NEWEST" ]; then
  log "ERROR: no fp_*.dump found in $BACKUP_DIR -- nothing to push."
  exit 1
fi
BASENAME="$(basename "$NEWEST")"
STAMP="${BASENAME#fp_}"; STAMP="${STAMP%.dump}"
DUMP_EPOCH="$(date -d "${STAMP:0:8} ${STAMP:9:2}:${STAMP:11:2}:${STAMP:13:2}" +%s 2>/dev/null || echo 0)"
MAX_AGE=$((26 * 3600))
[ -e "$FESTIVAL_MODE_FLAG" ] && MAX_AGE=$((2 * 3600))
if [ $(( $(date +%s) - DUMP_EPOCH )) -gt "$MAX_AGE" ]; then
  log "ERROR: newest dump $BASENAME is older than $((MAX_AGE / 3600)) h -- backups are stale."
  exit 1
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  log "ERROR: pg_restore not found in PATH -- cannot verify $BASENAME."
  exit 1
fi
LIST_RC=0
LIST_ERR="$(pg_restore --list "$NEWEST" 2>&1 >/dev/null)" || LIST_RC=$?
if [ "$LIST_RC" -eq 126 ] || [ "$LIST_RC" -eq 127 ]; then
  log "ERROR: pg_restore could not run (exit $LIST_RC): $(head -n1 <<<"$LIST_ERR") -- $BASENAME left in place."
  exit 1
elif [ "$LIST_RC" -ne 0 ]; then
  mv -f "$NEWEST" "${NEWEST}.bad"
  log "ERROR: pg_restore --list failed for $BASENAME ($(head -n1 <<<"$LIST_ERR")) -- renamed to ${BASENAME}.bad."
  exit 1
fi
ENC_NAME="${BASENAME}.gpg"
log "Selected newest dump: $BASENAME"

# 2. Clone on first run (shallow), else refresh
if [ ! -d "$CLONE_DIR/.git" ]; then
  rm -rf "$CLONE_DIR"
  if git clone --depth 1 "$REPO_SSH" "$CLONE_DIR" >>"$LOG_FILE" 2>&1; then
    log "Cloned $REPO_SSH (shallow)."
  else
    # Empty repo: clone fails; init instead
    log "Clone failed (likely empty repo) -- initializing fresh."
    mkdir -p "$CLONE_DIR"
    git -C "$CLONE_DIR" init -q
    git -C "$CLONE_DIR" remote add origin "$REPO_SSH"
    git -C "$CLONE_DIR" checkout -q -b main 2>/dev/null || true
  fi
fi

cd "$CLONE_DIR"
git config user.email "backup-bot@festie.us"
git config user.name "festie-backup-bot"
git fetch --depth 1 origin >>"$LOG_FILE" 2>&1 || true
git checkout -q main 2>/dev/null || git checkout -q -b main
git reset -q --hard origin/main 2>/dev/null || true

mkdir -p "$DUMPS_SUBDIR"

# 3. Encrypt newest dump (AES256 symmetric) into the repo's dumps dir
if [ -f "$DUMPS_SUBDIR/$ENC_NAME" ]; then
  log "Already pushed $ENC_NAME -- skipping re-encrypt; running prune only."
else
  if gpg --batch --yes --quiet --pinentry-mode loopback \
        --symmetric --cipher-algo AES256 \
        --passphrase-fd 3 \
        --output "$DUMPS_SUBDIR/$ENC_NAME" \
        "$NEWEST" 3<<<"$BACKUP_GPG_PASSPHRASE" 9>&-; then
    log "Encrypted -> $DUMPS_SUBDIR/$ENC_NAME"
    git add "$DUMPS_SUBDIR/$ENC_NAME"
    if [ -f "$NEWEST.counts" ]; then
      cp "$NEWEST.counts" "$DUMPS_SUBDIR/$BASENAME.counts"
      git add "$DUMPS_SUBDIR/$BASENAME.counts"
    else
      log "WARNING: no $BASENAME.counts sidecar -- the restore drill will fail on it."
    fi
  else
    log "ERROR: gpg encryption failed for $BASENAME -- aborting."
    exit 1
  fi
fi

# 4. Tiered prune (a dump's .counts sidecar goes with it)
# A failed prune must not hide: still push the new dump, then exit 1 at the end.
PRUNE_FAILED=0
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || { [ -x /usr/bin/node ] && NODE_BIN=/usr/bin/node; } || true
if [ -z "$NODE_BIN" ]; then
  log "ERROR: node not found in PATH or /usr/bin -- retention prune not run."
  PRUNE_FAILED=1
elif ! REMOVE_LIST="$(ls -1 "$DUMPS_SUBDIR" | "$NODE_BIN" "$SCRIPT_DIR/lib/backup-retention.cjs")"; then
  log "ERROR: retention prune failed -- nothing pruned."
  PRUNE_FAILED=1
else
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    git rm -q --ignore-unmatch "$DUMPS_SUBDIR/$name" || rm -f "$DUMPS_SUBDIR/$name"
    log "Pruned old dump file: $name"
  done <<<"$REMOVE_LIST"
fi

# Commit + push if anything changed
if ! git diff --cached --quiet || ! git diff --quiet; then
  git add -A "$DUMPS_SUBDIR"
  git commit -q -m "backup: $BASENAME ($(date '+%Y-%m-%d %H:%M:%S'))" >>"$LOG_FILE" 2>&1 || true
  if git push -q origin main >>"$LOG_FILE" 2>&1; then
    log "Pushed to $REPO_SSH (main). Repo now holds $(ls -1 "$DUMPS_SUBDIR"/*.gpg 2>/dev/null | wc -l) dumps."
  else
    log "ERROR: git push failed -- check deploy key / network."
    exit 1
  fi
else
  log "No changes to push."
fi

if [ "$PRUNE_FAILED" = "1" ]; then
  log "Off-site git backup pushed, but retention prune failed."
  exit 1
fi
log "Off-site git backup completed."
