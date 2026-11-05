import 'dotenv/config';
/**
 * Integration tests: "moved" marks on festival sets (T46 P1).
 * An admin days save (PUT /api/v1/admin/festivals/:id) and a lineup import
 * commit/undo write festival_sets.moved_at and moved_from in the same
 * transaction as the set write, only when the festival is published.
 *
 * Each test re-seeds the sets, then starts a fresh server so the festival cache
 * reads the seeded rows. Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID on
 * teardown.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { after, afterEach, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { createFestivalPlanner } from '../server';
import { createLineupImportsStore } from '../lib/db/stores/lineup-imports';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const ADMIN_PASSWORD = 'test-admin-password-move';

const RUN_ID = `fsm${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const SAHARA = `sahara-${RUN_ID}`;
const MOJAVE = `mojave-${RUN_ID}`;
const S1 = `one-${RUN_ID}`;
const S2 = `two-${RUN_ID}`;
const S3 = `tba-${RUN_ID}`;

const STAGES = [
  { id: SAHARA, name: 'Sahara', color: '#ff3366' },
  { id: MOJAVE, name: 'Mojave', color: '#3366ff' },
];
const FRI = { label: 'Friday', date: '2026-08-21' };
const SAT = { label: 'Saturday', date: '2026-08-22' };
const THU = { label: 'Thursday', date: '2026-08-20' };

type SetIn = { id: string; artist: string; stageId: string; startTime: string | null; endTime: string | null };
const baseFri = (): SetIn[] => [
  { id: S1, artist: 'One', stageId: SAHARA, startTime: '22:00', endTime: '23:00' },
  { id: S2, artist: 'Two', stageId: SAHARA, startTime: '20:00', endTime: '21:00' },
  { id: S3, artist: 'Tba', stageId: SAHARA, startTime: null, endTime: null },
];

async function withPool<T>(fn: (pool: any) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function clearSets(pool: any) {
  await pool.query('DELETE FROM festival_sets WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_days WHERE festival_id = $1', [FEST_ID]);
}

async function seed(pool: any, published = true) {
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at, published_at)
     VALUES ($1, 'Move Fest', 'Here', NOW(), NOW(), $2)
     ON CONFLICT (id) DO UPDATE SET published_at = EXCLUDED.published_at`,
    [FEST_ID, published ? new Date() : null],
  );
  for (const [i, st] of STAGES.entries()) {
    await pool.query(
      `INSERT INTO festival_stages (festival_id, id, name, color, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [FEST_ID, st.id, st.name, st.color, i],
    );
  }
  await clearSets(pool);
  await pool.query(
    `INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, $2, $3), ($1, 1, $4, $5)`,
    [FEST_ID, FRI.label, FRI.date, SAT.label, SAT.date],
  );
  for (const [i, s] of baseFri().entries()) {
    await pool.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists)
       VALUES ($1, $2, 0, $3, $4, $5, $6, $7, '[]')`,
      [s.id, FEST_ID, s.artist, s.stageId, s.startTime, s.endTime, i],
    );
  }
}

async function cleanupById(pool: any) {
  await pool.query('DELETE FROM lineup_imports WHERE festival_id = $1', [FEST_ID]);
  await clearSets(pool);
  await pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM audit_log WHERE target_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festivals WHERE id = $1', [FEST_ID]);
  const like = [`fsm-${RUN_ID}%`];
  await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM email_verification_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM users WHERE username LIKE $1', like);
}

async function startServer(published = true) {
  await withPool((pool) => seed(pool, published));
  const planner = await (createFestivalPlanner as any)({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  const server: any = { request: request(planner.app), close: () => planner.close() };
  servers.push(server);
  server.token = await loginAdmin(server);
  return server;
}

async function loginAdmin(server: any) {
  const username = `fsm-${RUN_ID}-admin`;
  const reg = await server.request.post('/api/v1/auth/register').set(TRUSTED_MUTATION_HEADER, '1').send({
    username,
    password: ADMIN_PASSWORD,
    confirmPassword: ADMIN_PASSWORD,
    dateOfBirth: '1995-01-01',
    tosAccepted: true, email: `${username}@example.com`,
  });
  if (reg.status === 201) {
    await withPool((pool) =>
      pool.query(
        `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
         SELECT u.id, r.id, NULL, NOW() FROM users u, roles r
         WHERE u.username = $1 AND r.name = 'admin'
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [username],
      ),
    );
  }
  const login = await server.request
    .post('/api/v1/auth/login')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: ADMIN_PASSWORD })
    .expect(200);
  return login.body.data.token;
}

/** Saves Friday with `fri` (S1 patched by `s1`), then Saturday with `sat`. `days` overrides the whole layout. */
async function save(
  server: any,
  opts: { s1?: Partial<SetIn> & Record<string, any>; sat?: SetIn[]; days?: any[] } = {},
) {
  const fri = baseFri().map((s) => (s.id === S1 ? { ...s, ...(opts.s1 || {}) } : s));
  const days = opts.days ?? [
    { ...FRI, sets: fri.filter((s) => !(opts.sat || []).some((x) => x.id === s.id)) },
    { ...SAT, sets: opts.sat || [] },
  ];
  const res = await server.request
    .put(`/api/v1/admin/festivals/${FEST_ID}`)
    .set('x-user-token', server.token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ name: 'Move Fest', stages: STAGES, days });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}

async function marks(): Promise<Record<string, { movedAt: Date; movedFrom: any }>> {
  const { rows } = await withPool<any>((pool) =>
    pool.query('SELECT id, moved_at, moved_from FROM festival_sets WHERE festival_id = $1 AND moved_at IS NOT NULL', [
      FEST_ID,
    ]),
  );
  return Object.fromEntries(rows.map((r: any) => [r.id, { movedAt: r.moved_at, movedFrom: r.moved_from }]));
}

const fromFri = (over: Record<string, any> = {}) => ({
  dayIndex: 0,
  stageId: SAHARA,
  start: '22:00',
  end: '23:00',
  ...over,
});

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    try {
      await servers.pop().close();
    } catch (_) {
      /* best-effort */
    }
  }
});

after(async () => {
  if (skip) return;
  await withPool(cleanupById);
});

describe('admin days save writes moved marks', { skip, concurrency: 1 }, () => {
  test('a time move marks only the moved set', async () => {
    const server = await startServer();
    const t0 = Date.now();
    await save(server, { s1: { startTime: '22:30', endTime: '23:30' } });
    const m = await marks();
    assert.deepEqual(Object.keys(m), [S1]);
    assert.deepEqual(m[S1]!.movedFrom, fromFri());
    assert.ok(Math.abs(m[S1]!.movedAt.getTime() - t0) < 60_000);
  });

  test('a stage-only move marks the set; a day move keeps the old dayIndex', async () => {
    const server = await startServer();
    await save(server, { s1: { stageId: MOJAVE } });
    assert.deepEqual((await marks())[S1]!.movedFrom, fromFri());

    const server2 = await startServer();
    const moved = { ...baseFri()[0]! };
    await save(server2, { sat: [moved] });
    assert.deepEqual((await marks())[S1]!.movedFrom, fromFri());
  });

  test('three moves keep the first slot, and moving back clears the mark', async () => {
    const server = await startServer();
    await save(server, { s1: { startTime: '22:30', endTime: '23:30' } });
    await save(server, { s1: { startTime: '23:00', endTime: '00:00' } });
    await save(server, { s1: { startTime: '23:30', endTime: '00:30' } });
    assert.equal((await marks())[S1]!.movedFrom.start, '22:00');
    await save(server, {});
    assert.deepEqual(await marks(), {});
  });

  test('TBA to a time on the same day and stage writes nothing', async () => {
    const server = await startServer();
    const days = [
      { ...FRI, sets: baseFri().map((s) => (s.id === S3 ? { ...s, startTime: '18:00', endTime: '19:00' } : s)) },
      { ...SAT, sets: [] },
    ];
    await save(server, { days });
    assert.deepEqual(await marks(), {});
  });

  test('a later save that does not touch the set keeps its mark', async () => {
    const server = await startServer();
    await save(server, { s1: { startTime: '22:30', endTime: '23:30' } });
    const first = (await marks())[S1]!;
    await save(server, { s1: { startTime: '22:30', endTime: '23:30', artist: 'Renamed' } });
    const second = (await marks())[S1]!;
    assert.deepEqual(second, first);
  });

  test('a new first day marks nothing and shifts an existing mark', async () => {
    const server = await startServer();
    await save(server, { s1: { startTime: '22:30', endTime: '23:30' } });
    const fri = baseFri().map((s) => (s.id === S1 ? { ...s, startTime: '22:30', endTime: '23:30' } : s));
    await save(server, {
      days: [
        { ...THU, sets: [] },
        { ...FRI, sets: fri },
        { ...SAT, sets: [] },
      ],
    });
    const m = await marks();
    assert.deepEqual(Object.keys(m), [S1]);
    assert.deepEqual(m[S1]!.movedFrom, fromFri({ dayIndex: 1 }));
  });

  test('a draft festival save writes no marks', async () => {
    const server = await startServer(false);
    await save(server, { s1: { startTime: '22:30', endTime: '23:30' } });
    assert.deepEqual(await marks(), {});
  });

  test('a 49-hour-old mark is cleared by a save that keeps the set in place', async () => {
    const server = await startServer();
    await withPool((pool) =>
      pool.query(`UPDATE festival_sets SET moved_at = NOW() - interval '49 hours', moved_from = $2 WHERE id = $1`, [
        S1,
        JSON.stringify(fromFri({ start: '21:00', end: '22:00' })),
      ]),
    );
    await save(server, {});
    assert.deepEqual(await marks(), {});
  });

  test('a body that echoes movedAt and movedFrom changes nothing', async () => {
    const server = await startServer();
    await save(server, { s1: { movedAt: new Date().toISOString(), movedFrom: fromFri({ start: '18:00' }) } });
    assert.deepEqual(await marks(), {});
  });
});

describe('lineup import writes moved marks', { skip, concurrency: 1 }, () => {
  test('an import that changes a start marks the set, and undo clears it', async () => {
    await withPool((pool) => seed(pool, true));
    await withPool(async (pool) => {
      const store = createLineupImportsStore(pool, { festivals: { getById: async () => ({}) } });
      const before = {
        stageId: SAHARA,
        startTime: '22:00',
        endTime: '23:00',
        artist: 'One',
        artists: [],
        linkUrl: null,
      };
      const afterValues = { ...before, startTime: '22:30', endTime: '23:30' };
      const writes = {
        newStages: [],
        newDays: [],
        inserts: [],
        updates: [{ index: 0, setId: S1, before, after: afterValues }],
        spotifyMatched: 0,
      };
      const plan = { counts: { error: 0 }, problems: [] };
      const res: any = await store.commit(FEST_ID, () => ({ plan, writes }) as any, { createdBy: null });
      assert.equal(res.committed, true);
      assert.deepEqual((await marks())[S1]!.movedFrom, fromFri());

      const undone: any = await store.undo(FEST_ID, res.importId);
      assert.equal(undone.result.restored, 1);
      assert.deepEqual(await marks(), {});
    });
  });
});
