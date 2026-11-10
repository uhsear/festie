// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Loaded by variable URL: the script is plain .mjs with no type declarations.
const mod: any = await import(pathToFileURL(resolve('scripts/ci/bundle-compare.mjs')).href);
const { patternToRegex, groupSizes, compareGroups, renderTable } = mod;

const labels = { hash: '[a-zA-Z0-9_-]+' };

test('patternToRegex expands labels and globs like bundlemon', () => {
  const entry = patternToRegex('assets/index-<hash>.js', labels);
  assert.ok(entry.test('assets/index-CBFimCwt.js'));
  assert.ok(!entry.test('assets/index-CBFimCwt.js.map'));
  assert.ok(!entry.test('assets/indexXCBFimCwt.js'));
  const all = patternToRegex('assets/**/*.js', labels);
  assert.ok(all.test('assets/a/b/c.js'));
  assert.ok(all.test('assets/c.js'));
  assert.ok(!all.test('assets/c.css'));
});

test('groupSizes assigns each file to the first matching group only', () => {
  const files = [
    { path: 'assets/index-abc.js', bytes: 100 },
    { path: 'assets/other-abc.js', bytes: 40 },
    { path: 'assets/other-abc.css', bytes: 7 },
    { path: 'index.html', bytes: 9 },
  ];
  const groups = groupSizes(files, ['assets/index-<hash>.js', 'assets/**/*.js', 'assets/**/*.css'], labels);
  assert.deepEqual(groups['assets/index-<hash>.js'], { bytes: 100, files: 1 });
  assert.deepEqual(groups['assets/**/*.js'], { bytes: 40, files: 1 });
  assert.deepEqual(groups['assets/**/*.css'], { bytes: 7, files: 1 });
});

test('compareGroups fails only when growth exceeds both 5% and 2 KB', () => {
  const baseline = {
    big: { bytes: 100_000 },
    small: { bytes: 10_000 },
    shrunk: { bytes: 50_000 },
    gone: { bytes: 1 },
  };
  const current = {
    big: { bytes: 100_000 + 6_000 },
    small: { bytes: 10_000 + 1_500 },
    shrunk: { bytes: 40_000 },
    fresh: { bytes: 5 },
  };
  const { rows, failed } = compareGroups(baseline, current);
  const status = Object.fromEntries(rows.map((r: any) => [r.name, r.status]));
  assert.equal(failed, true);
  assert.deepEqual(status, { big: 'fail', small: 'ok', shrunk: 'ok', fresh: 'new', gone: 'missing' });
});

test('compareGroups passes at the thresholds and on large absolute growth under 5%', () => {
  const at = compareGroups({ a: { bytes: 100_000 } }, { a: { bytes: 100_000 + 2048 } });
  assert.equal(at.failed, false);
  const lowPercent = compareGroups({ a: { bytes: 1_000_000 } }, { a: { bytes: 1_040_000 } });
  assert.equal(lowPercent.failed, false);
  const over = compareGroups({ a: { bytes: 100_000 } }, { a: { bytes: 105_001 } });
  assert.equal(over.failed, true);
});

test('renderTable prints every group with its status', () => {
  const { rows } = compareGroups({ a: { bytes: 1024 } }, { a: { bytes: 4096 } });
  const out = renderTable(rows);
  assert.match(out, /group\s+baseline\s+now\s+delta\s+percent\s+status/);
  assert.match(out, /a\s+1\.00 KB\s+4\.00 KB\s+\+3\.00 KB\s+\+300\.0%\s+FAIL/);
});
