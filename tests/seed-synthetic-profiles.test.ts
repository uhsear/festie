import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

// scripts/staging/seed-synthetic-profiles.ts fills a staging or test database with invented users.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FESTIVAL = 'synth-seed-fest';

function runSeed(databaseUrl: string | undefined, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SEED_DATABASE_URL;
  if (databaseUrl) env.SEED_DATABASE_URL = databaseUrl;
  return spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/staging/seed-synthetic-profiles.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env,
  });
}

describe('seed-synthetic-profiles database guard', () => {
  // The port is closed: a refusal that connects first would fail with ECONNREFUSED instead.
  test('refuses the production database name before connecting', () => {
    const run = runSeed('postgresql://u:p@127.0.0.1:1/festival_planner', ['--festival', 'x']);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Refusing to seed "festival_planner"/);
  });

  test('refuses a name that does not end in _staging or _test', () => {
    for (const url of ['postgresql://u:p@127.0.0.1:1/festival_planner_prod', 'postgresql://u:p@127.0.0.1:1/', 'not a url', 'mysql://u:p@127.0.0.1:1/x_test']) {
      const run = runSeed(url, ['--festival', 'x']);
      assert.equal(run.status, 1, url);
      assert.match(run.stderr, /must end in _staging or _test/, url);
    }
  });

  test('refuses to run without SEED_DATABASE_URL, even when DATABASE_URL is set', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/staging/seed-synthetic-profiles.ts', '--festival', 'x'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, SEED_DATABASE_URL: '', DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/seed_test' },
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Set SEED_DATABASE_URL/);
  });
});

describe('seed-synthetic-profiles on the test database', { skip }, () => {
  let pool: Pool;
  const counts = async () => {
    const one = async (sql: string) => Number((await pool.query(sql)).rows[0].n);
    return {
      users: await one("SELECT count(*) AS n FROM users WHERE id LIKE 'synth-%'"),
      profiles: await one("SELECT count(*) AS n FROM festival_profiles WHERE user_id LIKE 'synth-%'"),
      picks: await one("SELECT count(*) AS n FROM festival_profile_picks WHERE profile_id LIKE 'synth-%'"),
    };
  };

  before(async () => {
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(
      `INSERT INTO festivals (id, name, location, created_at, updated_at, edited_at, b2b_separator, time_zone, lineup)
       VALUES ($1, 'Seed Fest', 'Here', now(), now(), now(), 'b2b', 'America/New_York', '[]'::jsonb)`,
      [FESTIVAL],
    );
    await pool.query(`INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, 'Main', '#ff3366', 0)`, [FESTIVAL, `${FESTIVAL}-main`]);
    await pool.query(`INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, 'Friday', '2099-08-21')`, [FESTIVAL]);
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists)
         VALUES ($1, $2, 0, $3, $4, '20:00', '21:00', $5, '[]'::jsonb)`,
        [`${FESTIVAL}-set-${i}`, FESTIVAL, `Artist ${i}`, `${FESTIVAL}-main`, i],
      );
    }
  });

  after(async () => {
    runSeed(TEST_DATABASE_URL, ['--remove']);
    for (const table of ['festival_sets', 'festival_days', 'festival_stages']) await pool.query(`DELETE FROM ${table} WHERE festival_id = $1`, [FESTIVAL]);
    await pool.query('DELETE FROM festivals WHERE id = $1', [FESTIVAL]);
    await pool.end();
  });

  test('seeds users, profiles and picks, reruns without duplicates, and removes only its own rows', async () => {
    const first = runSeed(TEST_DATABASE_URL, ['--festival', FESTIVAL, '--count', '12', '--picks', '3']);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), { users: 12, profiles: 12, picks: 36 });
    assert.deepEqual(await counts(), { users: 12, profiles: 12, picks: 36 });

    const again = runSeed(TEST_DATABASE_URL, ['--festival', FESTIVAL, '--count', '12', '--picks', '3']);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(JSON.parse(again.stdout), { users: 0, profiles: 0, picks: 0 });
    assert.deepEqual(await counts(), { users: 12, profiles: 12, picks: 36 });

    const { rows } = await pool.query(
      `SELECT jsonb_object_keys(picks_json) AS set_id FROM festival_profiles WHERE id = 'synth-profile-000001'`,
    );
    const pickRows = await pool.query(`SELECT set_id FROM festival_profile_picks WHERE profile_id = 'synth-profile-000001'`);
    assert.deepEqual(rows.map((r: any) => r.set_id).sort(), pickRows.rows.map((r: any) => r.set_id).sort());

    const realUsers = Number((await pool.query("SELECT count(*) AS n FROM users WHERE id NOT LIKE 'synth-%'")).rows[0].n);
    const removed = runSeed(TEST_DATABASE_URL, ['--remove']);
    assert.equal(removed.status, 0, removed.stderr);
    assert.deepEqual(JSON.parse(removed.stdout), { removedUsers: 12 });
    assert.deepEqual(await counts(), { users: 0, profiles: 0, picks: 0 });
    assert.equal(Number((await pool.query("SELECT count(*) AS n FROM users WHERE id NOT LIKE 'synth-%'")).rows[0].n), realUsers);
  });

  test('fails with a clear message for a festival that has no sets', () => {
    const run = runSeed(TEST_DATABASE_URL, ['--festival', 'no-such-festival', '--count', '1']);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /has no sets in this database/);
  });
});
