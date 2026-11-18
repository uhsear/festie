import 'dotenv/config';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { withTransactionRetry } from '../lib/db/connection';

// A pool whose clients record every statement. No database is needed: the helper only
// sends BEGIN, COMMIT and ROLLBACK itself and passes the client to fn.
function fakePool() {
  const statements: string[] = [];
  let released = 0;
  const pool: any = {
    connect: async () => ({
      query: async (sql: string) => {
        statements.push(sql);
        return { rows: [] };
      },
      release: () => {
        released += 1;
      },
    }),
  };
  return { pool, statements, released: () => released };
}

const abort = (code: string) => Object.assign(new Error(`aborted ${code}`), { code });

describe('withTransactionRetry', () => {
  test('returns the result of the first successful attempt without a retry', async () => {
    const { pool, statements } = fakePool();
    assert.equal(await withTransactionRetry(pool, async () => 'done'), 'done');
    assert.deepEqual(statements, ['BEGIN', 'COMMIT']);
  });

  test('retries a deadlock (40P01) and a serialization failure (40001), then commits', async () => {
    const { pool, statements, released } = fakePool();
    let calls = 0;
    const result = await withTransactionRetry(pool, async () => {
      calls += 1;
      if (calls === 1) throw abort('40P01');
      if (calls === 2) throw abort('40001');
      return calls;
    });
    assert.equal(result, 3);
    assert.deepEqual(statements, ['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
    assert.equal(released(), 3);
  });

  test('rethrows the last deadlock after the allowed attempts', async () => {
    const { pool } = fakePool();
    let calls = 0;
    await assert.rejects(
      withTransactionRetry(pool, async () => {
        calls += 1;
        throw abort('40P01');
      }, 2),
      { code: '40P01' },
    );
    assert.equal(calls, 2);
  });

  test('does not retry any other error', async () => {
    const { pool } = fakePool();
    let calls = 0;
    await assert.rejects(
      withTransactionRetry(pool, async () => {
        calls += 1;
        throw abort('23505');
      }),
      { code: '23505' },
    );
    assert.equal(calls, 1);
  });
});
