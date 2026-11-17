#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Weekly restore drill for Festie (runs on the production host).
#
# Clones the newest encrypted dump and its .counts sidecar from the off-site repo
# (uhsear/festie-backups), decrypts the dump to a temp dir, restores it into the
# festie-test-db container through scripts/backup-verify-restore.sh, and compares
# the restored row counts with the sidecar. PII stays on the host.
#
# It proves data and schema restore only. It does not boot the app.
#
# Credentials are the container's, never production's. Create
# ~/.config/festie-drill-db.env (mode 600) with:
#   DB_USER=...        container admin user
#   PGPASSWORD=...     container password (must differ from production's)
#   DB_NAME=...        container admin database (restore is created beside it)
#
# Fails closed: refuses unless DB_PORT is 5433, unless the container password
# differs from the production password, and for any restore DB name ending
# in _test. Refusals happen before any database command runs.
#
# Environment:
#   DRILL_DB_ENV            Credentials file (default ~/.config/festie-drill-db.env)
#   FESTIE_ENV_FILE         Production .env, read only to compare passwords and for
#                           BACKUP_GPG_PASSPHRASE (default <repo>/.env)
#   DB_PORT                 Must be 5433 (default 5433)
#   RESTORE_DB              Restore DB name (default festie_drill_<epoch>)
#   KEEP_DB                 1 = leave the restored DB for the R1 boot drill
#   BACKUP_GIT_REPO         Off-site repo (default git@github.com:uhsear/festie-backups.git)
#   BACKUP_DEPLOY_KEY       Read key for that repo (default ~/.ssh/festie_backups_deploy)
#   DRILL_HEALTHCHECK_URL   Pinged on success
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DRILL_DB_ENV="${DRILL_DB_ENV:-$HOME/.config/festie-drill-db.env}"
FESTIE_ENV_FILE="${FESTIE_ENV_FILE:-$SCRIPT_DIR/../.env}"
BACKUP_GIT_REPO="${BACKUP_GIT_REPO:-git@github.com:uhsear/festie-backups.git}"
DEPLOY_KEY="${BACKUP_DEPLOY_KEY:-$HOME/.ssh/festie_backups_deploy}"
MAX_AGE=$((26 * 3600))
KEEP_DB="${KEEP_DB:-0}"
RESTORE_DB="${RESTORE_DB:-festie_drill_$(date +%s)}"
DB_PORT="${DB_PORT:-5433}"
WORK=""
DB_CREATED=0

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

cleanup() {
  [ -n "$WORK" ] && rm -rf "$WORK"
  if [ "$DB_CREATED" = "1" ] && [ "$KEEP_DB" != "1" ]; then
    dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$RESTORE_DB" 2>/dev/null || true
  fi
}
trap cleanup EXIT

env_value() { grep -m1 "^$1=" "$2" | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }

# ── Refusals (no database command runs before these pass) ───────────────────

# The off-site script's PII-free drill env must stay free of these (R1 boot drill).
for key in FIREBASE_CREDENTIALS_PATH RESEND_API_KEY VAPID_PRIVATE_KEY FCM_RETRY_WEBHOOK_URL SENTRY_DSN; do
  [ -z "${!key:-}" ] || die "$key is set in the environment -- the drill must not carry production service credentials"
done

[ -f "$DRILL_DB_ENV" ] || die "Drill credentials file not found: $DRILL_DB_ENV (create it, mode 600, with DB_USER, PGPASSWORD, DB_NAME)"
unset DATABASE_URL PGPASSWORD
# shellcheck disable=SC1090
source "$DRILL_DB_ENV"
DB_HOST=127.0.0.1
: "${DB_USER:?DB_USER missing in $DRILL_DB_ENV}"
: "${PGPASSWORD:?PGPASSWORD missing in $DRILL_DB_ENV}"
: "${DB_NAME:?DB_NAME missing in $DRILL_DB_ENV}"
export DB_USER DB_HOST DB_PORT DB_NAME PGPASSWORD

[ "$DB_PORT" = "5433" ] || die "DB_PORT is ${DB_PORT}, not 5433 -- refusing (5432 is production)"
[[ "$RESTORE_DB" =~ ^[A-Za-z0-9_]+$ ]] || die "Restore DB name '${RESTORE_DB}' is not a plain identifier"
[[ "$RESTORE_DB" != *_test ]] || die "Restore DB name '${RESTORE_DB}' ends in _test -- refusing"
# The wrapper drops this database at exit, so it may only touch drill names.
[[ "$RESTORE_DB" == festie_drill_* ]] || die "Restore DB name '${RESTORE_DB}' must start with festie_drill_"

[ -f "$FESTIE_ENV_FILE" ] || die "Production .env not found at $FESTIE_ENV_FILE -- cannot prove the container password differs from production's"
PROD_PASSWORD="$(env_value DATABASE_URL "$FESTIE_ENV_FILE" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')"
[ "$PGPASSWORD" != "$PROD_PASSWORD" ] || die "Container password equals the production database password -- refusing"
BACKUP_GPG_PASSPHRASE="$(env_value BACKUP_GPG_PASSPHRASE "$FESTIE_ENV_FILE")"
[ -n "$BACKUP_GPG_PASSPHRASE" ] || die "BACKUP_GPG_PASSPHRASE not set in $FESTIE_ENV_FILE"
unset PROD_PASSWORD

for cmd in git gpg pg_restore psql createdb dropdb; do
  command -v "$cmd" >/dev/null 2>&1 || die "$cmd not found in PATH"
done

log "Drill target: host=${DB_HOST} port=${DB_PORT} admin_db=${DB_NAME} restore_db=${RESTORE_DB}"

# ── Fetch the newest off-site dump and its sidecar ──────────────────────────

WORK="$(mktemp -d)"
export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
git clone --quiet --depth 1 "$BACKUP_GIT_REPO" "$WORK/repo" || die "Could not clone $BACKUP_GIT_REPO"

ENC="$(ls -1 "$WORK"/repo/dumps/fp_*.dump.gpg 2>/dev/null | sort | tail -1 || true)"
[ -n "$ENC" ] || die "No encrypted dump in the off-site repo"
ENC_NAME="$(basename "$ENC")"
DUMP_NAME="${ENC_NAME%.gpg}"
SIDECAR="$WORK/repo/dumps/${DUMP_NAME}.counts"
[ -f "$SIDECAR" ] || die "Sidecar ${DUMP_NAME}.counts is missing from the off-site repo"

STAMP="${DUMP_NAME#fp_}"; STAMP="${STAMP%.dump}"
DUMP_EPOCH="$(date -d "${STAMP:0:8} ${STAMP:9:2}:${STAMP:11:2}:${STAMP:13:2}" +%s 2>/dev/null || echo 0)"
[ $(( $(date +%s) - DUMP_EPOCH )) -le "$MAX_AGE" ] || die "Newest off-site dump ${ENC_NAME} is older than 26 h"
log "Newest off-site dump: ${ENC_NAME}"

DUMP="$WORK/$DUMP_NAME"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --output "$DUMP" --decrypt "$ENC" 3<<<"$BACKUP_GPG_PASSPHRASE" || die "Could not decrypt ${ENC_NAME} -- is the passphrase copy current?"
unset BACKUP_GPG_PASSPHRASE

# ── Restore ─────────────────────────────────────────────────────────────────

# The dump's own table list stands in for a source database to compare with.
EXPECTED_TABLES="$(pg_restore --list "$DUMP" | grep -cE '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' || true)"
[ "$EXPECTED_TABLES" -gt 0 ] || die "pg_restore --list found no public tables in ${DUMP_NAME}"
export EXPECTED_TABLES RESTORE_DB
DB_CREATED=1
KEEP_DB=1 bash "$SCRIPT_DIR/backup-verify-restore.sh" "$DUMP" || die "backup-verify-restore.sh failed"

# ── Compare restored counts with the sidecar ────────────────────────────────

FAILED=0
while IFS='|' read -r table expected _newest; do
  [ -n "$table" ] || continue
  [[ "$table" =~ ^[a-z_]+$ && "$expected" =~ ^[0-9]+$ ]] || die "Malformed sidecar row: ${table}|${expected}"
  restored="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$RESTORE_DB" -t -A -c "SELECT count(*) FROM ${table};")" \
    || die "Could not count ${table} in ${RESTORE_DB}"
  diff=$(( restored > expected ? restored - expected : expected - restored ))
  if [ "$diff" -gt 5 ] && [ $(( diff * 100 )) -gt $(( expected * 20 )) ]; then
    log "ERROR: ${table}: restored=${restored} sidecar=${expected}"
    FAILED=1
  else
    log "OK: ${table}: restored=${restored} sidecar=${expected}"
  fi
  if { [ "$table" = "users" ] || [ "$table" = "festivals" ]; } && [ "$restored" -eq 0 ]; then
    log "ERROR: ${table} is empty after restore"
    FAILED=1
  fi
done < "$SIDECAR"
[ "$FAILED" = "0" ] || die "Row counts do not match the sidecar"

if [ "$KEEP_DB" = "1" ]; then
  log "KEEP_DB=1: restored database ${RESTORE_DB} left in place -- drop it by hand"
fi
log "Restore drill PASSED: ${ENC_NAME}"
if [ -n "${DRILL_HEALTHCHECK_URL:-}" ]; then
  curl -fsS --max-time 10 "$DRILL_HEALTHCHECK_URL" >/dev/null 2>&1 \
    && log "Healthcheck ping sent" \
    || log "WARNING: healthcheck ping failed (non-fatal)"
fi
