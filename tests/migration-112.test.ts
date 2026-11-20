import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// Migration 112 guards artists.merge_refs and indexes artists.merged_into. It runs twice without
// error, keeps data written between the runs, is ASCII only and holds no BEGIN or COMMIT (the runner
// wraps each file itself). Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '112_artists_merge_refs.sql'),
  'utf8',
);

describe('migration 112 artists merge refs', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const stamp = Date.now();
    const [survivor, loser] = [`art-m112-a-${stamp}`, `art-m112-b-${stamp}`] as [string, string];

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
    });

    after(async () => {
      await pool.query('DELETE FROM artists WHERE id = $1', [loser]);
      await pool.query('DELETE FROM artists WHERE id = $1', [survivor]);
      await pool.end();
    });

    test('applies twice, keeps a tombstone with its merge_refs, and indexes merged_into', async () => {
      await pool.query(SQL);
      await pool.query("INSERT INTO artists (id, name, name_key) VALUES ($1, 'M112 A', $1)", [survivor]);
      await pool.query(
        `INSERT INTO artists (id, name, name_key, merged_into, merge_refs) VALUES ($1, 'M112 B', $1, $2, '{"sets":[]}'::jsonb)`,
        [loser, survivor],
      );
      await pool.query(SQL);
      const { rows } = await pool.query('SELECT merged_into, merge_refs FROM artists WHERE id = $1', [loser]);
      assert.equal(rows[0].merged_into, survivor);
      assert.deepEqual(rows[0].merge_refs, { sets: [] });
      const { rows: column } = await pool.query(
        `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'artists' AND column_name = 'merge_refs'`,
      );
      assert.deepEqual(column, [{ data_type: 'jsonb', is_nullable: 'YES' }]);
      const { rows: indexes } = await pool.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'artists' AND indexname = 'idx_artists_merged_into'`);
      assert.equal(indexes.length, 1);
      assert.match(indexes[0].indexdef, /\(merged_into\).*merged_into IS NOT NULL/);
    });
  });
});
