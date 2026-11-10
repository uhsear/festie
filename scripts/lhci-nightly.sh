#!/usr/bin/env bash
set -e
cd "$(cd "$(dirname "$0")/.." && pwd)"
TS=$(date +%Y%m%d-%H%M%S)
LOG=logs/lhci/${TS}.log
LOCK=/tmp/lhci-nightly.lock

# Skip if already running
if [ -f "$LOCK" ] && kill -0 "$(cat $LOCK)" 2>/dev/null; then
  echo "lhci-nightly: already running (pid $(cat $LOCK)), skipping" >&2
  exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

{
  echo "=== lhci-nightly $TS ==="
  status=0
  npm run lhci:localhost 2>&1 || status=$?
  echo "=== done $(date -Iseconds) exit=${status} ==="
  exit "${status}"
} >> "$LOG" 2>&1

# Retain only last 14 logs
ls -t logs/lhci/*.log 2>/dev/null | tail -n +15 | xargs -r rm -f
