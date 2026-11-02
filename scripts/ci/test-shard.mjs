// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Runs one CI shard of the backend suite under c8.
// Usage: node scripts/ci/test-shard.mjs <shard> <total>
// Files are split greedily by size, a stable proxy for run time, so every
// shard gets a similar load and every file lands in exactly one shard.
// The coverage floors are checked once, on the merged report, by the `test` job.

import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function assignShards(files, total) {
  const shards = Array.from({ length: total }, () => ({ size: 0, files: [] }));
  const bySize = [...files].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  for (const file of bySize) {
    const lightest = shards.reduce((min, s) => (s.size < min.size ? s : min));
    lightest.files.push(file.name);
    lightest.size += file.size;
  }
  return shards.map((s) => s.files.sort());
}

function main() {
  const shard = Number(process.argv[2]);
  const total = Number(process.argv[3]);
  if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total) {
    console.error('Usage: node scripts/ci/test-shard.mjs <shard> <total>, with 1 <= shard <= total.');
    process.exit(2);
  }

  const dir = 'tests';
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => ({ name: path.posix.join(dir, f), size: statSync(path.join(dir, f)).size }));
  const shards = assignShards(files, total);

  const assigned = shards.flat();
  if (assigned.length !== files.length || new Set(assigned).size !== files.length) {
    console.error(`Shard split lost or duplicated files: ${assigned.length} assigned, ${files.length} found.`);
    process.exit(2);
  }

  const mine = shards[shard - 1];
  console.log(`Shard ${shard}/${total}: ${mine.length} of ${files.length} files`);
  for (const f of mine) console.log(`  ${f}`);

  const result = spawnSync(
    'npx',
    [
      'c8',
      '--check-coverage=false',
      '--reporter=text-summary',
      'node',
      '--import',
      'tsx/esm',
      '--test',
      '--test-force-exit',
      '--test-concurrency=1',
      ...mine,
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  process.exit(result.status ?? 1);
}

main();
