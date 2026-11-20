#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Boot step of the Festie restore drill (called by scripts/backup-restore-drill.sh).
#
# Starts the built app (dist/server.js) on loopback against a restored copy of the
# database. The app applies any migration the dump predates, then reports ready.
# The step passes when GET /api/ready returns 200 before the timeout, and it always
# stops the app before it exits.
#
# The app starts under `env -i`, so it carries no production service credentials:
# no mail, push, Sentry or Firebase keys, and no Redis. The app imports dotenv/config, so
# DOTENV_CONFIG_PATH points it at a missing file: a dotenv file in the app directory (the
# live checkout keeps one) is never loaded. See scripts/ops/drill.env.example.
#
# Environment:
#   DRILL_BOOT_DATABASE_URL   Required. URL of the restored database. Its name must start
#                             with festie_drill_ (the drill's own naming), never festival_planner.
#   DRILL_APP_DIR             Directory that holds dist/server.js (default: the repo root)
#   DRILL_BOOT_PORT           App port (default 4101; 4000 and 4001 are the live and staging apps)
#   DRILL_BOOT_METRICS_PORT   Metrics port (default 9501; the live app uses 9400)
#   DRILL_BOOT_TIMEOUT        Seconds to wait for /api/ready (default 90)
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${DRILL_APP_DIR:-$SCRIPT_DIR/..}"
PORT="${DRILL_BOOT_PORT:-4101}"
METRICS_PORT="${DRILL_BOOT_METRICS_PORT:-9501}"
TIMEOUT="${DRILL_BOOT_TIMEOUT:-90}"
APP_PID=""
APP_LOG=""

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  [ -z "$APP_LOG" ] || rm -f "$APP_LOG"
}
trap cleanup EXIT

# ── Refusals (nothing starts before these pass) ─────────────────────────────

: "${DRILL_BOOT_DATABASE_URL:?DRILL_BOOT_DATABASE_URL is required}"
DB_NAME="$(DB_URL="$DRILL_BOOT_DATABASE_URL" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)))' 2>/dev/null || true)"
[[ "$DB_NAME" == festie_drill_* ]] || die "Database '${DB_NAME}' does not start with festie_drill_ -- refusing to boot the app against it"
[[ "$PORT" =~ ^[0-9]+$ && "$METRICS_PORT" =~ ^[0-9]+$ && "$TIMEOUT" =~ ^[0-9]+$ ]] || die "DRILL_BOOT_PORT, DRILL_BOOT_METRICS_PORT and DRILL_BOOT_TIMEOUT must be whole numbers"
case "$PORT" in 4000|4001) die "Port ${PORT} belongs to the live or staging app -- use another DRILL_BOOT_PORT" ;; esac
[ -f "$APP_DIR/dist/server.js" ] || die "$APP_DIR/dist/server.js not found -- build the app first (npm run build)"
command -v curl >/dev/null 2>&1 || die "curl not found in PATH"
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${PORT}/api/ready"; then
  die "Something already answers on port ${PORT} -- refusing to test against it"
fi

# ── Boot ────────────────────────────────────────────────────────────────────

APP_LOG="$(mktemp)"
SESSION_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
log "Booting dist/server.js on 127.0.0.1:${PORT} against ${DB_NAME}"
(
  cd "$APP_DIR"
  exec env -i \
    PATH="$PATH" HOME="${HOME:-/tmp}" ${SYSTEMROOT:+SYSTEMROOT="$SYSTEMROOT"} ${TEMP:+TEMP="$TEMP"} \
    DOTENV_CONFIG_PATH=/nonexistent/festie-drill-no-dotenv \
    DOTENV_CONFIG_QUIET=true \
    NODE_ENV=production \
    PORT="$PORT" \
    METRICS_PORT="$METRICS_PORT" \
    HOST=127.0.0.1 \
    REDIS_ENABLED=false \
    DATABASE_URL="$DRILL_BOOT_DATABASE_URL" \
    PUBLIC_ORIGIN="http://127.0.0.1:${PORT}" \
    SESSION_SECRET="$SESSION_SECRET" \
    node dist/server.js
) >"$APP_LOG" 2>&1 &
APP_PID=$!

STATUS=""
for ((waited = 0; waited < TIMEOUT; waited++)); do
  kill -0 "$APP_PID" 2>/dev/null || break
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/api/ready" || true)"
  [ "$STATUS" = "200" ] && break
  sleep 1
done

if [ "$STATUS" != "200" ]; then
  log "App output (last 20 lines):" >&2
  tail -n 20 "$APP_LOG" >&2 || true
  die "Boot drill FAILED: /api/ready returned '${STATUS:-no answer}' (app $(kill -0 "$APP_PID" 2>/dev/null && echo "still running" || echo "exited")) after ${waited}s"
fi
log "Boot drill PASSED: /api/ready 200 after ${waited}s on ${DB_NAME}"
