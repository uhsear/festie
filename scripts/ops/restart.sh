#!/bin/bash
# Restart the festie app, stopping a stuck previous process first.
#
# Scope: this touches ONLY the app `festie`. It leaves the PM2 daemon and every
# other app (festie-staging, pm2-logrotate) alone. For the harder reset, see
# recover.sh -- and read its warning first.
#
# This script has broken twice in ways worth stating, because both are silent:
#   - It started `ecosystem.config.js`. Only `ecosystem.config.cjs` exists, so
#     the start step failed while the script carried on to `pm2 save`, persisting a
#     process list with festie DELETED. That destroys the definition a
#     `pm2 resurrect` would restore, turning a restart into an outage that
#     survives a reboot. Nothing is saved now unless the app is actually online.
#   - `pkill -f "node server.js"` matched nothing. The real command line is
#     `node <app dir>/dist/server.js`, and the old pattern
#     required "node" and "server.js" to be adjacent.

set -uo pipefail

# Same overrides as scripts/deploy/deploy.py, so this can be rehearsed on staging.
APP="${FESTIE_PM2_NAME:-festie}"
APP_DIR="${FESTIE_APP_DIR:-$HOME/festival-planner}"
CONFIG="${FESTIE_PM2_CONFIG:-ecosystem.config.cjs}"
PORT="${FESTIE_PORT:-4000}"

cd "$APP_DIR" || { echo "FATAL: $APP_DIR not found"; exit 1; }

# The backend is an esbuild bundle now, and dist/ is gitignored, so it exists
# only because someone built it on this host. Starting without it leaves PM2
# crash-looping on a missing file, which looks like an app fault rather than a
# missing artifact. Check before stopping anything.
if [ ! -f "$APP_DIR/dist/server.js" ]; then
    echo "FATAL: dist/server.js is missing. The app boots a built bundle."
    echo "Build it first, then re-run:  cd $APP_DIR && npm run build"
    exit 1
fi

echo "=== Step 1: Stop app (keep daemon) ==="
pm2 stop "$APP" 2>/dev/null || true
sleep 3

echo "=== Step 2: Delete process from PM2 ==="
pm2 delete "$APP" 2>/dev/null || true
sleep 2

echo "=== Step 3: Stop orphan backend process ==="
# SIGTERM first so the shutdown handler can close server, IO and DB. SIGKILL only
# a process of THIS app dir that outlives the handler's timeout.
pkill -TERM -f "$APP_DIR/dist/server.js" 2>/dev/null || true
for _ in $(seq 1 40); do
    pgrep -f "$APP_DIR/dist/server.js" >/dev/null 2>&1 || break
    sleep 1
done
pkill -KILL -f "$APP_DIR/dist/server.js" 2>/dev/null || true

echo "=== Step 4: Verify port free ==="
# Never kill whatever holds the port: it may not be this app.
sleep 3
if fuser "$PORT/tcp" >/dev/null 2>&1; then
    echo "FATAL: Port $PORT is held by a process that is not $APP_DIR/dist/server.js."
    fuser -v "$PORT/tcp" 2>&1
    echo "Stop that process yourself, then re-run."
    exit 1
fi

echo "=== Step 5: Start fresh ==="
# --only, so a config that ever grows a second app cannot start it by surprise.
# Delete-then-start is also the only sequence that applies a changed `script` or
# `interpreter`; a plain restart re-reads neither.
if ! pm2 start "$CONFIG" --only "$APP"; then
    echo "FATAL: pm2 start failed. $APP is NOT running."
    echo "Deliberately skipping pm2 save, so the resurrect definition survives."
    exit 1
fi
sleep 8

echo "=== Step 6: Status ==="
pm2 list

echo "=== Step 7: Health ==="
HEALTHY=0
curl -sf "http://127.0.0.1:$PORT/api/health" && { echo ""; HEALTHY=1; } || echo "FAILED"

echo "=== Step 8: Save ==="
# Only persist a process list that actually has the app online. Saving a failed
# state is what makes a bad restart survive a reboot.
STATUS=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);console.log(p?p.pm2_env.status:"missing")}catch{console.log("unknown")}})' "$APP")
if [ "$STATUS" = "online" ]; then
    pm2 save
    echo "saved (status=online, health=$HEALTHY)"
else
    echo "NOT saving: $APP status is '$STATUS', not online."
    echo "Fix the app first; the previous saved list is still intact."
    exit 1
fi

echo "=== DONE ==="
