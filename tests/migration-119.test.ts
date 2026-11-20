import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { createStores } from '../lib/db/index.js';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// Migration 119 re-issues retention_cleanup() to purge old notification_log rows and the per-user crew
// rows that have no user FK (crew_member_status, crew_packing_items, crew_ride_offers). Run it only on a
// private Postgres, never 5432 or 5433.

const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '119_retention_cleanup.sql'),
  'utf8',
);

describe('migration 119 retention cleanup', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\s*;/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const s = `m119-${Date.now()}`;
    const [gone, keeper, hard] = [`${s}-gone`, `${s}-keeper`, `${s}-hard`];
    const crew = `${s}-crew`;
    const fest = `${s}-fest`;

    const count = async (table: string, col: string, id: string) =>
      Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = $1`, [id])).rows[0].n);

    async function seedUserRows(userId: string) {
      await pool.query('INSERT INTO crew_member_status (crew_id, user_id, status) VALUES ($1, $2, $3)', [crew, userId, 'here']);
      await pool.query('INSERT INTO crew_packing_items (id, crew_id, created_by, label) VALUES ($1, $2, $3, $4)', [`${userId}-p`, crew, userId, 'tent']);
      await pool.query('INSERT INTO crew_ride_offers (id, crew_id, created_by) VALUES ($1, $2, $3)', [`${userId}-r`, crew, userId]);
    }

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
      await pool.query(SQL);
      await pool.query(SQL);
      await pool.query("INSERT INTO users (id, username, display_name, created_at, deleted_at) VALUES ('deleted-user', '[deleted user]', 'Deleted user', NOW(), '9999-12-31T00:00:00Z') ON CONFLICT (id) DO NOTHING");
      for (const id of [keeper, hard]) await pool.query('INSERT INTO users (id, username, created_at) VALUES ($1, $2, NOW())', [id, id]);
      await pool.query('INSERT INTO festivals (id, name) VALUES ($1, $2)', [fest, fest]);
      await pool.query('INSERT INTO crews (id, festival_id, name, created_by, invite_code, max_members) VALUES ($1, $2, $4, $3, $5, 10)', [crew, fest, keeper, 'Crew', `${crew}-inv`]);
    });

    after(async () => {
      await pool.query('DELETE FROM crews WHERE id = $1', [crew]);
      await pool.query('DELETE FROM festivals WHERE id = $1', [fest]);
      await pool.query('DELETE FROM notification_log WHERE user_id = ANY($1)', [[gone, keeper, hard]]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [[gone, keeper, hard]]);
      await pool.end();
    });

    test('purges old notification_log rows and keeps recent ones', async () => {
      await pool.query("INSERT INTO notification_log (id, user_id, created_at) VALUES ($1, $3, now() - interval '100 days'), ($2, $3, now() - interval '1 day')", [`${s}-old`, `${s}-new`, keeper]);
      await pool.query('SELECT retention_cleanup()');
      assert.equal(await count('notification_log', 'id', `${s}-old`), 0);
      assert.equal(await count('notification_log', 'id', `${s}-new`), 1);
    });

    test('keeps old eventKey and news-type rows', async () => {
      await pool.query("INSERT INTO notification_log (id, user_id, type, data_json, created_at) VALUES ($1, $3, 'x', $4, now() - interval '200 days'), ($2, $3, 'lineup_drop', NULL, now() - interval '200 days')", [`${s}-key`, `${s}-news`, keeper, JSON.stringify({ eventKey: 'lineup:f' })]);
      await pool.query('SELECT retention_cleanup()');
      assert.equal(await count('notification_log', 'id', `${s}-key`), 1);
      assert.equal(await count('notification_log', 'id', `${s}-news`), 1);
    });

    test('retention_cleanup purges the crew rows of a purged user and keeps the others', async () => {
      // Created here: test 1 also runs retention_cleanup, which would purge it early.
      await pool.query("INSERT INTO users (id, username, created_at, deleted_at) VALUES ($1, $2, NOW(), now() - interval '40 days')", [gone, gone]);
      await seedUserRows(gone);
      await seedUserRows(keeper);
      await pool.query('SELECT retention_cleanup()');
      for (const [t, c] of [['crew_member_status', 'user_id'], ['crew_packing_items', 'created_by'], ['crew_ride_offers', 'created_by']] as const) {
        assert.equal(await count(t, c, gone), 0, `${t} of the purged user`);
        assert.equal(await count(t, c, keeper), 1, `${t} of a live user`);
      }
    });

    test('users.hardDelete purges the same rows', async () => {
      await seedUserRows(hard);
      await createStores(pool).users.hardDelete(hard);
      for (const [t, c] of [['crew_member_status', 'user_id'], ['crew_packing_items', 'created_by'], ['crew_ride_offers', 'created_by']] as const) {
        assert.equal(await count(t, c, hard), 0, t);
      }
    });
  });
});
