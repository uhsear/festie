import 'dotenv/config';
/**
 * The shared test schema (tests/_test-schema.ts) runs the production migration
 * runner, so every migration file on disk is applied and recorded. The DB cases
 * are gated like the integration suites: set TEST_DATABASE_URL to run them.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Pool } from 'pg';
import { discoverMigrationsOnDisk } from '../lib/planner-db-pg';
import { ensureTestSchema } from './_test-schema';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('ensureTestSchema', () => {
  test('refuses a database whose name does not end in _test, before connecting', async () => {
    // Port 9 is discard: a connection attempt would fail with a different error.
    await assert.rejects(ensureTestSchema('postgresql://u:p@127.0.0.1:9/festie'), /must end in "_test"/);
    await assert.rejects(ensureTestSchema('postgresql://u:p@127.0.0.1:9/festie_test_copy'), /must end in "_test"/);
  });

  test('records one schema_migrations row per migration file on disk', { skip }, async () => {
    await ensureTestSchema(TEST_DATABASE_URL!);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
      assert.equal(rows[0].n, discoverMigrationsOnDisk().length);
    } finally {
      await pool.end();
    }
  });

  test('applies 037_schema_fixes (festivals.name is NOT NULL)', { skip }, async () => {
    await ensureTestSchema(TEST_DATABASE_URL!);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query(
        "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'festivals' AND column_name = 'name'",
      );
      assert.equal(rows[0]?.is_nullable, 'NO');
    } finally {
      await pool.end();
    }
  });
});
