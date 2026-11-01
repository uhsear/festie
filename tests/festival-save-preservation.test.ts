import 'dotenv/config';
/**
 * Integration tests: PUT /api/v1/admin/festivals/:id keeps data (T4 P1).
 * Covers: a map save with no days leaves festival_sets untouched, an editor save
 * keeps server-owned photo/genres, a mobile save keeps per-artist B2B links, a
 * typed rename wins over a stale artists[], the CONFIRM_REMOVALS guard, the
 * re-auth gate on confirmRemovals, and the FESTIVAL_CHANGED stale-form check.
 *
 * Each test seeds sets directly, then starts a fresh server so the festival
 * cache reads the seeded rows. Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT
 * ID on teardown.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { after, afterEach, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { createFestivalPlanner } from '../server';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const ADMIN_PASSWORD = 'test-admin-password-pass';

const RUN_ID = `fsp${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const STAGE = `main-${RUN_ID}`;
const SET_B2B = `b2b-${RUN_ID}`;
const SET_SOLO = `solo-${RUN_ID}`;
const SET_PICKED = `picked-${RUN_ID}`;
const PROFILE_ID = `prof-${RUN_ID}`;

const SPOTIFY_A = 'https://open.spotify.com/artist/a';
const SPOTIFY_B = 'https://open.spotify.com/artist/b';
const B2B_ARTISTS = [
  { name: 'Alpha', links: { spotify: SPOTIFY_A }, photo: 'https://i.scdn.co/a.jpg', genres: ['house'] },
  { name: 'Beta', links: { spotify: SPOTIFY_B }, photo: 'https://i.scdn.co/b.jpg', genres: ['techno'] },
];
const SOLO_ARTISTS = [{ name: 'Old', links: {}, photo: 'https://i.scdn.co/o.jpg', genres: ['ambient'] }];

const STAGES = [{ id: STAGE, name: 'Main', color: '#ff3366' }];
const SEED_SETS: any[] = [
  { id: SET_B2B, dayIndex: 0, artist: 'Alpha b2b Beta', start: '20:00', end: '21:00', artists: B2B_ARTISTS },
  { id: SET_SOLO, dayIndex: 0, artist: 'Old', start: '21:00', end: '22:00', artists: SOLO_ARTISTS },
  { id: SET_PICKED, dayIndex: 1, artist: 'Gamma', start: '20:00', end: '21:00', artists: [{ name: 'Gamma', links: {} }] },
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
  await pool.query('DELETE FROM festival_profile_picks WHERE profile_id = $1', [PROFILE_ID]);
  await pool.query('DELETE FROM set_ratings WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)', [FEST_ID]);
  await pool.query('DELETE FROM festival_sets WHERE festival_id = $1', [FEST_ID]);
}

async function seed(pool: any) {
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at)
     VALUES ($1, 'Save Preservation Fest', 'Here', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FEST_ID],
  );
  await pool.query(
    `INSERT INTO festival_stages (festival_id, id, name, color, sort_order)
     VALUES ($1, $2, 'Main', '#ff3366', 0) ON CONFLICT DO NOTHING`,
    [FEST_ID, STAGE],
  );
  for (const [i, label] of ['Friday', 'Saturday'].entries()) {
    await pool.query(
      `INSERT INTO festival_days (festival_id, day_index, label, date)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [FEST_ID, i, label, `2026-08-2${i + 1}`],
    );
  }
  await clearSets(pool);
  for (const [i, s] of SEED_SETS.entries()) {
    await pool.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, link_url, artists)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [s.id, FEST_ID, s.dayIndex, s.artist, STAGE, s.start, s.end, i, s.artists[0]?.links?.spotify ?? null, JSON.stringify(s.artists)],
    );
  }
  await pool.query(
    `INSERT INTO festival_profiles (id, festival_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Picker', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [PROFILE_ID, FEST_ID],
  );
  await pool.query(
    `INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, 'must')`,
    [PROFILE_ID, SET_PICKED],
  );
}

async function cleanupById(pool: any) {
  await clearSets(pool);
  await pool.query('DELETE FROM festival_profiles WHERE id = $1', [PROFILE_ID]);
  await pool.query('DELETE FROM festival_days WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM audit_log WHERE target_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festivals WHERE id = $1', [FEST_ID]);
  const like = [`fsp-${RUN_ID}%`];
  await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM users WHERE username LIKE $1', like);
}

async function startServer() {
  await withPool(seed);
  const planner = await (createFestivalPlanner as any)({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return { request: request(planner.app), close: () => planner.close() };
}

async function loginAdmin(server: any) {
  const username = `fsp-${RUN_ID}-admin`;
  const reg = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: ADMIN_PASSWORD, confirmPassword: ADMIN_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true });
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

function put(server: any, token: string, body: any) {
  return server.request
    .put(`/api/v1/admin/festivals/${FEST_ID}`)
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send(body);
}

function readSets() {
  return withPool(async (pool) => {
    const { rows } = await pool.query('SELECT * FROM festival_sets WHERE festival_id = $1 ORDER BY id', [FEST_ID]);
    return rows;
  });
}

// Editor-shaped days: every seeded set, optionally overridden or dropped.
function editorDays(overrides: Record<string, any> = {}, drop: string[] = []) {
  const days: any[] = [
    { label: 'Friday', date: '2026-08-21', sets: [] },
    { label: 'Saturday', date: '2026-08-22', sets: [] },
  ];
  for (const s of SEED_SETS) {
    if (drop.includes(s.id)) continue;
    days[s.dayIndex].sets.push({
      id: s.id,
      artist: s.artist,
      stageId: STAGE,
      startTime: s.start,
      endTime: s.end,
      ...(overrides[s.id] || {}),
    });
  }
  return days;
}

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

describe('festival save preservation (admin PUT)', { skip, concurrency: 1 }, () => {
  test('a map-style save with no days leaves every set row unchanged', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    const before = await readSets();
    const res = await put(server, token, {
      name: 'Save Preservation Fest',
      stages: [{ ...STAGES[0], latitude: 28.5, longitude: -81.4 }],
      mapConfig: { version: 1, center: [-81.4, 28.5] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await readSets(), before);
  });

  test('an editor save with artists[{name, links}] keeps photo and genres', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    const res = await put(server, token, {
      name: 'Save Preservation Fest',
      stages: STAGES,
      days: editorDays({
        [SET_B2B]: { artists: B2B_ARTISTS.map(({ name, links }) => ({ name, links })) },
      }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = (await readSets()).find((s: any) => s.id === SET_B2B);
    assert.deepEqual(row.artists, B2B_ARTISTS);
  });

  test('a mobile-style save (no artists[], unchanged B2B name) keeps each artist link', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    const res = await put(server, token, { name: 'Save Preservation Fest', stages: STAGES, days: editorDays() });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = (await readSets()).find((s: any) => s.id === SET_B2B);
    assert.equal(row.artists.length, 2);
    assert.equal(row.artists[0].links.spotify, SPOTIFY_A);
    assert.equal(row.artists[1].links.spotify, SPOTIFY_B);
  });

  test('a typed rename wins over a stale artists[]', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    const res = await put(server, token, {
      name: 'Save Preservation Fest',
      stages: STAGES,
      days: editorDays({ [SET_SOLO]: { artist: 'New', artists: [{ name: 'Old' }] } }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const got = await server.request.get(`/api/v1/festivals/${FEST_ID}`).expect(200);
    const set = got.body.data.days.flatMap((d: any) => d.sets).find((s: any) => s.id === SET_SOLO);
    assert.equal(set.artist, 'New');
  });

  test('dropping a picked set needs confirmRemovals, then a recent re-auth', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    const before = await readSets();
    const body = { name: 'Save Preservation Fest', stages: STAGES, days: editorDays({}, [SET_PICKED]) };

    const refused = await put(server, token, body);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'CONFIRM_REMOVALS');
    assert.equal(refused.body.error.removal.picks, 1);
    assert.deepEqual(await readSets(), before);

    const noReauth = await put(server, token, { ...body, confirmRemovals: true });
    assert.equal(noReauth.status, 403);
    assert.equal(noReauth.body.error.code, 'REAUTH_REQUIRED');
    assert.deepEqual(await readSets(), before);

    await server.request
      .post('/api/v1/auth/reauth')
      .set('x-user-token', token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: ADMIN_PASSWORD })
      .expect(200);
    const saved = await put(server, token, { ...body, confirmRemovals: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal((await readSets()).some((s: any) => s.id === SET_PICKED), false);
  });

  test('an old expectedUpdatedAt returns FESTIVAL_CHANGED', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    const res = await put(server, token, { name: 'Save Preservation Fest', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'FESTIVAL_CHANGED');
  });
});
