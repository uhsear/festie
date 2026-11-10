// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Bundle growth gate for the web build.
// Usage: node scripts/ci/bundle-compare.mjs [--update] [--dist <dir>] [--config <file>] [--baseline <file>]
// Reads the same groups bundlemon tracks (packages/web/.bundlemonrc.json), sums the
// gzip size of each group's files in packages/web/dist, and compares with the
// committed packages/web/bundle-baseline.json. A group fails only when it grows by
// more than 5% AND more than 2 KB, so tiny groups do not trip on noise.
// --update rewrites the baseline from the current build.
// Each file belongs to the first group whose pattern matches it, like bundlemon.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_PERCENT = 5;
export const MAX_BYTES = 2048;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'packages', 'web');

const escapeRegex = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// shortcut: supports only `<label>`, `**` and `*`, the syntax .bundlemonrc.json uses today.
export function patternToRegex(pattern, pathLabels = {}) {
  let source = '';
  for (let i = 0; i < pattern.length; ) {
    const label = /^<([^>]+)>/.exec(pattern.slice(i));
    if (label && pathLabels[label[1]]) {
      source += `(?:${pathLabels[label[1]]})`;
      i += label[0].length;
    } else if (pattern.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      source += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      source += '[^/]*';
      i += 1;
    } else {
      source += escapeRegex(pattern[i]);
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

// files: [{ path, bytes }] with posix paths relative to the dist dir.
export function groupSizes(files, patterns, pathLabels = {}) {
  const matchers = patterns.map((p) => ({ pattern: p, regex: patternToRegex(p, pathLabels) }));
  const groups = Object.fromEntries(patterns.map((p) => [p, { bytes: 0, files: 0 }]));
  for (const file of files) {
    const hit = matchers.find((m) => m.regex.test(file.path));
    if (!hit) continue;
    groups[hit.pattern].bytes += file.bytes;
    groups[hit.pattern].files += 1;
  }
  return groups;
}

export function compareGroups(baseline, current, { maxPercent = MAX_PERCENT, maxBytes = MAX_BYTES } = {}) {
  const rows = [];
  for (const name of Object.keys(current)) {
    const now = current[name].bytes;
    const base = baseline[name]?.bytes;
    if (base === undefined) {
      rows.push({ name, base: null, now, delta: null, percent: null, status: 'new' });
      continue;
    }
    const delta = now - base;
    const percent = base === 0 ? (delta > 0 ? Infinity : 0) : (delta / base) * 100;
    const status = delta > maxBytes && percent > maxPercent ? 'fail' : 'ok';
    rows.push({ name, base, now, delta, percent, status });
  }
  for (const name of Object.keys(baseline)) {
    if (!(name in current)) rows.push({ name, base: baseline[name].bytes, now: null, delta: null, percent: null, status: 'missing' });
  }
  return { rows, failed: rows.some((r) => r.status === 'fail') };
}

const kb = (n) => (n === null ? '-' : `${(n / 1024).toFixed(2)} KB`);
const signed = (n) => (n === null ? '-' : `${n >= 0 ? '+' : '-'}${(Math.abs(n) / 1024).toFixed(2)} KB`);
const pct = (n) => (n === null ? '-' : `${n >= 0 ? '+' : ''}${Number.isFinite(n) ? n.toFixed(1) : 'inf'}%`);

export function renderTable(rows) {
  const cells = [['group', 'baseline', 'now', 'delta', 'percent', 'status']];
  for (const r of rows) cells.push([r.name, kb(r.base), kb(r.now), signed(r.delta), pct(r.percent), r.status.toUpperCase()]);
  const widths = cells[0].map((_, c) => Math.max(...cells.map((row) => row[c].length)));
  return cells.map((row) => row.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd()).join('\n');
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, base);
    return [{ path: path.relative(base, full).split(path.sep).join('/'), full }];
  });
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const config = JSON.parse(readFileSync(path.resolve(flag('--config') ?? path.join(WEB, '.bundlemonrc.json')), 'utf8'));
  const dist = path.resolve(flag('--dist') ?? path.join(WEB, config.baseDir ?? 'dist'));
  const baselinePath = path.resolve(flag('--baseline') ?? path.join(WEB, 'bundle-baseline.json'));

  if (!existsSync(dist)) {
    console.error(`No build found at ${dist}. Run: pnpm --dir packages --filter @festie/web build`);
    process.exit(2);
  }
  const files = listFiles(dist).map((f) => ({ path: f.path, bytes: gzipSync(readFileSync(f.full), { level: 9 }).length }));
  const current = groupSizes(files, config.files.map((f) => f.path), config.pathLabels);

  if (args.includes('--update')) {
    writeFileSync(baselinePath, `${JSON.stringify({ compression: 'gzip', groups: current }, null, 2)}\n`);
    console.log(`Wrote ${path.relative(ROOT, baselinePath)} (${Object.keys(current).length} groups).`);
    return;
  }

  if (!existsSync(baselinePath)) {
    console.error(`No baseline at ${baselinePath}. Create it with: node scripts/ci/bundle-compare.mjs --update`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).groups ?? {};
  const { rows, failed } = compareGroups(baseline, current);
  console.log(renderTable(rows));
  if (failed) {
    console.error(`\nBundle grew by more than ${MAX_PERCENT}% and ${MAX_BYTES / 1024} KB in a group marked FAIL. Shrink it, or if the growth is intended, run: node scripts/ci/bundle-compare.mjs --update`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
