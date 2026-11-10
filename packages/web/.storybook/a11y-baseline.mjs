#!/usr/bin/env node
/**
 * Axe baseline ratchet for minor/moderate violations.
 *
 * test-runner.ts writes one JSON file per story into RESULTS_DIR (the runner uses
 * parallel workers, so no worker sees the whole run). This script merges them:
 *   node .storybook/a11y-baseline.mjs clean   empty RESULTS_DIR before a run
 *   node .storybook/a11y-baseline.mjs check   compare with a11y-baseline.json
 * With A11Y_BASELINE_UPDATE=1, `check` rewrites the baseline instead of failing.
 * Regenerate: pnpm build-storybook && A11Y_BASELINE_UPDATE=1 pnpm test-storybook:ci
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, formatDiff, mergeResults, serializeBaseline } from './a11y-baseline-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = process.env.A11Y_RESULTS_DIR ?? path.resolve(here, '../.a11y-results');
const BASELINE_FILE = path.resolve(here, 'a11y-baseline.json');

function readResults() {
  let files;
  try {
    files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }
  return files.map((f) => JSON.parse(readFileSync(path.join(RESULTS_DIR, f), 'utf8')));
}

function check() {
  const results = readResults();
  if (!results.length) {
    console.error(`[a11y-baseline] No story results in ${RESULTS_DIR}. Run test-storybook first (pnpm test-storybook:ci).`);
    process.exit(1);
  }
  const current = mergeResults(results);

  if (process.env.A11Y_BASELINE_UPDATE === '1') {
    writeFileSync(BASELINE_FILE, serializeBaseline(current));
    console.log(
      `[a11y-baseline] Wrote ${BASELINE_FILE} from ${results.length} stories (${Object.keys(current).length} with violations).`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  } catch (err) {
    console.error(`[a11y-baseline] Cannot read ${BASELINE_FILE}: ${err.message}. Generate it with A11Y_BASELINE_UPDATE=1.`);
    process.exit(1);
  }

  const { regressions, improvements } = compareToBaseline(current, baseline);
  if (improvements.length) {
    console.log(`[a11y-baseline] ${improvements.length} rule(s) improved; refresh with A11Y_BASELINE_UPDATE=1 to lock it in:`);
    for (const d of improvements) console.log(`  ${formatDiff(d)}`);
  }
  if (regressions.length) {
    console.error(`[a11y-baseline] ${regressions.length} minor/moderate axe regression(s) above the baseline:`);
    for (const d of regressions) console.error(`  ${formatDiff(d)}`);
    console.error('Fix them. If intentional, run A11Y_BASELINE_UPDATE=1 pnpm test-storybook:ci and commit a11y-baseline.json.');
    process.exit(1);
  }
  console.log(`[a11y-baseline] OK: ${results.length} stories within baseline.`);
}

const command = process.argv[2];
if (command === 'clean') {
  rmSync(RESULTS_DIR, { recursive: true, force: true });
  mkdirSync(RESULTS_DIR, { recursive: true });
} else if (command === 'check') {
  check();
} else {
  console.error('Usage: node .storybook/a11y-baseline.mjs <clean|check>');
  process.exit(2);
}
