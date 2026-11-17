import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  __resetMigrationCacheForTests,
  runPostgresMigrationsWithConnectRetry,
} from '../lib/planner-db-pg';

// The retry logic only. A fake pool stands in for Postgres, so this does not
// prove the process survives an unreachable database; the boot measurement in
// the PR does.

function refusal(code: string) {
  return Object.assign(new Error(`connect failed (${code})`), { code });
}

function fakePool(failures: Error[]) {
  const pending = [...failures];
  const pool = {
    connectCalls: 0,
    connect: async () => {
      pool.connectCalls++;
      const failure = pending.shift();
      if (failure) throw failure;
      return { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
    },
  };
  return pool;
}

describe('migration boot connect retry', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  beforeEach(() => {
    sleeps.length = 0;
    __resetMigrationCacheForTests();
  });

  test('retries ECONNREFUSED twice, then succeeds', async () => {
    const pool = fakePool([refusal('ECONNREFUSED'), refusal('ECONNREFUSED')]);
    const result = await runPostgresMigrationsWithConnectRetry(pool, { sleep });
    assert.equal(pool.connectCalls, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
    assert.ok(Array.isArray(result.applied));
  });

  test('retries SQLSTATE 57P03 (database starting up)', async () => {
    const pool = fakePool([refusal('57P03')]);
    await runPostgresMigrationsWithConnectRetry(pool, { sleep });
    assert.equal(pool.connectCalls, 2);
    assert.deepEqual(sleeps, [1000]);
  });

  test('does not retry other errors', async () => {
    const pool = fakePool([refusal('28P01')]);
    await assert.rejects(runPostgresMigrationsWithConnectRetry(pool, { sleep }), { code: '28P01' });
    assert.equal(pool.connectCalls, 1);
    assert.deepEqual(sleeps, []);
  });

  test('gives up with the original error once the wait budget is spent', async () => {
    const pool = fakePool(Array.from({ length: 50 }, () => refusal('ECONNREFUSED')));
    await assert.rejects(runPostgresMigrationsWithConnectRetry(pool, { sleep, maxWaitMs: 10_000 }), {
      code: 'ECONNREFUSED',
    });
    assert.equal(
      sleeps.reduce((a, b) => a + b, 0),
      10_000,
    );
    assert.deepEqual(sleeps.slice(0, 4), [1000, 2000, 4000, 3000]);
  });
});
