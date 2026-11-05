import 'dotenv/config';
/**
 * Integration tests: an admin days save (PUT /api/v1/admin/festivals/:id) keeps
 * per-set user data. replaceChildRows deletes and re-inserts every set, so it must
 * carry notes, caught marks and ratings across by set ID.
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
const ADMIN_PASSWORD = 'test-admin-password-keep';

const RUN_ID = `fsk${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const STAGE = `main-${RUN_ID}`;
const SET_KEPT = `kept-${RUN_ID}`;
const SET_GONE = `gone-${RUN_ID}`;
const SET_RATED = `rated-${RUN_ID}`;
const PROFILE_ID = `prof-${RUN_ID}`;
const USER_ID = `user-${RUN_ID}`;

const STAGES = [{ id: STAGE, name: 'Main', color: '#ff3366' }];
const SEED_SETS: any[] = [
  { id: SET_KEPT, artist: 'Kept', start: '20:00', end: '21:00' },
  { id: SET_GONE, artist: 'Gone', start: '21:00', end: '22:00' },
  { id: SET_RATED, artist: 'Rated', start: '22:00', end: '23:00' },
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
  const inFest = 'set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)';
  await pool.query(`DELETE FROM festival_profile_notes WHERE ${inFest}`, [FEST_ID]);
  await pool.query(`DELETE FROM set_caught WHERE ${inFest}`, [FEST_ID]);
  await pool.query(`DELETE FROM set_ratings WHERE ${inFest}`, [FEST_ID]);
  await pool.query('DELETE FROM festival_sets WHERE festival_id = $1', [FEST_ID]);
}

async function seed(pool: any) {
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at)
     VALUES ($1, 'Save Keeps Fest', 'Here', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FEST_ID],
  );
  await pool.query(
    `INSERT INTO festival_stages (festival_id, id, name, color, sort_order)
     VALUES ($1, $2, 'Main', '#ff3366', 0) ON CONFLICT DO NOTHING`,
    [FEST_ID, STAGE],
  );
  await pool.query(
    `INSERT INTO festival_days (festival_id, day_index, label, date)
     VALUES ($1, 0, 'Friday', '2026-08-21') ON CONFLICT DO NOTHING`,
    [FEST_ID],
  );
  await clearSets(pool);
  for (const [i, s] of SEED_SETS.entries()) {
    await pool.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists)
       VALUES ($1, $2, 0, $3, $4, $5, $6, $7, '[]')`,
      [s.id, FEST_ID, s.artist, STAGE, s.start, s.end, i],
    );
  }
  await pool.query(
    `INSERT INTO users (id, username, password_hash, created_at, tos_accepted_at, tos_version)
     VALUES ($1, $2, 'x', NOW(), NOW(), 1) ON CONFLICT (id) DO NOTHING`,
    [USER_ID, `fsk-${RUN_ID}-user`],
  );
  await pool.query(
    `INSERT INTO festival_profiles (id, festival_id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Keeper', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [PROFILE_ID, FEST_ID, USER_ID],
  );
}

async function cleanupById(pool: any) {
  await clearSets(pool);
  await pool.query('DELETE FROM festival_profiles WHERE id = $1', [PROFILE_ID]);
  await pool.query('DELETE FROM festival_days WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM audit_log WHERE target_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festivals WHERE id = $1', [FEST_ID]);
  const like = [`fsk-${RUN_ID}%`];
  await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM email_verification_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
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
  const username = `fsk-${RUN_ID}-admin`;
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

function saveDays(server: any, token: string, overrides: Record<string, any> = {}, drop: string[] = []) {
  const sets = SEED_SETS.filter((s) => !drop.includes(s.id)).map((s) => ({
    id: s.id,
    artist: s.artist,
    stageId: STAGE,
    startTime: s.start,
    endTime: s.end,
    ...(overrides[s.id] || {}),
  }));
  return server.request
    .put(`/api/v1/admin/festivals/${FEST_ID}`)
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ name: 'Save Keeps Fest', stages: STAGES, days: [{ label: 'Friday', date: '2026-08-21', sets }] });
}

function rowsFor(table: string, cols: string) {
  return withPool(async (pool) => {
    const { rows } = await pool.query(
      `SELECT ${cols} FROM ${table} WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1) ORDER BY set_id`,
      [FEST_ID],
    );
    return rows;
  });
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

describe('festival days save keeps per-set user data', { skip, concurrency: 1 }, () => {
  test('keeps a note on a kept set and drops the note on a removed set', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    await withPool(async (pool) => {
      await pool.query(
        'INSERT INTO festival_profile_notes (profile_id, set_id, text) VALUES ($1, $2, $3), ($1, $4, $5)',
        [PROFILE_ID, SET_KEPT, 'bring earplugs', SET_GONE, 'meet at the tree'],
      );
    });
    const res = await saveDays(server, token, {}, [SET_GONE]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await rowsFor('festival_profile_notes', 'profile_id, set_id, text'), [
      { profile_id: PROFILE_ID, set_id: SET_KEPT, text: 'bring earplugs' },
    ]);
    const gone: any = await withPool((pool) =>
      pool.query('SELECT 1 FROM festival_profile_notes WHERE set_id = $1', [SET_GONE]),
    );
    assert.equal(gone.rowCount, 0);
  });

  test('keeps caught marks on kept sets', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    await withPool(async (pool) => {
      await pool.query('INSERT INTO set_caught (user_id, set_id, caught) VALUES ($1, $2, true), ($1, $3, false)', [
        USER_ID,
        SET_KEPT,
        SET_RATED,
      ]);
    });
    const res = await saveDays(server, token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await rowsFor('set_caught', 'user_id, set_id, caught'), [
      { user_id: USER_ID, set_id: SET_KEPT, caught: true },
      { user_id: USER_ID, set_id: SET_RATED, caught: false },
    ]);
  });

  test('keeps the rating when a rated set moves to a new start time', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    await withPool(async (pool) => {
      await pool.query(`INSERT INTO set_ratings (user_id, set_id, rating, note) VALUES ($1, $2, 4, 'great')`, [
        USER_ID,
        SET_RATED,
      ]);
    });
    const res = await saveDays(server, token, { [SET_RATED]: { startTime: '22:30', endTime: '23:30' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await rowsFor('set_ratings', 'user_id, set_id, rating, note'), [
      { user_id: USER_ID, set_id: SET_RATED, rating: 4, note: 'great' },
    ]);
  });
  test('keeps a set display name across a save that leaves it out, and clears it on null', async () => {
    const server = await startServer();
    servers.push(server);
    const token = await loginAdmin(server);
    const shown = async () => {
      const res = await server.request.get(`/api/v1/festivals/${FEST_ID}`).expect(200);
      const set = res.body.data.days[0].sets.find((s: any) => s.id === SET_KEPT);
      return set.displayName;
    };

    await saveDays(server, token, { [SET_KEPT]: { displayName: 'Kept Project (A x B)' } }).expect(200);
    assert.equal(await shown(), 'Kept Project (A x B)');

    await saveDays(server, token).expect(200);
    assert.equal(await shown(), 'Kept Project (A x B)', 'a save without displayName keeps it');

    await saveDays(server, token, { [SET_KEPT]: { displayName: null } }).expect(200);
    assert.equal(await shown(), undefined, 'null clears it');
  });
});
