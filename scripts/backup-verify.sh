#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# backup-verify.sh  — weekly pg_restore smoke test for Festie
#
# Runs pg_restore --list on the newest dump in BACKUP_DIR (fp_*.dump.gpg), decrypted to a
# temporary file that is deleted at exit. Needs BACKUP_GPG_PASSPHRASE (environment or .env).
# Appends PASS/FAIL with timestamp to VERIFY_LOG.
#
# Cron (weekly, Sunday 04:00):
#   0 4 * * 0 <app dir>/scripts/backup-verify.sh
#
# Healthcheck heartbeat (optional):
#   Set HEALTHCHECK_URL=https://hc-ping.com/<uuid> in .env or environment
# ─────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/festie}"
VERIFY_LOG="${VERIFY_LOG:-${BACKUP_DIR}/verify.log}"

log()  { printf '[%s] %s\n' "$(date -Iseconds)" "$*" | tee -a "$VERIFY_LOG"; }
fail() { log "FAIL: $*"; exit 1; }

# shellcheck source=lib/backup-gpg.sh
source "$SCRIPT_DIR/scripts/lib/backup-gpg.sh"
load_backup_passphrase "$SCRIPT_DIR"
PLAIN=""
trap 'rm -f "$PLAIN"' EXIT

# ── Resolve credentials ──────────────────────────────────────────────
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
export PGPASSWORD="${PGPASSWORD:?Could not resolve database password}"

# ── Find newest dump ─────────────────────────────────────────────────
NEWEST=$(find "$BACKUP_DIR" -maxdepth 1 -name 'fp_*.dump.gpg' \
  -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | awk '{print $2}')

[ -n "$NEWEST" ] || fail "No dump files found in ${BACKUP_DIR}"
[ -f "$NEWEST" ] || fail "Dump file missing: ${NEWEST}"

FSIZE=$(stat -c%s "$NEWEST" 2>/dev/null || echo 0)
[ "$FSIZE" -gt 100 ] || fail "Dump suspiciously small (${FSIZE} bytes): ${NEWEST}"

log "Verifying: ${NEWEST} ($(du -h "$NEWEST" | cut -f1))"

# ── pg_restore --list (cheap structural check, no DB needed) ─────────
# Disable pipefail for this check: pg_restore --list can return non-zero
# for minor warnings; we only care that it can read the dump header.
PG_RC=0
PLAIN="$(mktemp "$BACKUP_DIR/.verify.XXXXXX")"
backup_decrypt "$NEWEST" "$PLAIN" || fail "could not decrypt ${NEWEST} with BACKUP_GPG_PASSPHRASE"
( set +e; pg_restore --list "$PLAIN" > /dev/null 2>&1 ) || PG_RC=$?

if [ "$PG_RC" -eq 0 ]; then
  MSG="PASS: pg_restore --list OK — $(basename "$NEWEST") (${FSIZE} bytes)"
  log "$MSG"
else
  fail "pg_restore --list exited ${PG_RC} on ${NEWEST} — dump may be corrupt"
fi

# ── Optional healthcheck ping ────────────────────────────────────────
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  curl -fsS --max-time 10 "${HEALTHCHECK_URL}" > /dev/null 2>&1 \
    && log "Healthcheck ping sent" \
    || log "WARNING: healthcheck ping failed (non-fatal)"
fi
