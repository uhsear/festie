import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import createNotificationsStore from '../lib/db/stores/notifications.js';

// Migration 100 adds notification_preferences.crew_nudges, the own opt-out for
// crew nudges. It runs twice without error and defaults to 1. The store reads a
// row saved before it (NULL) as opted in.
// Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '100_crew_nudge_pref.sql'),
  'utf8',
);

describe('migration 100 crew nudge preference', { skip }, () => {
  let pool: Pool;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  after(async () => {
    await pool.end();
  });

  test('applies twice and adds crew_nudges INTEGER DEFAULT 1', async () => {
    await pool.query(SQL);
    await pool.query(SQL);

    const { rows } = await pool.query(
      `SELECT data_type, column_default FROM information_schema.columns
       WHERE table_name = 'notification_preferences' AND column_name = 'crew_nudges'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].data_type, 'integer');
    assert.equal(rows[0].column_default, '1');
  });

  test('the store reads NULL as on and round-trips off', async () => {
    const store = createNotificationsStore(pool, {}).notificationPrefs;
    const userId = `mig100-${Date.now()}`;
    await pool.query('INSERT INTO users (id, username, created_at) VALUES ($1, $2, NOW())', [userId, userId]);
    try {
      await pool.query('INSERT INTO notification_preferences (user_id, crew_nudges) VALUES ($1, NULL)', [userId]);
      assert.equal((await store.get(userId)).crewNudges, 1);

      await store.upsert({ userId, crewUpdates: true, crewNudges: false });
      const prefs = await store.get(userId);
      assert.equal(prefs.crewNudges, 0);
      assert.equal(prefs.crewUpdates, 1);
    } finally {
      await pool.query('DELETE FROM notification_preferences WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
});
