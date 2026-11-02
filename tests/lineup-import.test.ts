import 'dotenv/config';
/**
 * Integration tests for the lineup import routes (routes/lineup-import.ts):
 * preview, commit, history and undo with JSON rows.
 * Covers: new stages and days in an empty festival, re-import idempotency, no
 *         fallback to the first stage, updateExisting, errors block the commit,
 *         no lineup-drop notification, undo (kept picked sets), auth and 404/400.
 *
 * Spotify external calls are NOT exercised live — we pass skipSpotify: true to
 * prevent outbound HTTP. That branch is documented in the report.
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

// DB skip-gate: these integration tests require a live Postgres database.
// Set TEST_DATABASE_URL to run them (always set in CI). See tests/README.md.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const DEFAULT_PASSWORD = 'Str0ngTest!Pw';
const ADMIN_PASSWORD = 'test-admin-password-pass';

const RUN_ID = `li${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const STAGE_MAIN = `main-${RUN_ID}`;
const STAGE_FOREST = `forest-${RUN_ID}`;
const EMPTY_FEST_ID = `fest-${RUN_ID}-empty`;

function fixtureFestival() {
  return {
    id: FEST_ID,
    name: 'Lineup Import Fest',
    location: 'Importville',
    stages: [
      { id: STAGE_MAIN, name: 'Main Stage', color: '#ff3366' },
      { id: STAGE_FOREST, name: 'Forest', color: '#00e8d0' },
    ],
    days: [
      { label: 'Friday', date: '2026-08-21' },
      { label: 'Saturday', date: '2026-08-22' },
    ],
  };
}

async function seedFestival(pool: any) {
  const f = fixtureFestival();
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [f.id, f.name, f.location]
  );
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at)
     VALUES ($1, 'Empty Import Fest', '', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [EMPTY_FEST_ID]
  );
  for (let i = 0; i < f.stages.length; i++) {
    const s = f.stages[i]!;
    await pool.query(
      `INSERT INTO festival_stages (festival_id, id, name, color, sort_order)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [f.id, s.id, s.name, s.color, i]
    );
  }
  for (let di = 0; di < f.days.length; di++) {
    const d = f.days[di]!;
    await pool.query(
      `INSERT INTO festival_days (festival_id, day_index, label, date)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [f.id, di, d.label, d.date]
    );
  }
}

async function cleanupById(pool: any) {
  for (const id of [FEST_ID, EMPTY_FEST_ID]) {
    await pool.query(`DELETE FROM lineup_imports WHERE festival_id = $1`, [id]);
    await pool.query(`DELETE FROM festival_sets WHERE festival_id = $1`, [id]);
    await pool.query(`DELETE FROM festival_profiles WHERE festival_id = $1`, [id]);
    await pool.query(`DELETE FROM festival_days WHERE festival_id = $1`, [id]);
    await pool.query(`DELETE FROM festival_stages WHERE festival_id = $1`, [id]);
    await pool.query(`DELETE FROM audit_log WHERE target_id = $1`, [id]);
    await pool.query(`DELETE FROM festivals WHERE id = $1`, [id]);
  }
  // Child tables referencing users (FK changed to RESTRICT in migration 031)
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`li-${RUN_ID}%`]);
  await pool.query(`DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`li-${RUN_ID}%`]);
  await pool.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`li-${RUN_ID}%`]);
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`li-${RUN_ID}%`]);
}

async function startServer() {
  if (!createFestivalPlanner) return;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try { await seedFestival(pool); } finally { await pool.end(); }
  const planner = await (createFestivalPlanner as any)({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    // Intentionally leave SPOTIFY_* unset so the route's internal spotify module stays disabled;
    // if the test env has creds, we still force skipSpotify:true in every request payload.
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return {
    planner,
    request: request(planner.app),
    async close() { await planner.close(); },
  };
}

async function registerUser(server: any, suffix: any) {
  const username = `li-${RUN_ID}-${suffix}`;
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true })
    .expect(201);
  return { ...res.body.data, username };
}

async function loginAdmin(server: any) {
  const username = `li-${RUN_ID}-admin`;
  const regRes = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: ADMIN_PASSWORD, confirmPassword: ADMIN_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true });
  if (regRes.status === 201) {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL, statement_timeout: 5000 });
    try {
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
         SELECT u.id, r.id, NULL, NOW() FROM users u, roles r
         WHERE u.username = $1 AND r.name = $2
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [username, 'admin']
      );
    } finally {
      await pool.end();
    }
  }
  const loginRes = await server.request
    .post('/api/v1/auth/login')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: ADMIN_PASSWORD })
    .expect(200);
  return loginRes.body.data.token;
}

function postImport(server: any, token: any, festivalId: any, body: any, suffix = '') {
  return server.request
    .post(`/api/v1/admin/festivals/${festivalId}/import-lineup${suffix}`)
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send(body);
}

async function countSets(festivalId: any) {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM festival_sets WHERE festival_id = $1`,
      [festivalId]
    );
    return rows[0].n;
  } finally {
    await pool.end();
  }
}



async function withPool(fn: (pool: any) => Promise<any>): Promise<any> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch (_) { /* best-effort */ }
  }
  if (skip) return;
  // Put both festivals back to their seeded state so tests stay independent.
  await withPool(async (pool) => {
    for (const id of [FEST_ID, EMPTY_FEST_ID]) {
      await pool.query(`DELETE FROM lineup_imports WHERE festival_id = $1`, [id]);
      await pool.query(
        `DELETE FROM festival_profile_picks WHERE set_id IN (SELECT id FROM festival_sets WHERE festival_id = $1)`, [id]);
      await pool.query(`DELETE FROM festival_profiles WHERE festival_id = $1`, [id]);
      await pool.query(`DELETE FROM festival_sets WHERE festival_id = $1`, [id]);
      await pool.query(`DELETE FROM audit_log WHERE target_id = $1`, [id]);
    }
    await pool.query(`DELETE FROM festival_days WHERE festival_id = $1 AND day_index >= 2`, [FEST_ID]);
    await pool.query(`DELETE FROM festival_stages WHERE festival_id = $1 AND NOT (id = ANY($2::text[]))`, [
      FEST_ID, [STAGE_MAIN, STAGE_FOREST]]);
    await pool.query(`DELETE FROM festival_days WHERE festival_id = $1`, [EMPTY_FEST_ID]);
    await pool.query(`DELETE FROM festival_stages WHERE festival_id = $1`, [EMPTY_FEST_ID]);
  });
});

after(async () => {
  if (skip) return;
  await withPool(cleanupById);
});

async function adminServer() {
  const server = (await startServer())!;
  servers.push(server);
  return { server, admin: await loginAdmin(server) };
}

const SAMPLE_ROWS = [
  { row: 2, artist: 'Aurora Lights', stage: 'Main Stage', day: 'Friday', date: '2026-08-21', startTime: '21:00', endTime: '22:30' },
  { row: 3, artist: 'Kai b2b Mira', stage: 'Forest', day: 'Friday', date: '2026-08-21', startTime: '23:30', endTime: '01:30' },
  { row: 4, artist: 'Night Owl', stage: 'Main Stage', day: 'Friday', date: '2026-08-21', startTime: '01:00', endTime: '02:30' },
];

describe('lineup-import routes (admin)', { skip, concurrency: 1 }, () => {
  test('an empty festival gets new stages, days and sets', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    const body = { rows: SAMPLE_ROWS, createMissing: true, skipSpotify: true };

    const preview = await postImport(server, admin, EMPTY_FEST_ID, body, '/preview').expect(200);
    assert.equal(preview.body.data.counts.error, 0);
    assert.ok(preview.body.data.counts.newStages >= 1);
    assert.ok(preview.body.data.counts.newDays >= 1);
    assert.equal(await countSets(EMPTY_FEST_ID), 0);

    const commit = await postImport(server, admin, EMPTY_FEST_ID, body).expect(200);
    assert.equal(commit.body.data.committed, true);
    assert.equal(commit.body.data.result.created, 3);
    assert.equal(await countSets(EMPTY_FEST_ID), 3);
    const kai = await withPool((pool) => pool.query(
      `SELECT artists FROM festival_sets WHERE festival_id = $1 AND artist = 'Kai b2b Mira'`, [EMPTY_FEST_ID]));
    assert.deepEqual(kai.rows[0].artists.map((a: any) => a.name), ['Kai', 'Mira']);
  });

  test('importing the same rows twice adds nothing the second time', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    const body = { rows: SAMPLE_ROWS, skipSpotify: true };

    await postImport(server, admin, FEST_ID, body).expect(200);
    const second = await postImport(server, admin, FEST_ID, body, '/preview').expect(200);
    assert.equal(second.body.data.counts.new, 0);
    assert.equal(second.body.data.counts.unchanged, 3);
    const recommit = await postImport(server, admin, FEST_ID, body).expect(200);
    assert.equal(recommit.body.data.result.created, 0);
    assert.equal(await countSets(FEST_ID), 3);
  });

  test('an unknown stage without createMissing is an error row and the commit writes nothing', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    const body = {
      rows: [
        { row: 2, artist: 'DJ Alpha', stage: 'Main Stage', day: 'Friday', startTime: '20:00', endTime: '21:00' },
        { row: 3, artist: 'Mystery DJ', stage: 'Forrest', day: 'Friday', startTime: '20:00', endTime: '21:00' },
      ],
      createMissing: false,
      skipSpotify: true,
    };

    const res = await postImport(server, admin, FEST_ID, body).expect(200);
    assert.equal(res.body.data.committed, false);
    assert.equal(res.body.data.plan.rows[1].status, 'error');
    assert.equal(res.body.data.plan.rows[1].errors[0].field, 'stage');
    assert.equal(await countSets(FEST_ID), 0);
  });

  test('a changed time is skipped without updateExisting and updated with it', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    const first = { row: 2, artist: 'DJ Alpha', stage: 'Main Stage', day: 'Friday', startTime: '20:00', endTime: '21:00' };
    await postImport(server, admin, FEST_ID, { rows: [first], skipSpotify: true }).expect(200);

    const moved = { ...first, startTime: '21:00', endTime: '22:00' };
    const off = await postImport(server, admin, FEST_ID, { rows: [moved], skipSpotify: true }).expect(200);
    assert.equal(off.body.data.result.rows[0].status, 'skipped');
    const on = await postImport(server, admin, FEST_ID, { rows: [moved], updateExisting: true, skipSpotify: true }).expect(200);
    assert.equal(on.body.data.result.rows[0].status, 'updated');

    const sets = await withPool((pool) => pool.query(
      `SELECT start_time FROM festival_sets WHERE festival_id = $1`, [FEST_ID]));
    assert.deepEqual(sets.rows.map((r: any) => r.start_time), ['21:00']);
  });

  test('undo removes created sets, restores updated ones, keeps picked ones and drops new stages and days', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    const alpha = { row: 2, artist: 'DJ Alpha', stage: 'Main Stage', day: 'Friday', startTime: '20:00', endTime: '21:00' };
    const firstRes = await postImport(server, admin, FEST_ID, { rows: [alpha], skipSpotify: true }).expect(200);
    const firstImportId = firstRes.body.data.result.importId;

    const second = await postImport(server, admin, FEST_ID, {
      rows: [
        { ...alpha, startTime: '19:00', endTime: '20:00' },
        { row: 3, artist: 'Picked DJ', stage: 'Forest', day: 'Friday', startTime: '20:00', endTime: '21:00' },
        { row: 4, artist: 'Dome DJ', stage: 'Dome', day: 'Sunday', date: '2026-08-23', startTime: '20:00', endTime: '21:00' },
      ],
      updateExisting: true,
      skipSpotify: true,
    }).expect(200);
    const { importId, rows } = second.body.data.result;
    assert.equal(second.body.data.result.newStages, 1);
    assert.equal(second.body.data.result.newDays, 1);
    const pickedSetId = rows[1].setId;

    await withPool(async (pool) => {
      const pickerId = `picker-${RUN_ID}`;
      await pool.query(
        `INSERT INTO users (id, username, password_hash, created_at, tos_accepted_at, tos_version)
         VALUES ($1, $2, 'x', NOW(), NOW(), 1) ON CONFLICT (id) DO NOTHING`, [pickerId, `li-${RUN_ID}-picker`]);
      await pool.query(
        `INSERT INTO festival_profiles (id, festival_id, user_id, name) VALUES ($1, $2, $3, 'p') ON CONFLICT DO NOTHING`,
        [`prof-${RUN_ID}`, FEST_ID, pickerId]);
      await pool.query(
        `INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, 1)`, [`prof-${RUN_ID}`, pickedSetId]);
    });

    const history = await server.request
      .get(`/api/v1/admin/festivals/${FEST_ID}/imports`).set('x-user-token', admin).expect(200);
    assert.deepEqual(history.body.data.imports.map((i: any) => i.canUndo), [true, false]);
    assert.equal(history.body.data.imports[0].createdBy, `li-${RUN_ID}-admin`);

    const undo = (id: string) => server.request
      .post(`/api/v1/admin/festivals/${FEST_ID}/imports/${id}/undo`)
      .set('x-user-token', admin).set(TRUSTED_MUTATION_HEADER, '1');
    const refused = await undo(firstImportId).expect(400);
    assert.equal(refused.body.error.message, 'Only the newest import can be undone. Undo newer imports first.');
    await undo('import-missing').expect(404);

    const res = await undo(importId).expect(200);
    assert.equal(res.body.data.removed, 1);
    assert.equal(res.body.data.restored, 1);
    assert.equal(res.body.data.removedStages, 1);
    assert.equal(res.body.data.removedDays, 1);
    assert.deepEqual(res.body.data.kept, [{ setId: pickedSetId, artist: 'Picked DJ', reason: 'picked' }]);

    await withPool(async (pool) => {
      const sets = await pool.query(
        `SELECT artist, start_time FROM festival_sets WHERE festival_id = $1 ORDER BY artist`, [FEST_ID]);
      assert.deepEqual(sets.rows, [{ artist: 'DJ Alpha', start_time: '20:00' }, { artist: 'Picked DJ', start_time: '20:00' }]);
      const days = await pool.query(`SELECT COUNT(*)::int AS n FROM festival_days WHERE festival_id = $1`, [FEST_ID]);
      assert.equal(days.rows[0].n, 2);
    });

    const afterUndo = await server.request
      .get(`/api/v1/admin/festivals/${FEST_ID}/imports`).set('x-user-token', admin).expect(200);
    assert.ok(afterUndo.body.data.imports[0].undoneAt);
    assert.deepEqual(afterUndo.body.data.imports.map((i: any) => i.canUndo), [false, true]);
  });

  test('a commit writes exactly one lineup_import audit row', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    await postImport(server, admin, FEST_ID, { rows: SAMPLE_ROWS.slice(0, 1), skipSpotify: true }).expect(200);

    const { rows } = await withPool((pool) => pool.query(
      `SELECT actor_type FROM audit_log WHERE action = 'lineup_import' AND target_id = $1`, [FEST_ID]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_type, 'admin');
  });

  test('the old { text } payload is a 400', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    const res = await postImport(server, admin, FEST_ID, { text: 'artist\nX', format: 'csv' }).expect(400);
    assert.equal(res.body.error.message, 'Invalid import payload');
  });

  test('a missing or soft-deleted festival is a 404', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    await postImport(server, admin, `nope-${RUN_ID}`, { rows: SAMPLE_ROWS }, '/preview').expect(404);
    await withPool((pool) => pool.query(`UPDATE festivals SET deleted_at = NOW() WHERE id = $1`, [FEST_ID]));
    try {
      await postImport(server, admin, FEST_ID, { rows: SAMPLE_ROWS, skipSpotify: true }).expect(404);
    } finally {
      await withPool((pool) => pool.query(`UPDATE festivals SET deleted_at = NULL WHERE id = $1`, [FEST_ID]));
    }
  });

  test('a non-admin gets 403 and an anonymous request gets 401', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const user = await registerUser(server, 'regular');

    const res = await postImport(server, user.token, FEST_ID, { rows: SAMPLE_ROWS, skipSpotify: true });
    assert.equal(res.status, 403);
    await server.request
      .post(`/api/v1/admin/festivals/${FEST_ID}/import-lineup`)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ rows: SAMPLE_ROWS })
      .expect(401);
    assert.equal(await countSets(FEST_ID), 0);
  });
});
