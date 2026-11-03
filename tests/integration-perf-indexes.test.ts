import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';

import createPollsStore from '../lib/db/stores/polls.js';
import createCrewsStore from '../lib/db/stores/crews.js';

// Migration 099 (T58): the decided-polls branch of polls.listByCrew and
// meetingPoints.listRecentlyExpired use the new crew history indexes, and both
// queries return the same rows as before the migration.
// Run it only on a private Postgres (port 5434 or higher), never 5432 or 5433.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '099_crew_history_indexes.sql'),
  'utf8',
);
const CREWS = ['p099-c1', 'p099-c2', 'p099-c3'];
const FIRST = 'p099-c1';

// A pool stand-in that records the store's SQL so EXPLAIN runs the exact text.
function captureQuery(run: (pool: any) => Promise<unknown>) {
  const seen: { text: string; values: unknown[] }[] = [];
  const pool = { query: async (text: string, values: unknown[]) => { seen.push({ text, values }); return { rows: [] }; } };
  return run(pool).then(() => {
    assert.equal(seen.length, 1, 'the store sends one query');
    return seen[0]!;
  });
}

describe('crew history indexes (migration 099)', { skip, concurrency: 1 }, () => {
  let pool: Pool;

  const listPolls = (crewId: string) => createPollsStore(pool, {}).listByCrew(crewId);
  const listPast = (crewId: string) => createCrewsStore(pool, {}).meetingPoints.listRecentlyExpired(crewId);
  const readAll = async () => {
    const out: Record<string, unknown> = {};
    for (const id of CREWS) out[id] = { polls: await listPolls(id), past: await listPast(id) };
    return out;
  };

  async function explain(run: (p: any) => Promise<unknown>) {
    const { text, values } = await captureQuery(run);
    const client = await pool.connect();
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query(`EXPLAIN ${text}`, values);
      return rows.map((r: any) => r['QUERY PLAN']).join('\n');
    } finally {
      await client.query('RESET enable_seqscan').catch(() => {});
      client.release();
    }
  }

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES ('p099-u1', 'p099-u1', 'x', NOW()) ON CONFLICT DO NOTHING",
    );
    await pool.query("INSERT INTO festivals (id, name) VALUES ('p099-f1', 'P099 Fest') ON CONFLICT DO NOTHING");
    for (const [ci, crewId] of CREWS.entries()) {
      await pool.query(
        `INSERT INTO crews (id, festival_id, name, created_by, invite_code, max_members)
         VALUES ($1, 'p099-f1', 'C', 'p099-u1', $2, 10) ON CONFLICT DO NOTHING`,
        [crewId, `P099C${ci}`],
      );
      for (let i = 0; i < 30; i++) {
        const closed = i % 2 === 0;
        await pool.query(
          `INSERT INTO crew_polls (id, crew_id, created_by, question, options, closes_at, closed, closed_at, created_at)
           VALUES ($1, $2, 'p099-u1', 'Q', '["a","b"]'::jsonb, NULL, $3, $4, NOW() - make_interval(mins => $5))`,
          [`p099-poll-${ci}-${i}`, crewId, closed, closed ? new Date(Date.now() - i * 60_000) : null, i + 1],
        );
        const inactive = i % 2 === 0;
        await pool.query(
          `INSERT INTO crew_meeting_points
             (id, crew_id, created_by, label, location, type, meet_at, expires_at, active, recurs_daily, created_at, updated_at)
           VALUES ($1, $2, 'p099-u1', 'Meet', 'Gate', 'during',
             NOW() - make_interval(mins => $3), NOW() - make_interval(mins => $3 - 10), $4, FALSE,
             NOW() - INTERVAL '13 hours', NOW())`,
          [`p099-mp-${ci}-${i}`, crewId, (i + 1) * 20, !inactive],
        );
      }
    }
    await pool.query('ANALYZE crew_polls');
    await pool.query('ANALYZE crew_meeting_points');
  });

  after(async () => {
    await pool.query("DELETE FROM crews WHERE id LIKE 'p099-%'").catch(() => {});
    await pool.query("DELETE FROM festivals WHERE id LIKE 'p099-%'").catch(() => {});
    await pool.query("DELETE FROM users WHERE id LIKE 'p099-%'").catch(() => {});
    await pool.query(SQL).catch(() => {});
    await pool.end();
  });

  test('same rows before and after, and both lists use the new indexes', async () => {
    await pool.query('DROP INDEX IF EXISTS idx_crew_polls_crew');
    await pool.query('DROP INDEX IF EXISTS idx_cmp_crew_inactive');
    const before = await readAll();
    assert.equal((before[FIRST] as any).polls.length, 25, '15 open plus the 10 latest decided');
    assert.equal((before[FIRST] as any).past.length, 15);

    await pool.query(SQL);
    await pool.query('ANALYZE crew_polls');
    await pool.query('ANALYZE crew_meeting_points');
    assert.deepEqual(await readAll(), before);

    const pollPlan = await explain((p) => createPollsStore(p, {}).listByCrew(FIRST));
    assert.match(pollPlan, /(?:Bitmap )?Index (?:Only )?Scan.*idx_crew_polls_crew/, pollPlan);
    const pastPlan = await explain((p) => createCrewsStore(p, {}).meetingPoints.listRecentlyExpired(FIRST));
    assert.match(pastPlan, /(?:Bitmap )?Index (?:Only )?Scan.*idx_cmp_crew_inactive/, pastPlan);
  });
});
