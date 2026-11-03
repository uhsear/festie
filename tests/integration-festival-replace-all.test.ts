import 'dotenv/config';
/**
 * Integration test: festivals.replaceAll keeps per-set user data, like update().
 * Deleting stage rows first cascaded into festival_sets (festival_sets_stage_fkey),
 * so a pick or note on any set made the save fail on its foreign key.
 *
 * Skip-gate on TEST_DATABASE_URL. replaceAll deletes every festival missing from its
 * list, so the test runs inside one outer transaction and rolls it back. The wrapper also
 * scopes that prune to this run's festival, so rows other test files leave behind can't block it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Pool } from 'pg';
import createFestivalsStore from '../lib/db/stores/festivals';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const RUN_ID = `fra${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const STAGE = `main-${RUN_ID}`;
const OLD_STAGE = `old-${RUN_ID}`;
const SET_ID = `set-${RUN_ID}`;
const PROFILE_ID = `prof-${RUN_ID}`;
const USER_ID = `user-${RUN_ID}`;

/**
 * A pool whose transactions become savepoints inside the caller's open transaction.
 * It limits replaceAll's prune of unlisted festivals to this run's rows.
 */
function savepointPool(client: any): any {
  const map: Record<string, string> = {
    BEGIN: 'SAVEPOINT replace_all',
    COMMIT: 'RELEASE SAVEPOINT replace_all',
    ROLLBACK: 'ROLLBACK TO SAVEPOINT replace_all',
  };
  return {
    connect: async () => ({
      query: (sql: any, params: any[] = []) =>
        typeof sql === 'string' && sql.startsWith('DELETE FROM festivals WHERE id NOT IN')
          ? client.query(`${sql} AND id LIKE $${params.length + 1}`, [...params, `fest-${RUN_ID}%`])
          : client.query(map[sql] ?? sql, params),
      release: () => {},
    }),
  };
}

async function seed(client: any) {
  await client.query(`INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, 'RA', '', NOW(), NOW())`, [
    FEST_ID,
  ]);
  await client.query(
    `INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, 'Main', '#ff3366', 0), ($1, $3, 'Old', '#000000', 1)`,
    [FEST_ID, STAGE, OLD_STAGE],
  );
  await client.query(`INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, 'Friday', '2026-08-21')`, [
    FEST_ID,
  ]);
  await client.query(
    `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists)
     VALUES ($1, $2, 0, 'Kept', $3, '20:00', '21:00', 0, '[]')`,
    [SET_ID, FEST_ID, STAGE],
  );
  await client.query(
    `INSERT INTO users (id, username, password_hash, created_at, tos_accepted_at, tos_version) VALUES ($1, $2, 'x', NOW(), NOW(), 1)`,
    [USER_ID, `fra-${RUN_ID}-user`],
  );
  await client.query(
    `INSERT INTO festival_profiles (id, festival_id, user_id, name, created_at, updated_at) VALUES ($1, $2, $3, 'Keeper', NOW(), NOW())`,
    [PROFILE_ID, FEST_ID, USER_ID],
  );
  await client.query(`INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, 'must')`, [
    PROFILE_ID,
    SET_ID,
  ]);
  await client.query(`INSERT INTO festival_profile_notes (profile_id, set_id, text) VALUES ($1, $2, 'bring earplugs')`, [
    PROFILE_ID,
    SET_ID,
  ]);
}

describe('festivals.replaceAll keeps per-set user data', { skip }, () => {
  test('keeps picks and notes on surviving sets and drops stages missing from the payload', async () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await seed(client);
      const store: any = createFestivalsStore(savepointPool(client), { buildFestivalRecords: () => [] });
      await store.replaceAll([
        {
          id: FEST_ID,
          name: 'RA',
          stages: [{ id: STAGE, name: 'Main', color: '#ff3366' }],
          days: [
            {
              label: 'Friday',
              date: '2026-08-21',
              sets: [{ id: SET_ID, artist: 'Kept', stageId: STAGE, startTime: '20:00', endTime: '21:00' }],
            },
          ],
        },
      ]);
      const picks = await client.query('SELECT set_id, priority FROM festival_profile_picks WHERE profile_id = $1', [
        PROFILE_ID,
      ]);
      assert.deepEqual(picks.rows, [{ set_id: SET_ID, priority: 'must' }]);
      const notes = await client.query('SELECT set_id, text FROM festival_profile_notes WHERE profile_id = $1', [PROFILE_ID]);
      assert.deepEqual(notes.rows, [{ set_id: SET_ID, text: 'bring earplugs' }]);
      const stages = await client.query('SELECT id FROM festival_stages WHERE festival_id = $1', [FEST_ID]);
      assert.deepEqual(stages.rows, [{ id: STAGE }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
});
