#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# PostgreSQL backup script for Festie
#
# Creates pg_dump custom-format backups with gzip compression, rotates old
# backups on a daily (30) + weekly (12) retention policy, and optionally
# verifies the dump is restorable.
#
# Run manually:    bash scripts/backup-pg.sh
# Run via cron:    0 */6 * * * cd /opt/festie && bash scripts/backup-pg.sh \
#                      >> logs/backup.log 2>&1
# npm alias:       npm run db:backup
#
# Avatars: uploaded avatar files live on disk, not in the database, so each run
# also writes BACKUP_DIR/avatars_YYYYMMDD.tar.gz from AVATAR_DIR (a later run the
# same day replaces it). Restore one file or all of them into the live directory:
#   tar -xzf avatars_YYYYMMDD.tar.gz -C <public dir>/uploads            (all)
#   tar -xzf avatars_YYYYMMDD.tar.gz -C <public dir>/uploads avatars/<file>.webp
# The off-site copy covers the dump only; the avatar archive stays on this host.
# ──────────────────────────────────────────────────────────────────────────────

# ── Configuration (override with env vars) ───────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/festie}"
LOG_FILE="${BACKUP_LOG:-${BACKUP_DIR}/backup.log}"
DB_NAME="${DB_NAME:-festival_planner}"
DB_USER="${DB_USER:-festival}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DAILY_KEEP="${DAILY_KEEP:-30}"      # days to keep daily backups
WEEKLY_KEEP="${WEEKLY_KEEP:-12}"    # weekly snapshots to retain
VERIFY="${BACKUP_VERIFY:-1}"        # pg_restore --list is cheap; catches truncated dumps
LOCK_WAIT="${BACKUP_LOCK_WAIT:-120}" # seconds to wait for another backup run; 0 = do not wait
AVATAR_DIR="${AVATAR_DIR:-${PUBLIC_DIR:-$SCRIPT_DIR/public}/uploads/avatars}"

# ── Helpers ──────────────────────────────────────────────────────────────────

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# ── Resolve credentials ─────────────────────────────────────────────────────
# Prefer DATABASE_URL (standard in .env), fall back to individual PG* vars.

if [ -z "${PGPASSWORD:-}" ]; then
  DB_URL="${DATABASE_URL:-}"
  if [ -z "$DB_URL" ] && [ -f "$SCRIPT_DIR/.env" ]; then
    DB_URL=$(grep '^DATABASE_URL=' "$SCRIPT_DIR/.env" | head -n1 | cut -d= -f2- || true)
  fi
  # WHATWG URL parsing handles '@' and ':' in the password; decode percent-escapes.
  if [ -n "$DB_URL" ]; then
    PGPASSWORD=$(DB_URL="$DB_URL" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).password))' 2>/dev/null || true)
  fi
fi
export PGPASSWORD="${PGPASSWORD:?Could not resolve database password from DATABASE_URL, PGPASSWORD, or .env}"

# ── Pre-flight checks ───────────────────────────────────────────────────────

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found in PATH"
command -v flock >/dev/null 2>&1 || die "flock not found in PATH"
mkdir -p "$BACKUP_DIR"

# One lock for every backup run (shared with backup-offsite-git.sh). Exit 75 so a
# hung run makes the next scheduled run miss its ping and alert.
exec 9>"$BACKUP_DIR/.backup.lock"
if [ "$LOCK_WAIT" = "0" ]; then FLOCK_ARGS=(-n); else FLOCK_ARGS=(-w "$LOCK_WAIT"); fi
if ! flock "${FLOCK_ARGS[@]}" 9; then
  log "lock held, skipped"
  exit 75
fi

# Failed copies are kept as *.dump.bad for a week, never as the newest .dump.
find "$BACKUP_DIR" -maxdepth 1 -name "fp_*.dump.bad" -mtime +7 -delete

# Name by second; never overwrite a file another run just wrote.
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
while [ -e "${BACKUP_DIR}/fp_${TIMESTAMP}.dump" ]; do
  sleep 1
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
done
BACKUP_FILE="${BACKUP_DIR}/fp_${TIMESTAMP}.dump"

log "Starting backup: db=${DB_NAME} host=${DB_HOST}:${DB_PORT} dest=${BACKUP_DIR}"

# ── Dump ─────────────────────────────────────────────────────────────────────

if pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
     --format=custom --compress=6 -f "$BACKUP_FILE" 2>&1; then
  # Verify file is non-trivially sized (custom format header alone is ~20 bytes)
  FSIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo 0)
  if [ "$FSIZE" -lt 100 ]; then
    rm -f "$BACKUP_FILE"
    die "Backup file suspiciously small (${FSIZE} bytes) -- likely an empty database or auth failure"
  fi
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  log "Backup OK: $BACKUP_FILE ($SIZE)"
else
  rm -f "$BACKUP_FILE"
  die "pg_dump exited with a non-zero status"
fi

# ── Optional verification ────────────────────────────────────────────────────

if [ "${VERIFY}" = "1" ]; then
  command -v pg_restore >/dev/null 2>&1 || die "pg_restore not found in PATH -- dump kept unverified: ${BACKUP_FILE}"
  LIST_RC=0
  LIST_ERR="$(pg_restore --list "$BACKUP_FILE" 2>&1 >/dev/null)" || LIST_RC=$?
  if [ "$LIST_RC" -eq 0 ]; then
    log "Verification OK: pg_restore --list succeeded"
  elif [ "$LIST_RC" -eq 126 ] || [ "$LIST_RC" -eq 127 ]; then
    # The tool could not run, so the dump is not known to be bad: keep it.
    die "pg_restore could not run (exit ${LIST_RC}): $(head -n1 <<<"$LIST_ERR") -- dump kept unverified: ${BACKUP_FILE}"
  else
    mv -f "$BACKUP_FILE" "${BACKUP_FILE}.bad"
    die "pg_restore --list failed ($(head -n1 <<<"$LIST_ERR")) -- dump is corrupt, kept as ${BACKUP_FILE}.bad"
  fi
fi

# ── Row-count sidecar ────────────────────────────────────────────────────────
# Non-fatal: on failure no sidecar is written and the restore drill fails on it.

COUNTS_TMP="${BACKUP_FILE}.counts.tmp"
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -X -A -t -F '|' \
     -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/scripts/sql/backup-counts.sql" > "$COUNTS_TMP"; then
  mv "$COUNTS_TMP" "${BACKUP_FILE}.counts"
  log "Row counts written: ${BACKUP_FILE}.counts"
else
  rm -f "$COUNTS_TMP"
  log "WARNING: row-count query failed -- no .counts sidecar for $(basename "$BACKUP_FILE")"
fi

# ── Weekly snapshot ──────────────────────────────────────────────────────────
# Tag Sunday dumps as weekly so they survive daily pruning. One per day: a
# 6-hourly run must not add a second copy.

DOW=$(date +%u)  # 7 = Sunday
if [ "$DOW" = "7" ] && ! compgen -G "${BACKUP_DIR}/fp_${TIMESTAMP%%_*}_*_weekly.dump" >/dev/null; then
  WEEKLY_FILE="${BACKUP_DIR}/fp_${TIMESTAMP}_weekly.dump"
  cp "$BACKUP_FILE" "$WEEKLY_FILE"
  log "Weekly snapshot: $WEEKLY_FILE"
fi

# ── Avatars ──────────────────────────────────────────────────────────────────
# The dump holds avatar keys, not the image files. Written to a temp name first,
# so a failed run never replaces the last good archive. A failure is reported
# after rotation, so the dump and its pruning still happen.

AVATAR_FAILED=0
if [ -d "$AVATAR_DIR" ]; then
  AVATAR_ARCHIVE="${BACKUP_DIR}/avatars_${TIMESTAMP%%_*}.tar.gz"
  if tar -czf "${AVATAR_ARCHIVE}.tmp" -C "$(dirname "$AVATAR_DIR")" "$(basename "$AVATAR_DIR")" \
       && mv -f "${AVATAR_ARCHIVE}.tmp" "$AVATAR_ARCHIVE"; then
    log "Avatar archive OK: $AVATAR_ARCHIVE ($(du -h "$AVATAR_ARCHIVE" | cut -f1))"
  else
    rm -f "${AVATAR_ARCHIVE}.tmp"
    log "ERROR: avatar archive failed for ${AVATAR_DIR}"
    AVATAR_FAILED=1
  fi
else
  log "No avatar directory at ${AVATAR_DIR}: avatar archive skipped"
fi

# ── Rotation: daily ─────────────────────────────────────────────────────────
# Delete daily dumps (not tagged _weekly) older than DAILY_KEEP days.

DAILY_PRUNED=$(find "$BACKUP_DIR" -maxdepth 1 -name "fp_*.dump" \
  -not -name "*_weekly.dump" -mtime +"${DAILY_KEEP}" -print -delete | wc -l)
find "$BACKUP_DIR" -maxdepth 1 -name "fp_*.dump.counts" -mtime +"${DAILY_KEEP}" -delete
find "$BACKUP_DIR" -maxdepth 1 -name "avatars_*.tar.gz*" -mtime +"${DAILY_KEEP}" -delete
log "Daily rotation: pruned ${DAILY_PRUNED} backups older than ${DAILY_KEEP}d"

# ── Rotation: weekly ────────────────────────────────────────────────────────
# Keep only the most recent WEEKLY_KEEP weekly snapshots.

WEEKLY_PRUNED=0
WEEKLY_FILES=$(ls -1t "$BACKUP_DIR"/fp_*_weekly.dump 2>/dev/null || true)
WEEKLY_INDEX=0
for WF in $WEEKLY_FILES; do
  WEEKLY_INDEX=$((WEEKLY_INDEX + 1))
  if [ "$WEEKLY_INDEX" -gt "$WEEKLY_KEEP" ]; then
    rm -f "$WF"
    WEEKLY_PRUNED=$((WEEKLY_PRUNED + 1))
  fi
done
log "Weekly rotation: pruned ${WEEKLY_PRUNED} snapshots, keeping ${WEEKLY_KEEP}"

# ── Summary ──────────────────────────────────────────────────────────────────

REMAINING_DAILY=$(find "$BACKUP_DIR" -maxdepth 1 -name "fp_*.dump" -not -name "*_weekly.dump" | wc -l)
REMAINING_WEEKLY=$(ls -1 "$BACKUP_DIR"/fp_*_weekly.dump 2>/dev/null | wc -l || echo 0)
log "Retention summary: ${REMAINING_DAILY} daily + ${REMAINING_WEEKLY} weekly backups on disk"
[ "$AVATAR_FAILED" = "0" ] || die "Dump OK, but the avatar archive failed"
log "Backup complete"
