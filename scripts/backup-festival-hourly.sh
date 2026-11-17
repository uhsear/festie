#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# backup-festival-hourly.sh -- hourly dump plus off-site push during a festival
#
# Runs only while the flag file ~/.festie-festival-mode exists; otherwise it
# exits 0 at once. Install the line permanently and toggle with the flag:
#   20 * * * * cd /home/asir/festival-planner && bash scripts/backup-festival-hourly.sh >> logs/backup-festival.log 2>&1
# (minute 20 stays clear of the 0 */6 dump and the 01:30 off-site push)
#
# Runs backup-pg.sh, then backup-offsite-git.sh, each with BACKUP_LOCK_WAIT=0.
# Exit 75 from either script means another backup holds the lock: this
# wrapper logs a skip and exits 0. It takes no lock of its own, so it
# cannot deadlock the scripts it calls. Any other failure exits with that code.
# ─────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FLAG="$HOME/.festie-festival-mode"

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }

[ -f "$FLAG" ] || exit 0

for step in backup-pg.sh backup-offsite-git.sh; do
  BACKUP_LOCK_WAIT=0 bash "$SCRIPT_DIR/$step"
  rc=$?
  if [ "$rc" -eq 75 ]; then
    log "SKIP: $step reports another backup is running (exit 75)"
    exit 0
  fi
  if [ "$rc" -ne 0 ]; then
    log "ERROR: $step exited $rc"
    exit "$rc"
  fi
done
log "Festival hourly backup complete"
