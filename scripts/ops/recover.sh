#!/bin/bash
# Harder reset for festie: restart the PM2 daemon itself, then bring every saved
# app back.
#
# READ THIS FIRST. `pm2 kill` stops the DAEMON, which takes down every app on it
# -- festie, festie-staging and pm2-logrotate -- not just festie. Reach for
# restart.sh unless the daemon itself is the problem. This script exists for the
# case where PM2's own state is corrupt, e.g. a stale reload.lock.
#
# This script previously guaranteed the outage it was meant to fix. It ran
# `pm2 kill` and then started `ecosystem.config.js`, a filename that does not
# exist -- only `ecosystem.config.cjs` does. Under `set -e` it aborted at that
# line, so it reliably stopped everything and started nothing.

set -uo pipefail

# Same overrides as scripts/deploy/deploy.py, so this can be rehearsed on staging.
APP="${FESTIE_PM2_NAME:-festie}"
APP_DIR="${FESTIE_APP_DIR:-$HOME/festival-planner}"
CONFIG="${FESTIE_PM2_CONFIG:-ecosystem.config.cjs}"
PORT="${FESTIE_PORT:-4000}"

cd "$APP_DIR" || { echo "FATAL: $APP_DIR not found"; exit 1; }

# Checked BEFORE the daemon dies. dist/ is gitignored and built on this host, so
# a missing bundle here would otherwise be discovered only after everything is
# already down.
if [ ! -f "$APP_DIR/dist/server.js" ]; then
    echo "FATAL: dist/server.js is missing. The app boots a built bundle."
    echo "Build it first, then re-run:  cd $APP_DIR && npm run build"
    echo "Nothing has been stopped."
    exit 1
fi

# A daemon restart is only survivable if the saved list can bring the other apps
# back. Warn loudly rather than discovering it afterwards.
DUMP="${PM2_HOME:-$HOME/.pm2}/dump.pm2"
if [ ! -s "$DUMP" ]; then
    echo "WARNING: $DUMP is missing or empty."
    echo "pm2 resurrect will NOT restore the other apps (e.g. festie-staging)."
    echo "This script will still start $APP from $CONFIG."
fi

echo "=== STEP 1: Kill the PM2 daemon (stops ALL apps) ==="
pm2 kill 2>/dev/null || true
sleep 3

echo "=== STEP 2: Stop orphan backend process ==="
pkill -TERM -f "$APP_DIR/dist/server.js" 2>/dev/null || true
for _ in $(seq 1 40); do
    pgrep -f "$APP_DIR/dist/server.js" >/dev/null 2>&1 || break
    sleep 1
done
pkill -KILL -f "$APP_DIR/dist/server.js" 2>/dev/null || true
sleep 2

echo "=== STEP 3: Verify port free ==="
# Never kill whatever holds the port: it may not be this app.
if fuser "$PORT/tcp" >/dev/null 2>&1; then
    echo "ERROR: Port $PORT is held by a process that is not $APP_DIR/dist/server.js."
    fuser -v "$PORT/tcp" 2>&1
    echo "Stop that process yourself, then re-run."
    exit 1
else
    echo "Port $PORT is free"
fi

echo "=== STEP 4: Restore every saved app ==="
# resurrect first, so festie-staging and pm2-logrotate come back too. It may
# fail or restore nothing if the dump is stale; festie is started explicitly
# below either way.
pm2 resurrect 2>/dev/null || echo "(resurrect failed or had nothing to restore)"
sleep 5

echo "=== STEP 5: Start $APP ==="
# Idempotent against resurrect: if it already brought festie back, start is a
# no-op on an online app, and this is a no-op rather than a duplicate.
if pm2 describe "$APP" >/dev/null 2>&1; then
    echo "$APP already restored by resurrect"
else
    if ! pm2 start "$CONFIG" --only "$APP"; then
        echo "FATAL: pm2 start failed. $APP is NOT running."
        exit 1
    fi
fi
sleep 12

echo "=== STEP 6: Check status ==="
pm2 list
echo ""

echo "=== STEP 7: Recent logs ==="
tail -15 "$APP_DIR/logs/pm2-out.log"
echo ""

echo "=== STEP 8: Health check ==="
HTTP_CODE=$(curl -s -o /tmp/health.json -w "%{http_code}" "http://127.0.0.1:$PORT/api/health")
echo "HTTP: $HTTP_CODE"
cat /tmp/health.json
echo ""

echo "=== STEP 9: PM2 details ==="
pm2 show "$APP" 2>&1 | grep -E "status|restarts|uptime|pid"

if [ "$HTTP_CODE" != "200" ]; then
    echo "=== FAILED: health is $HTTP_CODE. Do not walk away from this. ==="
    exit 1
fi

echo "=== DONE ==="
