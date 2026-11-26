import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';
import { addDays, assertStagingDatabase, localNow, removeDemo, seedDemo, todaySchedule } from '../scripts/staging/seed-demo-festival';

// scripts/staging/seed-demo-festival.ts builds the fictional demo festival on staging.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(databaseUrl: string | undefined, args: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SEED_DATABASE_URL;
  if (databaseUrl) env.SEED_DATABASE_URL = databaseUrl;
  return spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/staging/seed-demo-festival.ts', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env });
}

describe('seed-demo-festival database guard', () => {
  // The port is closed: a refusal that connects first would fail with ECONNREFUSED instead.
  test('refuses the production database name before connecting', () => {
    const r = run('postgresql://u:p@127.0.0.1:1/festival_planner');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Refusing to seed "festival_planner"/);
  });

  test('refuses every name that does not end in _staging', () => {
    for (const url of ['postgresql://u:p@127.0.0.1:1/festival_planner_prod', 'postgresql://u:p@127.0.0.1:1/festie_test', 'postgresql://u:p@127.0.0.1:1/', 'not a url']) {
      assert.throws(() => assertStagingDatabase(url), /must end in _staging|Refusing/, url);
      const r = run(url);
      assert.equal(r.status, 1, url);
      assert.match(r.stderr, /must end in _staging/, url);
    }
    assert.doesNotThrow(() => assertStagingDatabase('postgresql://u:p@127.0.0.1:1/festival_planner_staging'));
  });

  test('refuses to run without SEED_DATABASE_URL, even when DATABASE_URL is set', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/staging/seed-demo-festival.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, SEED_DATABASE_URL: '', DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x_staging' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Set SEED_DATABASE_URL/);
  });
});

describe('seed-demo-festival schedule', () => {
  test('places ended, live and imminent sets around the capture minute', () => {
    const now = 12 * 60;
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const sets = todaySchedule(now).map(([, , s, e]) => [toMin(s), toMin(e)]);
    assert.ok(sets.some(([, e]) => e! <= now), 'an ended set');
    assert.ok(sets.filter(([s, e]) => s! <= now && now < e!).length >= 2, 'live sets');
    assert.ok(sets.some(([s]) => s! > now && s! - now <= 30), 'an imminent set');
    assert.ok(sets.some(([s]) => s! - now > 60), 'a later set');
  });

  test('refuses a window that would cross midnight', () => {
    assert.throws(() => todaySchedule(60), /crosses midnight/);
    assert.throws(() => todaySchedule(23 * 60), /crosses midnight/);
  });

  test('reads the festival-local date and rounds the minute down to 5', () => {
    // 03:07Z in January is 22:07 the evening before in New York.
    assert.deepEqual(localNow(new Date('2026-01-15T03:07:00Z')), { date: '2026-01-14', minute: 22 * 60 + 5 });
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });
});

describe('seed-demo-festival on the test database', { skip }, () => {
  let pool: Pool;
  const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);

  before(async () => {
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  after(async () => {
    await removeDemo(pool);
    await pool.end();
  });

  test('seeds the demo festival, rebuilds it on a rerun and leaves no demo rows after removal', async () => {
    const noon = new Date('2026-06-10T16:00:00Z'); // 12:00 in New York
    const first = await seedDemo(pool, noon);
    assert.equal(first.crewMembers, 3);
    assert.equal(await count("SELECT count(*) AS n FROM festival_sets WHERE festival_id = 'demo-hush-harbor' AND start_time IS NULL"), 4);
    assert.equal(await count("SELECT count(*) AS n FROM festival_sets WHERE festival_id = 'demo-moonlit-orchard'"), 18);
    assert.equal(await count("SELECT count(*) AS n FROM crew_members WHERE crew_id = 'demo-crew-orchard'"), 3);
    assert.equal(await count("SELECT count(*) AS n FROM festival_profile_picks WHERE profile_id LIKE 'demo-profile-%'"), 12);

    await seedDemo(pool, noon);
    assert.equal(await count("SELECT count(*) AS n FROM festival_sets WHERE festival_id = 'demo-moonlit-orchard'"), 18);
    assert.equal(await count("SELECT count(*) AS n FROM users WHERE id LIKE 'demo-user-%'"), 3);
  });

  test('removal deletes every demo row and no other user', async () => {
    const others = await count("SELECT count(*) AS n FROM users WHERE id NOT LIKE 'demo-user-%'");
    await removeDemo(pool);
    assert.equal(await count("SELECT count(*) AS n FROM users WHERE id LIKE 'demo-user-%'"), 0);
    assert.equal(await count("SELECT count(*) AS n FROM festivals WHERE id LIKE 'demo-%'"), 0);
    assert.equal(await count("SELECT count(*) AS n FROM crews WHERE id LIKE 'demo-%'"), 0);
    assert.equal(await count("SELECT count(*) AS n FROM users WHERE id NOT LIKE 'demo-user-%'"), others);
  });
});
