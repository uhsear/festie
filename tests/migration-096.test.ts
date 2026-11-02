import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';

// Migration 096 (T54) adds the crew lock, the Home Base Plan B line and the
// meeting-point edit trail. It runs twice without error, and a hard delete of
// the editor clears edited_by instead of removing the point.
// Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '096_crew_lock_planb_mp_edits.sql'),
  'utf8',
);

describe('migration 096 crew lock, Plan B and edit trail', { skip }, () => {
  let pool: Pool;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  after(async () => {
    await pool.query("DELETE FROM crews WHERE id LIKE 'm096-%'").catch(() => {});
    await pool.query("DELETE FROM festivals WHERE id LIKE 'm096-%'").catch(() => {});
    await pool.query("DELETE FROM users WHERE id LIKE 'm096-%'").catch(() => {});
    await pool.end();
  });

  test('applies twice and adds the five columns', async () => {
    await pool.query(SQL);
    await pool.query(SQL);

    const { rows } = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE (table_name = 'crews' AND column_name IN ('invite_locked', 'home_base_plan_b'))
          OR (table_name = 'crew_meeting_points' AND column_name IN ('edited_by', 'edited_at', 'edit_was'))
       ORDER BY table_name, column_name`,
    );
    const byName = Object.fromEntries(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));
    assert.equal(rows.length, 5);
    assert.equal(byName['crews.invite_locked'].data_type, 'boolean');
    assert.equal(byName['crews.invite_locked'].is_nullable, 'NO');
    assert.equal(byName['crews.home_base_plan_b'].data_type, 'text');
    assert.equal(byName['crew_meeting_points.edited_by'].data_type, 'text');
    assert.equal(byName['crew_meeting_points.edited_at'].data_type, 'timestamp with time zone');
    assert.equal(byName['crew_meeting_points.edit_was'].data_type, 'jsonb');
  });

  test('invite_locked defaults to false and a hard-deleted editor leaves the point', async () => {
    await pool.query(SQL);
    for (const u of ['owner', 'editor']) {
      await pool.query(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING',
        [`m096-${u}`, `m096-${u}`, 'x'],
      );
    }
    await pool.query("INSERT INTO festivals (id, name) VALUES ('m096-f1', 'M096 Fest') ON CONFLICT DO NOTHING");
    await pool.query(
      "INSERT INTO crews (id, festival_id, name, created_by, invite_code, max_members) VALUES ('m096-c1', 'm096-f1', 'C', 'm096-owner', 'M096C1', 10)",
    );
    const crew = await pool.query("SELECT invite_locked, home_base_plan_b FROM crews WHERE id = 'm096-c1'");
    assert.equal(crew.rows[0].invite_locked, false);
    assert.equal(crew.rows[0].home_base_plan_b, null);

    await pool.query(
      `INSERT INTO crew_meeting_points (id, crew_id, created_by, label, location, type, active, edited_by, edited_at, edit_was, created_at, updated_at)
       VALUES ('m096-mp1', 'm096-c1', 'm096-owner', 'Meet', 'South gate', 'during', TRUE, 'm096-editor', NOW(), '{"location":"North gate"}'::jsonb, NOW(), NOW())`,
    );
    await pool.query("DELETE FROM users WHERE id = 'm096-editor'");

    const mp = await pool.query("SELECT edited_by, edit_was FROM crew_meeting_points WHERE id = 'm096-mp1'");
    assert.equal(mp.rows.length, 1, 'the point survives the editor hard delete');
    assert.equal(mp.rows[0].edited_by, null);
    assert.deepEqual(mp.rows[0].edit_was, { location: 'North gate' });
  });
});
