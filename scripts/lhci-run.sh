#!/usr/bin/env bash
# Phase 5 — On-demand Lighthouse CI run against festie.us.
# Uses Playwright's cached Chromium so we don't pull a second browser.
# Reports: ./lhci-reports/  (created by lhci autorun --upload.target=filesystem)
#
# Usage:
#   bash scripts/lhci-run.sh              # run against festie.us
#   bash scripts/lhci-run.sh localhost    # run against http://localhost:4000
#
# Exit codes propagated from lhci autorun (non-zero on budget/assert failure).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Locate Playwright's chromium and export CHROME_PATH for lhci
PW_CACHE="$HOME/.cache/ms-playwright"
CHROME_BIN="$(find "$PW_CACHE" -maxdepth 4 -type f -name 'headless_shell' 2>/dev/null | head -1)"
if [ -z "$CHROME_BIN" ]; then
  CHROME_BIN="$(find "$PW_CACHE" -maxdepth 4 -type f -name 'chrome' 2>/dev/null | head -1)"
fi

if [ -n "$CHROME_BIN" ]; then
  export CHROME_PATH="$CHROME_BIN"
  echo "[lhci] using chromium at $CHROME_PATH"
else
  echo "[lhci] WARN: no Playwright chromium found; lhci will try to download its own"
fi

CONFIG="${REPO_ROOT}/config/lighthouserc.json"
if [ "${1:-}" = "localhost" ]; then
  CONFIG="${REPO_ROOT}/config/lighthouserc.localhost.json"
fi

if ! [ -f "$CONFIG" ]; then
  echo "[lhci] FATAL: config not found at $CONFIG"
  exit 2
fi

# Run both passes even when the first fails, then exit with the worse code.
DESKTOP_RC=0
npx --yes @lhci/cli@0.14.x autorun --config="$CONFIG" || DESKTOP_RC=$?

# Second run with Lighthouse's default mobile preset (slow 4G, 4x CPU), which is what festival-goers use.
# Measured mobile performance is 46-51 and mobile CLS 0.26, so the floors sit just under those numbers.
# mktemp -d plus a fixed file name: BSD mktemp has no --suffix.
MOBILE_DIR="$(mktemp -d)"
MOBILE_CONFIG="$MOBILE_DIR/lighthouserc.mobile.json"
trap 'rm -f "$MOBILE_CONFIG"; rmdir "$MOBILE_DIR"' EXIT
node -e '
const fs = require("fs");
const [src, dest] = process.argv.slice(1);
const c = JSON.parse(fs.readFileSync(src, "utf8"));
delete c.ci.collect.settings.preset;
c.ci.collect.numberOfRuns = 1;
Object.assign(c.ci.assert.assertions, {
  "categories:performance": ["error", { minScore: 0.4 }],
  "cumulative-layout-shift": ["error", { maxNumericValue: 0.3 }],
});
c.ci.upload.outputDir = c.ci.upload.outputDir + "-mobile";
fs.writeFileSync(dest, JSON.stringify(c));
' "$CONFIG" "$MOBILE_CONFIG"
MOBILE_RC=0
npx --yes @lhci/cli@0.14.x autorun --config="$MOBILE_CONFIG" || MOBILE_RC=$?

if [ "$DESKTOP_RC" -ne 0 ]; then exit "$DESKTOP_RC"; fi
exit "$MOBILE_RC"
