import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// Migration 121 adds the publish-request columns and the held-alert table. It runs twice without error, is
// ASCII only and holds no BEGIN or COMMIT (the runner wraps each file itself). Run on a private Postgres, never 5432 or 5433.

const SQL = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '121_organizer_review_and_held_alerts.sql'), 'utf8');

describe('migration 121 organizer review and held alerts', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const festivalId = `m121-fest-${Date.now()}`;

    before(async () => {
      await ensureTestSchema(TEST_DATABASE_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
    });

    after(async () => {
      await pool.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
      await pool.end();
    });

    test('runs again with no error and changes nothing', async () => {
      await pool.query(SQL);
      await pool.query(SQL);
    });

    test('the table takes the three kinds only, merges by set, and goes with its festival', async () => {
      await pool.query("INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, 'M121', 'x', NOW(), NOW())", [festivalId]);
      const insert = (kind: string) =>
        pool.query("INSERT INTO festival_held_schedule_changes (festival_id, set_id, kind, artist) VALUES ($1, 's1', $2, 'A')", [festivalId, kind]);
      await assert.rejects(insert('renamed'), { code: '23514' });
      await insert('entry_cancelled');
      await assert.rejects(insert('moved'), { code: '23505' }, 'one row per festival and set');
      const { rows } = await pool.query('SELECT picker_ids, interest_holder_ids, covered_set_ids FROM festival_held_schedule_changes WHERE festival_id = $1', [festivalId]);
      assert.deepEqual(rows[0], { picker_ids: [], interest_holder_ids: [], covered_set_ids: [] });
      await pool.query('DELETE FROM festivals WHERE id = $1', [festivalId]);
      assert.equal((await pool.query('SELECT 1 FROM festival_held_schedule_changes WHERE festival_id = $1', [festivalId])).rowCount, 0);
    });

    test('a festival starts with no request and no note', async () => {
      await pool.query("INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, 'M121', 'x', NOW(), NOW())", [festivalId]);
      const { rows } = await pool.query('SELECT publish_requested_at, publish_review_note FROM festivals WHERE id = $1', [festivalId]);
      assert.deepEqual(rows[0], { publish_requested_at: null, publish_review_note: null });
    });
  });
});
