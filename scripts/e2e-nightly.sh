#!/usr/bin/env bash
# Nightly E2E test run against production.
#
# This was silently broken for an unknown period (MODULE_NOT_FOUND every night,
# logged to logs/e2e-nightly.log and read by nobody). Causes:
#
#   1. `npx playwright`: Playwright is a devDependency and production deploys run
#      `npm install --omit=dev`, so it is absent from the repo's node_modules.
#   2. The repo suite (tests/e2e/*.spec.ts) cannot run against production: its
#      specs import @playwright/test as ESM (NODE_PATH does not apply), fixtures.ts
#      boots an in-process server on TEST_DATABASE_URL, and the config's webkit and
#      firefox projects need browsers this script does not install.
#
# Fix: keep a pinned Playwright toolchain OUTSIDE the repo and run a small
# read-only smoke spec (scripts/e2e-nightly-smoke.spec.mjs) copied into it, so
# @playwright/test resolves. The full suite runs in CI (.github/workflows/e2e-web.yml).
# Keep PW_VERSION in step with package.json's @playwright/test.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(pwd)"

PW_VERSION="1.64.1"
TOOLCHAIN="${HOME}/.festie-e2e"

if [ ! -x "${TOOLCHAIN}/node_modules/.bin/playwright" ]; then
  echo "[e2e-nightly] provisioning Playwright ${PW_VERSION} toolchain in ${TOOLCHAIN}"
  mkdir -p "${TOOLCHAIN}"
  (
    cd "${TOOLCHAIN}"
    # Write package.json by hand: `npm init -y` names the package after the dir and
    # rejects ".festie-e2e" as an invalid name, which killed the script before
    # npm install ever ran (the toolchain dir stayed empty every night).
    [ -f package.json ] || echo '{"name":"festie-e2e-toolchain","private":true}' > package.json
    npm install --no-audit --no-fund --loglevel=error "@playwright/test@${PW_VERSION}"
    # Browsers only; --with-deps would need sudo, which cron does not have.
    ./node_modules/.bin/playwright install chromium
  )
fi

SPEC_NAME="festie-smoke.spec.mjs"
cp "${REPO}/scripts/e2e-nightly-smoke.spec.mjs" "${TOOLCHAIN}/${SPEC_NAME}"
export BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
cat > "${TOOLCHAIN}/playwright.config.mjs" <<'CFG'
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: /festie-smoke\.spec\.mjs/,
  timeout: 60_000,
  workers: 1,
  outputDir: 'test-results',
  use: { baseURL: process.env.BASE_URL, headless: true, serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
CFG

echo "[e2e-nightly] $(date -Is) starting against ${BASE_URL}"
cd "${TOOLCHAIN}"
status=0
./node_modules/.bin/playwright test --config=playwright.config.mjs --project=chromium --reporter=line || status=$?
echo "[e2e-nightly] $(date -Is) finished with exit=${status}"
exit "${status}"
