// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('test-shard exits 2 in CI when TEST_DATABASE_URL is empty', () => {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1' };
  delete env.TEST_DATABASE_URL;
  const result = spawnSync('node', ['scripts/ci/test-shard.mjs', '1', '4'], { env, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TEST_DATABASE_URL is not set in CI/);
});
