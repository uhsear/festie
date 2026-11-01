import 'dotenv/config';
/**
 * Integration tests for revocable share links (T22):
 * POST /api/v1/account/share-link/:festivalId, GET /api/v1/account/sharing,
 * POST /api/v1/account/sharing/reset, and how /s/:id, /s/u/:username and
 * /cal/:token.ics answer before and after a reset.
 *
 * Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID on teardown.
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
const DEFAULT_PASSWORD = 'Str0ngTest!Pw';

const RUN_ID = `sl${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const STAGE_MAIN = `main-${RUN_ID}`;
const SET_A = `set-a-${RUN_ID}`;

async function withPool<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try { return await fn(pool); } finally { await pool.end(); }
}

async function seedFestival(pool: Pool) {
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at)
     VALUES ($1, 'Link Test Fest', 'Linkville', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FEST_ID],
  );
  await pool.query(
    `INSERT INTO festival_stages (festival_id, id, name, color, sort_order)
     VALUES ($1, $2, 'Main', '#ff3366', 0) ON CONFLICT DO NOTHING`,
    [FEST_ID, STAGE_MAIN],
  );
  await pool.query(
    `INSERT INTO festival_days (festival_id, day_index, label, date)
     VALUES ($1, 0, 'Saturday', '2026-07-10') ON CONFLICT DO NOTHING`,
    [FEST_ID],
  );
  await pool.query(
    `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order)
     VALUES ($1, $2, 0, 'Aria', $3, '20:00', '21:00', 0) ON CONFLICT (id) DO NOTHING`,
    [SET_A, FEST_ID, STAGE_MAIN],
  );
}

async function cleanupById(pool: Pool) {
  const users = `share-${RUN_ID}%`;
  await pool.query('DELETE FROM calendar_tokens WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_profile_picks WHERE profile_id IN (SELECT id FROM festival_profiles WHERE festival_id = $1)', [FEST_ID]);
  await pool.query('DELETE FROM festival_profiles WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_sets WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_days WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festivals WHERE id = $1', [FEST_ID]);
  await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', [users]);
  await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', [users]);
  await pool.query('DELETE FROM users WHERE username LIKE $1', [users]);
}

async function startServer() {
  await withPool(seedFestival);
  const planner = await (createFestivalPlanner as any)({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return { planner, request: request(planner.app), async close() { await planner.close(); } };
}

type Server = Awaited<ReturnType<typeof startServer>>;

async function registerUser(server: Server, suffix: string) {
  const username = `share-${RUN_ID}-${suffix}`;
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true })
    .expect(201);
  return { ...res.body.data, username };
}

async function joinWithPick(server: Server, token: string) {
  const res = await server.request.post('/api/v1/profiles').set('x-user-token', token).send({ festivalId: FEST_ID }).expect(200);
  const profile = res.body.data;
  await server.request
    .put(`/api/v1/profiles/${profile.id}`)
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ picks: { [SET_A]: 'must' } })
    .expect(200);
  return profile;
}

function post(server: Server, token: string, url: string) {
  return server.request.post(url).set('x-user-token', token).set(TRUSTED_MUTATION_HEADER, '1');
}

async function shareToken(server: Server, token: string) {
  const res = await post(server, token, `/api/v1/account/share-link/${FEST_ID}`).expect(200);
  return res.body.data.token as string;
}

async function calendarUrl(server: Server, token: string) {
  const res = await post(server, token, `/api/v1/calendar-sync/${FEST_ID}`).expect(200);
  return new URL(res.body.data.url, 'http://x').pathname;
}

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    try { await servers.pop()!.close(); } catch (_) { /* best-effort */ }
  }
});

after(async () => {
  if (skip) return;
  await withPool(cleanupById);
});

async function boot() {
  const server = await startServer();
  servers.push(server);
  return server;
}

describe('revocable share links', { skip, concurrency: 1 }, () => {
  test('share-link returns the same token twice, and /s/<token> renders the picks', async () => {
    const server = await boot();
    const user = await registerUser(server, 'same');
    await joinWithPick(server, user.token);

    const first = await shareToken(server, user.token);
    const second = await shareToken(server, user.token);
    assert.match(first, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(second, first);

    const page = await server.request.get(`/s/${first}`).expect(200);
    assert.match(page.text, /Link Test Fest/);
    assert.match(page.text, /Aria/);
    assert.equal(page.headers['cache-control'], 'private, no-cache');
    const json = await server.request.get(`/s/${first}/json`).expect(200);
    assert.equal(json.body.data.festivalId, FEST_ID);
    assert.equal(json.headers['cache-control'], 'private, no-cache');
  });

  test('two parallel share-link calls return the same token', async () => {
    const server = await boot();
    const user = await registerUser(server, 'race');
    await joinWithPick(server, user.token);
    const [a, b] = await Promise.all([shareToken(server, user.token), shareToken(server, user.token)]);
    assert.equal(a, b);
  });

  test('share-link answers 404 without a profile and 400 for a bad id', async () => {
    const server = await boot();
    const user = await registerUser(server, 'noprof');
    const missing = await post(server, user.token, `/api/v1/account/share-link/${FEST_ID}`).expect(404);
    assert.equal(missing.body.error.message, 'Pick a set at this festival first, then share your picks.');
    await post(server, user.token, '/api/v1/account/share-link/bad%20id!').expect(400);
  });

  test('legacy /s/<profileId> works before reset; reset stops it, the token and the calendar feed', async () => {
    const server = await boot();
    const user = await registerUser(server, 'reset');
    const profile = await joinWithPick(server, user.token);
    const oldToken = await shareToken(server, user.token);
    const feed = await calendarUrl(server, user.token);

    await server.request.get(`/s/${profile.id}`).expect(200);
    await server.request.get(feed).expect(200);

    const reset = await post(server, user.token, '/api/v1/account/sharing/reset').expect(200);
    assert.ok(!Number.isNaN(Date.parse(reset.body.data.linksResetAt)));

    const legacy = await server.request.get(`/s/${profile.id}`).expect(404);
    assert.match(legacy.text, /ask them for a new one/);
    await server.request.get(`/s/${profile.id}/json`).expect(404);
    await server.request.get(`/s/${oldToken}`).expect(404);
    await server.request.get(feed).expect(404);

    const newToken = await shareToken(server, user.token);
    assert.notEqual(newToken, oldToken);
    await server.request.get(`/s/${newToken}`).expect(200);

    const status = await server.request.get('/api/v1/account/sharing').set('x-user-token', user.token).expect(200);
    assert.equal(status.body.data.linksResetAt, reset.body.data.linksResetAt);
  });

  test("another user's reset does not affect your links", async () => {
    const server = await boot();
    const alice = await registerUser(server, 'alice');
    const bob = await registerUser(server, 'bob');
    const aliceProfile = await joinWithPick(server, alice.token);
    await joinWithPick(server, bob.token);
    const aliceToken = await shareToken(server, alice.token);
    const aliceFeed = await calendarUrl(server, alice.token);

    await post(server, bob.token, '/api/v1/account/sharing/reset').expect(200);

    await server.request.get(`/s/${aliceToken}`).expect(200);
    await server.request.get(`/s/${aliceProfile.id}`).expect(200);
    await server.request.get(aliceFeed).expect(200);
  });

  test('/s/u/<username> renders in place with the festival name; 404 when private', async () => {
    const server = await boot();
    const user = await registerUser(server, 'vanity');
    await joinWithPick(server, user.token);

    await server.request.get(`/s/u/${user.username}`).redirects(0).expect(404);

    await server.request
      .put('/api/v1/account/public-schedule')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ publicSchedule: true })
      .expect(200);
    const res = await server.request.get(`/s/u/${user.username}`).redirects(0).expect(200);
    assert.equal(res.headers.location, undefined);
    assert.match(res.text, /Link Test Fest/);
    assert.equal(res.headers['cache-control'], 'private, no-cache');
  });

  test('GET /account/sharing names the newest festival only when the page is public', async () => {
    const server = await boot();
    const user = await registerUser(server, 'status');
    await joinWithPick(server, user.token);
    const get = () => server.request.get('/api/v1/account/sharing').set('x-user-token', user.token).expect(200);

    const off = await get();
    assert.deepEqual(off.body.data, { publicSchedule: false, publicFestival: null, linksResetAt: null });

    await withPool((pool) => pool.query('UPDATE users SET public_schedule = TRUE WHERE username = $1', [user.username]));
    const on = await get();
    assert.equal(on.body.data.publicSchedule, true);
    assert.deepEqual(on.body.data.publicFestival, { id: FEST_ID, name: 'Link Test Fest' });
  });
});
