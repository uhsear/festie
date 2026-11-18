import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema } from './_test-schema';

// Migration 105 adds festival_profiles.interests_json (JSONB, default {}). It runs twice without
// error, keeps data written between the runs, is ASCII only and holds no BEGIN or COMMIT (the runner
// wraps each file itself).
// Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '105_profile_interests.sql'),
  'utf8',
);

describe('migration 105 profile interests', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const festivalId = `mig105-f-${Date.now()}`;
    const profileId = `mig105-p-${Date.now()}`;
    const userId = `mig105-u-${Date.now()}`;

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL as string);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
    });

    after(async () => {
      await pool.query('DELETE FROM festival_profiles WHERE id = $1', [profileId]);
      await pool.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    });

    test('applies twice, adds a NOT NULL JSONB column that defaults to {}', async () => {
      await pool.query(SQL);
      await pool.query(SQL);
      const { rows } = await pool.query(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'festival_profiles' AND column_name = 'interests_json'`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].data_type, 'jsonb');
      assert.equal(rows[0].is_nullable, 'NO');
      assert.match(rows[0].column_default, /'\{\}'::jsonb/);
    });

    test('an existing row reads {} and a re-run keeps saved marks', async () => {
      await pool.query(`INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, 'M105', 'x', NOW(), NOW())`, [festivalId]);
      await pool.query(`INSERT INTO users (id, username, created_at) VALUES ($1, $2, NOW())`, [userId, userId]);
      await pool.query(`INSERT INTO festival_profiles (id, festival_id, user_id, name) VALUES ($1, $2, $3, 'p')`, [profileId, festivalId, userId]);
      const read = async () => (await pool.query('SELECT interests_json FROM festival_profiles WHERE id = $1', [profileId])).rows[0].interests_json;
      assert.deepEqual(await read(), {});
      await pool.query(`UPDATE festival_profiles SET interests_json = '{"lu-1":{"state":"open"}}'::jsonb WHERE id = $1`, [profileId]);
      await pool.query(SQL);
      assert.deepEqual(await read(), { 'lu-1': { state: 'open' } });
    });
  });
});
