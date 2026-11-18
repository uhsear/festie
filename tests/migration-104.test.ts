import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';

// Migration 104 adds festivals.lineup (JSONB, default []). It runs twice without error,
// keeps data written between the runs, is ASCII only and holds no BEGIN or COMMIT (the runner
// wraps each file itself).
// Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '104_festival_lineup.sql'),
  'utf8',
);

describe('migration 104 festival lineup', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const id = `mig104-${Date.now()}`;

    before(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
    });

    after(async () => {
      await pool.query('DELETE FROM festivals WHERE id = $1', [id]);
      await pool.end();
    });

    test('applies twice, adds a NOT NULL JSONB column that defaults to []', async () => {
      await pool.query(SQL);
      await pool.query(SQL);
      const { rows } = await pool.query(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'festivals' AND column_name = 'lineup'`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].data_type, 'jsonb');
      assert.equal(rows[0].is_nullable, 'NO');
      assert.match(rows[0].column_default, /'\[\]'::jsonb/);
    });

    test('an existing row reads [] and a re-run keeps a saved lineup', async () => {
      await pool.query(`INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, 'M104', 'x', NOW(), NOW())`, [id]);
      assert.deepEqual((await pool.query('SELECT lineup FROM festivals WHERE id = $1', [id])).rows[0].lineup, []);
      await pool.query(`UPDATE festivals SET lineup = '[{"id":"lu-1"}]'::jsonb WHERE id = $1`, [id]);
      await pool.query(SQL);
      assert.deepEqual((await pool.query('SELECT lineup FROM festivals WHERE id = $1', [id])).rows[0].lineup, [{ id: 'lu-1' }]);
    });
  });
});
