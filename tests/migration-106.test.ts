import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';

// Migration 106 adds festival_time_releases and backfills it from festivals.set_times_out_at. It runs
// twice without error, gives a row only to a dated day that has a timed set, never touches a festival
// whose alert has not gone out, keeps rows written between runs, is ASCII only and holds no BEGIN or
// COMMIT (the runner wraps each file itself).
// Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '106_festival_time_releases.sql'),
  'utf8',
);

describe('migration 106 festival time releases', () => {
  test('the file is ASCII only and has no transaction control', () => {
    assert.equal(/[^\x00-\x7F]/.test(SQL), false);
    assert.equal(/^\s*(BEGIN|COMMIT)\b/im.test(SQL), false);
  });

  describe('on a database', { skip }, () => {
    let pool: Pool;
    const SENT = 'm106-sent';
    const NEVER = 'm106-never';
    const ids = [SENT, NEVER];
    const MARKER = '2026-11-01T12:00:00.000Z';

    const days = async (festivalId: string) =>
      (
        await pool.query(
          'SELECT day_date, event_key, claimed_at, sent_at, recipients FROM festival_time_releases WHERE festival_id = $1 ORDER BY day_date',
          [festivalId],
        )
      ).rows;

    async function seed() {
      for (const id of ids) {
        await pool.query(
          `INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, 'M106', 'x', NOW(), NOW())`,
          [id],
        );
        await pool.query(
          `INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, 'main', 'Main', '#ff3366', 0)`,
          [id],
        );
        // Day 0 and 1 hold timed sets, day 2 only untimed sets, day 3 has no date, day 4 has no sets.
        const dates = ['2027-02-05', '2027-02-06', '2027-02-07', '', '2027-02-09'];
        for (let i = 0; i < dates.length; i++) {
          await pool.query('INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4)', [
            id,
            i,
            `Day ${i}`,
            dates[i],
          ]);
        }
        const sets: Array<[number, string | null]> = [
          [0, '20:00'],
          [1, '21:00'],
          [1, null],
          [2, null],
          [2, ''],
          [3, '22:00'],
        ];
        for (let i = 0; i < sets.length; i++) {
          await pool.query(
            `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, sort_order) VALUES ($1, $2, $3, 'A', 'main', $4, $5)`,
            [`${id}-s${i}`, id, sets[i]![0], sets[i]![1], i],
          );
        }
      }
      await pool.query('UPDATE festivals SET set_times_out_at = $2 WHERE id = $1', [SENT, MARKER]);
    }

    async function clean() {
      for (const id of ids) {
        await pool.query('DELETE FROM festival_sets WHERE festival_id = $1', [id]);
        await pool.query('DELETE FROM festival_days WHERE festival_id = $1', [id]);
        await pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [id]);
        await pool.query('DELETE FROM festivals WHERE id = $1', [id]);
      }
    }

    before(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL });
      await clean();
      await seed();
    });

    after(async () => {
      await clean();
      await pool.end();
    });

    test('applies twice and creates the table with a composite key and a cascade', async () => {
      await pool.query(SQL);
      await pool.query(SQL);
      const { rows } = await pool.query(
        `SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_name = 'festival_time_releases' ORDER BY ordinal_position`,
      );
      assert.deepEqual(rows.map((r: any) => [r.column_name, r.is_nullable]), [
        ['festival_id', 'NO'],
        ['day_date', 'NO'],
        ['event_key', 'NO'],
        ['note', 'YES'],
        ['claimed_at', 'NO'],
        ['sent_at', 'YES'],
        ['recipients', 'YES'],
      ]);
      const fk = await pool.query(
        `SELECT confdeltype FROM pg_constraint WHERE conrelid = 'festival_time_releases'::regclass AND contype = 'f'`,
      );
      assert.deepEqual(fk.rows.map((r: any) => r.confdeltype), ['c'], 'ON DELETE CASCADE');
    });

    test('the backfill gives a row only to a dated day with a timed set, stamped as sent at the old marker', async () => {
      await pool.query('DELETE FROM festival_time_releases WHERE festival_id = ANY($1::text[])', [ids]);
      await pool.query(SQL);
      const rows = await days(SENT);
      assert.deepEqual(rows.map((r: any) => r.day_date), ['2027-02-05', '2027-02-06']);
      for (const row of rows) {
        assert.equal(row.event_key, `times:${SENT}`);
        assert.equal(new Date(row.sent_at).toISOString(), MARKER);
        assert.equal(new Date(row.claimed_at).toISOString(), MARKER);
        assert.equal(row.recipients, null);
      }
    });

    test('a festival whose alert has not gone out gets no row, so nothing can send for it', async () => {
      assert.deepEqual(await days(NEVER), []);
    });

    test('running it again changes nothing and keeps a row written in between', async () => {
      await pool.query(
        `INSERT INTO festival_time_releases (festival_id, day_date, event_key, note) VALUES ($1, '2027-02-07', 'times:m106-sent:new', 'hello')`,
        [SENT],
      );
      const before = await days(SENT);
      await pool.query(SQL);
      await pool.query(SQL);
      assert.deepEqual(await days(SENT), before);
      assert.equal(before.length, 3);
    });
  });
});
