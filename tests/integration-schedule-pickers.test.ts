import 'dotenv/config';
/**
 * Integration tests: profiles.pickersBySet reads pickers and reminder holders (T46 P2).
 * Covers: a pick-only user, a reminder-only user, a user with both (listed once),
 * a soft-deleted profile (left out) and a non-object reminders_json (ignored).
 *
 * Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID on teardown.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import createProfilesStore from '../lib/db/stores/profiles.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const RUN_ID = `tsp${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const STAGE = `main-${RUN_ID}`;
const SET_A = `a-${RUN_ID}`;
const SET_B = `b-${RUN_ID}`;
const USERS = ['pick', 'rem', 'both', 'gone', 'bad'].map((k) => `${RUN_ID}-${k}`);
const [PICK, REM, BOTH, GONE, BAD] = USERS as [string, string, string, string, string];
const profileId = (userId: string) => `prof-${userId}`;

let pool: any;

describe('profiles.pickersBySet', { skip }, () => {
  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(
      `INSERT INTO festivals (id, name, location, created_at, updated_at)
       VALUES ($1, 'Pickers Fest', 'Here', NOW(), NOW())`,
      [FEST_ID],
    );
    await pool.query(
      `INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, 'Main', '#ff3366', 0)`,
      [FEST_ID, STAGE],
    );
    await pool.query(
      `INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, 'Sat', '2026-08-22')`,
      [FEST_ID],
    );
    for (const [i, id] of [SET_A, SET_B].entries()) {
      await pool.query(
        `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order)
         VALUES ($1, $2, 0, $3, $4, '20:00', '21:00', $5)`,
        [id, FEST_ID, `Artist ${i}`, STAGE, i],
      );
    }
    const reminders: Record<string, string> = {
      [PICK]: '{}',
      [REM]: JSON.stringify({ [SET_A]: 15 }),
      [BOTH]: JSON.stringify({ [SET_A]: 15, [SET_B]: 30 }),
      [GONE]: JSON.stringify({ [SET_A]: 15 }),
      [BAD]: JSON.stringify([SET_A]),
    };
    for (const userId of USERS) {
      await pool.query(
        `INSERT INTO users (id, username, password_hash, created_at, tos_accepted_at, tos_version)
         VALUES ($1, $1, 'x', NOW(), NOW(), 1)`,
        [userId],
      );
      await pool.query(
        `INSERT INTO festival_profiles (id, festival_id, user_id, name, reminders_json, deleted_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'P', $4::jsonb, $5, NOW(), NOW())`,
        [profileId(userId), FEST_ID, userId, reminders[userId], userId === GONE ? new Date() : null],
      );
    }
    for (const [userId, setId] of [
      [PICK, SET_A],
      [BOTH, SET_A],
      [GONE, SET_B],
    ] as const) {
      await pool.query(`INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, 'must')`, [
        profileId(userId),
        setId,
      ]);
    }
  });

  after(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM festival_profile_picks WHERE profile_id = ANY ($1)', [USERS.map(profileId)]);
    await pool.query('DELETE FROM festival_profiles WHERE id = ANY ($1)', [USERS.map(profileId)]);
    await pool.query('DELETE FROM festival_sets WHERE id = ANY ($1)', [[SET_A, SET_B]]);
    await pool.query('DELETE FROM festival_days WHERE festival_id = $1', [FEST_ID]);
    await pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [FEST_ID]);
    await pool.query('DELETE FROM festivals WHERE id = $1', [FEST_ID]);
    await pool.query('DELETE FROM users WHERE id = ANY ($1)', [USERS]);
    await pool.end();
  });

  test('lists pickers and reminder holders once per set, without deleted profiles or non-object reminders', async () => {
    const { profiles } = createProfilesStore(pool, {});
    const bySet = await profiles.pickersBySet(FEST_ID, [SET_A, SET_B]);

    assert.deepEqual([...(bySet.get(SET_A) || [])].sort(), [BOTH, PICK, REM].sort());
    assert.deepEqual(bySet.get(SET_B), [BOTH]);
  });

  test('returns an empty map for no set ids', async () => {
    const { profiles } = createProfilesStore(pool, {});
    assert.equal((await profiles.pickersBySet(FEST_ID, [])).size, 0);
  });
});
