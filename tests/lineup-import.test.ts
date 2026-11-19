import 'dotenv/config';
/**
 * Integration tests for the lineup import routes (routes/lineup-import.ts):
 * preview, commit, history and undo with JSON rows.
 * Covers: new stages and days in an empty festival, re-import idempotency, no
 *         fallback to the first stage, updateExisting, errors block the commit,
 *         no lineup-drop notification, undo (kept picked sets), auth and 404/400,
 *         and that a timed import writes no "set times are out" marker.
 *         A unit describe with mocked deps checks the commit sends no festival-wide alert and
 *         alerts the pickers of a set that got its first time on a released date.
 *
 * Spotify external calls are NOT exercised live — we pass skipSpotify: true to
 * prevent outbound HTTP. That branch is documented in the report.
 *
 * Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID on teardown.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { after, afterEach, describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { createFestivalPlanner } from '../server';
import { bootServer } from './_boot-server';
import createLineupImportRoute from '../routes/lineup-import';
import { createLineupImportsStore } from '../lib/db/stores/lineup-imports';
import { planLineupImport, withLockedArtists } from '../lib/lineup-import-plan';
import { artistNameKey } from '../lib/artist-key';

// DB skip-gate: these integration tests require a live Postgres database.
// Set TEST_DATABASE_URL to run them (always set in CI). See tests/README.md.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

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
  await pool.query(`DELETE FROM email_verification_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`, [`li-${RUN_ID}%`]);
  await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`li-${RUN_ID}%`]);
}

async function startServer() {
  // Intentionally leave SPOTIFY_* unset so the route's internal spotify module stays disabled;
  // if the test env has creds, we still force skipSpotify:true in every request payload.
  return bootServer(TEST_DATABASE_URL!, {}, async () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try { await seedFestival(pool); } finally { await pool.end(); }
  });
}

async function registerUser(server: any, suffix: any) {
  const username = `li-${RUN_ID}-${suffix}`;
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: `${username}@example.com` })
    .expect(201);
  return { ...res.body.data, username };
}

async function loginAdmin(server: any) {
  const username = `li-${RUN_ID}-admin`;
  const regRes = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: ADMIN_PASSWORD, confirmPassword: ADMIN_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: `${username}@example.com` });
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
    await pool.query(`UPDATE festivals SET set_times_out_at = NULL, lineup = '[]'::jsonb WHERE id = ANY($1::text[])`, [[FEST_ID, EMPTY_FEST_ID]]);
    // The import makes an artist row for each new name. Drop the ones the P6 tests create.
    await pool.query(`DELETE FROM artists WHERE name_key = ANY($1::text[]) AND id NOT LIKE $2`, [['Alok', 'Kai', 'Mira', 'Sub Focus', 'Zed'].map(artistNameKey), `ar-${RUN_ID}-%`]);
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

describe('lineup-import commit: picker alerts, no festival-wide alert (mocked deps)', () => {
  const stages = [{ id: 'main', name: 'Main' }];
  const festivalWith = (sets: any[]) => ({
    id: 'f-1',
    name: 'Fest',
    publishedAt: '2026-01-01T00:00:00.000Z',
    stages,
    days: [{ label: 'Fri', date: '2026-06-05', sets }],
    b2bSeparator: 'b2b',
  });
  const tba: any[] = [{ id: 's1', artist: 'Alpha', stageId: 'main', startTime: null, endTime: null }];
  const timed = [{ id: 's1', artist: 'Alpha', stageId: 'main', startTime: '20:00', endTime: '21:00' }];
  const timeShifted = [{ id: 's1', artist: 'Alpha', stageId: 'main', startTime: '21:00', endTime: '22:00' }];

  function build(committed: boolean, { before = tba, after = timed, released = [] as string[], published = true, pickersThrow = false } = {}) {
    const sendTimeRelease = mock.fn(async (_id: string, _key: string) => ({ queued: true }));
    const scheduleChanged = mock.fn(async (_arg: any) => {});
    const pickersBySet = mock.fn(async (_id: string, setIds: string[]) => {
      if (pickersThrow) throw new Error('db blip');
      return new Map(setIds.map((id) => [id, ['picker-1']]));
    });
    const reads: any[] = [{ ...festivalWith(before), publishedAt: published ? '2026-01-01T00:00:00.000Z' : null }, festivalWith(after)];
    const plan = { rows: [], counts: { error: 0 }, problems: [] };
    const warnings: any[] = [];
    const deps: any = {
      express,
      log: { info() {}, warn: (...args: any[]) => warnings.push(args), error() {}, debug() {} },
      config: {},
      adminAuth: (req: any, _res: any, next: any) => {
        req.user = { userId: 'admin-1' };
        next();
      },
      setNoStore: () => {},
      rateLimit: () => (_req: any, _res: any, next: any) => next(),
      sanitizeIdentifier: (v: string) => v,
      sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
      sendError: (res: any, status: number, message: string) => res.status(status).json({ data: null, error: { message } }),
      ErrorCodes: { INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
      stores: {
        festivals: { getById: async () => reads.shift() ?? festivalWith(after) },
        profiles: { pickersBySet },
        timeReleases: { releasedDates: async () => new Set(released) },
        lineupImports: {
          lookupArtists: async () => ({ byKey: new Map(), byId: new Map() }),
          commit: async () =>
            committed
              ? {
                  committed: true,
                  plan,
                  importId: 'imp-1',
                  writes: { inserts: [], updates: [], announced: { inserts: [], updates: [] }, newStages: [], newDays: [], spotifyMatched: 0 },
                }
              : { committed: false, plan },
        },
        auditLog: null,
      },
      invalidateFestivalCache: () => {},
      getRequestIp: () => '127.0.0.1',
      emitter: { scheduleChanged },
      reengagement: { sendTimeRelease, sendSetTimesOut: sendTimeRelease },
    };
    const app = express();
    app.use(express.json());
    deps.festivalAccess = () => deps.adminAuth;
    app.use(createLineupImportRoute(deps));
    return { app, sendTimeRelease, scheduleChanged, warnings };
  }
  const body = { rows: SAMPLE_ROWS.slice(0, 1), skipSpotify: true };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20)); // the alert runs after the response

  test('a committed import sends no festival-wide alert', async () => {
    const { app, sendTimeRelease } = build(true);
    await request(app).post('/f-1/import-lineup').send(body).expect(200);
    await settle();
    assert.equal(sendTimeRelease.mock.calls.length, 0);
  });

  test('a set that got its first time on a released date alerts its pickers', async () => {
    const { app, scheduleChanged } = build(true, { released: ['2026-06-05'] });
    await request(app).post('/f-1/import-lineup').send(body).expect(200);
    await settle();
    assert.equal(scheduleChanged.mock.calls.length, 1);
    const arg = scheduleChanged.mock.calls[0]!.arguments[0];
    assert.deepEqual(arg.changes.map((c: any) => c.setId), ['s1']);
    assert.deepEqual([...arg.pickersBySet], [['s1', ['picker-1']]]);
  });

  test('a set timed on a date with no release row alerts nobody', async () => {
    const { app, scheduleChanged } = build(true);
    await request(app).post('/f-1/import-lineup').send(body).expect(200);
    await settle();
    assert.equal(scheduleChanged.mock.calls.length, 0);
  });

  test('other time changes stay silent to pickers, even on a released date', async () => {
    const { app, scheduleChanged } = build(true, { before: timed, after: timeShifted, released: ['2026-06-05'] });
    await request(app).post('/f-1/import-lineup').send(body).expect(200);
    await settle();
    assert.equal(scheduleChanged.mock.calls.length, 0);
  });

  test('a draft festival and an import that did not commit alert nobody', async () => {
    const draft = build(true, { released: ['2026-06-05'], published: false });
    await request(draft.app).post('/f-1/import-lineup').send(body).expect(200);
    const notCommitted = build(false, { released: ['2026-06-05'] });
    await request(notCommitted.app).post('/f-1/import-lineup').send(body).expect(200);
    await settle();
    assert.equal(draft.scheduleChanged.mock.calls.length + notCommitted.scheduleChanged.mock.calls.length, 0);
  });

  test('a failure while alerting is logged and the import still answers 200', async () => {
    const { app, warnings } = build(true, { released: ['2026-06-05'], pickersThrow: true });
    const res = await request(app).post('/f-1/import-lineup').send(body).expect(200);
    assert.equal(res.body.data.committed, true);
    await settle();
    assert.deepEqual(warnings.map(([msg]) => msg), ['import picker alerts failed']);
  });
});

describe('lineup-import commit and undo: festival:updated and list cache (mocked deps)', () => {
  function build(publishedAt: string | null, calls: string[] = []) {
    const festivalUpdated = mock.fn((_arg: any) => {});
    const invalidateFestivalListCache = mock.fn(() => {});
    const festival = { id: 'f-1', name: 'Fest', publishedAt, stages: [], days: [], b2bSeparator: 'b2b' };
    const plan = { rows: [], counts: { error: 0 }, problems: [] };
    const deps: any = {
      express,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      config: {},
      adminAuth: (req: any, _res: any, next: any) => {
        req.user = { userId: 'admin-1' };
        next();
      },
      setNoStore: () => {},
      rateLimit: () => (_req: any, _res: any, next: any) => next(),
      sanitizeIdentifier: (v: string) => v,
      sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
      sendError: (res: any, status: number, message: string) => res.status(status).json({ data: null, error: { message } }),
      ErrorCodes: { INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
      stores: {
        festivals: {
          getById: async () => {
            calls.push('getById');
            return festival;
          },
        },
        lineupImports: {
          lookupArtists: async () => ({ byKey: new Map(), byId: new Map() }),
          commit: async () => ({
            committed: true,
            plan,
            importId: 'imp-1',
            writes: { inserts: [], updates: [], announced: { inserts: [], updates: [] }, newStages: [], newDays: [], spotifyMatched: 0 },
          }),
          undo: async () => {
            calls.push('undo');
            return { result: { removed: 0, restored: 0, removedStages: 0, removedDays: 0, kept: [] } };
          },
        },
        auditLog: null,
      },
      invalidateFestivalCache: () => {},
      invalidateFestivalListCache,
      emitter: { festivalUpdated },
      getRequestIp: () => '127.0.0.1',
      reengagement: { sendSetTimesOut: async () => ({}) },
    };
    const app = express();
    app.use(express.json());
    deps.festivalAccess = () => deps.adminAuth;
    app.use(createLineupImportRoute(deps));
    return { app, festivalUpdated, invalidateFestivalListCache };
  }
  const body = { rows: SAMPLE_ROWS.slice(0, 1), skipSpotify: true };
  const PUBLISHED = '2026-01-01T00:00:00.000Z';

  test('a commit on a published festival drops the list cache and emits festival:updated', async () => {
    const { app, festivalUpdated, invalidateFestivalListCache } = build(PUBLISHED);
    await request(app).post('/f-1/import-lineup').send(body).expect(200);
    assert.equal(invalidateFestivalListCache.mock.calls.length, 1);
    assert.deepEqual(festivalUpdated.mock.calls.map((c: any) => c.arguments[0].festival.id), ['f-1']);
  });

  test('an undo on a published festival drops the list cache and emits festival:updated', async () => {
    const { app, festivalUpdated, invalidateFestivalListCache } = build(PUBLISHED);
    await request(app).post('/f-1/imports/imp-1/undo').expect(200);
    assert.equal(invalidateFestivalListCache.mock.calls.length, 1);
    assert.deepEqual(festivalUpdated.mock.calls.map((c: any) => c.arguments[0].festival.id), ['f-1']);
  });

  test('an undo reads the festival before it commits, so a failed read cannot report a done undo as failed', async () => {
    const calls: string[] = [];
    const { app } = build(PUBLISHED, calls);
    await request(app).post('/f-1/imports/imp-1/undo').expect(200);
    assert.deepEqual(calls, ['getById', 'undo']);
  });

  test('a draft festival has no attendees, so nothing is emitted, but the list cache still drops', async () => {
    const { app, festivalUpdated, invalidateFestivalListCache } = build(null);
    await request(app).post('/f-1/import-lineup').send(body).expect(200);
    await request(app).post('/f-1/imports/imp-1/undo').expect(200);
    assert.equal(festivalUpdated.mock.calls.length, 0);
    assert.equal(invalidateFestivalListCache.mock.calls.length, 2);
  });
});

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

  test('a set_id row on another day is skipped and listed first, and the other rows commit', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    const alpha = { row: 2, artist: 'DJ Alpha', stage: 'Main Stage', day: 'Friday', startTime: '20:00', endTime: '21:00' };
    const beta = { row: 3, artist: 'DJ Beta', stage: 'Forest', day: 'Friday', startTime: '20:00', endTime: '21:00' };
    const seeded = await postImport(server, admin, FEST_ID, { rows: [alpha, beta], skipSpotify: true }).expect(200);
    const [alphaId, betaId] = seeded.body.data.result.rows.map((r: any) => r.setId);

    const res = await postImport(server, admin, FEST_ID, {
      rows: [
        { row: 2, setId: betaId, artist: 'DJ Beta', day: 'Friday', startTime: '21:00', endTime: '22:00' },
        { row: 3, setId: alphaId, artist: 'DJ Alpha', day: 'Saturday', startTime: '22:00', endTime: '23:00' },
      ],
      updateExisting: true,
      skipSpotify: true,
    }).expect(200);

    const { result } = res.body.data;
    assert.deepEqual(result.rows.map((r: any) => r.status), ['updated', 'skipped']);
    assert.equal(result.skipped, 1);
    assert.match(result.warnings[0], /^Row 3: Skipped: the file says Saturday, the stored day is Friday\./);
    const sets = await withPool((pool) => pool.query(
      `SELECT id, start_time FROM festival_sets WHERE festival_id = $1 ORDER BY id`, [FEST_ID]));
    assert.deepEqual(
      Object.fromEntries(sets.rows.map((r: any) => [r.id, r.start_time])),
      { [alphaId]: '20:00', [betaId]: '21:00' },
    );
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

  test('a repeat commit that changes nothing does not block undoing the real import', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    const rows = [{ row: 2, artist: 'DJ Repeat', stage: 'Main Stage', day: 'Friday', startTime: '20:00', endTime: '21:00' }];
    const first = await postImport(server, admin, FEST_ID, { rows, skipSpotify: true }).expect(200);
    await postImport(server, admin, FEST_ID, { rows, skipSpotify: true }).expect(200);
    const history = await server.request
      .get(`/api/v1/admin/festivals/${FEST_ID}/imports`).set('x-user-token', admin).expect(200);
    assert.equal(history.body.data.imports.find((i: any) => i.id === first.body.data.result.importId).canUndo, true);
    await server.request
      .post(`/api/v1/admin/festivals/${FEST_ID}/imports/${first.body.data.result.importId}/undo`)
      .set('x-user-token', admin).set(TRUSTED_MUTATION_HEADER, '1').expect(200);
  });

  test('the history names the festival dates an import touched', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    await postImport(server, admin, FEST_ID, { rows: SAMPLE_ROWS.slice(0, 1), skipSpotify: true }).expect(200);
    const history = await server.request
      .get(`/api/v1/admin/festivals/${FEST_ID}/imports`).set('x-user-token', admin).expect(200);
    assert.deepEqual(history.body.data.imports[0].touchedDates, ['2026-08-21']);
  });

  test('a commit writes exactly one festival.lineup.imported audit row', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    await postImport(server, admin, FEST_ID, { rows: SAMPLE_ROWS.slice(0, 1), skipSpotify: true }).expect(200);

    const { rows } = await withPool((pool) => pool.query(
      `SELECT actor_type FROM audit_log WHERE action = 'festival.lineup.imported' AND target_id = $1`, [FEST_ID]));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_type, 'admin');
  });

  test('an import that adds the first set times writes no marker and no release row', async () => {
    if (!createFestivalPlanner) return;
    const { server, admin } = await adminServer();
    await postImport(server, admin, EMPTY_FEST_ID, { rows: SAMPLE_ROWS, createMissing: true, skipSpotify: true }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 100)); // a stray trigger would run after the response
    const marker = await withPool((pool) =>
      pool.query(`SELECT set_times_out_at FROM festivals WHERE id = $1`, [EMPTY_FEST_ID]));
    assert.equal(marker.rows[0]?.set_times_out_at ?? null, null);
    const releases = await withPool((pool) =>
      pool.query(`SELECT 1 FROM festival_time_releases WHERE festival_id = $1`, [EMPTY_FEST_ID]));
    assert.equal(releases.rows.length, 0);
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

// ── P6: announced rows, day moves, display names, per-platform links and artist matching ──

const SPOTIFY_22 = 'https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg';
const AR = (suffix: string) => `ar-${RUN_ID}-${suffix}`;

async function seedArtist(pool: any, suffix: string, name: string, label = '', links: any = {}) {
  await pool.query(
    `INSERT INTO artists (id, name, name_key, label, links) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [AR(suffix), name, artistNameKey(name), label, JSON.stringify(links)],
  );
}

const undoImport = (server: any, token: string, festivalId: string, importId: string) =>
  server.request
    .post(`/api/v1/admin/festivals/${festivalId}/imports/${importId}/undo`)
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1');

const lineupOf = (festivalId: string) =>
  withPool(async (pool) => (await pool.query(`SELECT lineup FROM festivals WHERE id = $1`, [festivalId])).rows[0].lineup);

describe('lineup-import P6: announced rows', { skip }, () => {
  test('names with no day, stage or time become announced entries, re-import adds nothing, undo removes them', async () => {
    const { server, admin } = await adminServer();
    const rows = [
      { row: 1, artist: 'Alok' },
      { row: 2, artist: 'Kai b2b Mira', instagram: 'https://instagram.com/kai' },
    ];
    const commit = await postImport(server, admin, EMPTY_FEST_ID, { rows, skipSpotify: true }).expect(200);
    assert.equal(commit.body.data.committed, true);
    assert.equal(commit.body.data.result.created, 0);
    assert.equal(commit.body.data.result.announced, 2);
    assert.deepEqual(commit.body.data.result.rows.map((r: any) => r.message), ['Added to the announced lineup.', 'Added to the announced lineup.']);
    assert.equal(await countSets(EMPTY_FEST_ID), 0);

    const lineup = await lineupOf(EMPTY_FEST_ID);
    assert.deepEqual(lineup.map((e: any) => e.artists.map((a: any) => a.name)), [['Alok'], ['Kai', 'Mira']]);
    assert.deepEqual(lineup[1].artists[0].links, { instagram: 'https://www.instagram.com/kai' });
    assert.deepEqual({ status: lineup[0].status, dayDate: lineup[0].dayDate, tier: lineup[0].tier }, { status: 'announced', dayDate: null, tier: null });
    assert.match(lineup[0].announcedAt, /^\d{4}-\d{2}-\d{2}$/);

    const again = await postImport(server, admin, EMPTY_FEST_ID, { rows, skipSpotify: true }, '/preview').expect(200);
    assert.equal(again.body.data.counts.new, 0);
    assert.equal(again.body.data.counts.unchanged, 2);

    const undo = await undoImport(server, admin, EMPTY_FEST_ID, commit.body.data.result.importId).expect(200);
    assert.equal(undo.body.data.removedEntries, 2);
    assert.deepEqual(await lineupOf(EMPTY_FEST_ID), []);
  });

  test('undo keeps an entry that someone edited after the import, and puts back a changed one', async () => {
    const { server, admin } = await adminServer();
    const first = await postImport(server, admin, EMPTY_FEST_ID, { rows: [{ row: 1, artist: 'Alok' }, { row: 2, artist: 'Sub Focus' }], skipSpotify: true }).expect(200);
    const second = await postImport(server, admin, EMPTY_FEST_ID, {
      rows: [{ row: 1, artist: 'Alok', instagram: 'https://instagram.com/alok' }, { row: 2, artist: 'Zed', }],
      updateExisting: true,
      skipSpotify: true,
    }).expect(200);
    assert.equal(second.body.data.result.announced, 1);
    assert.equal(second.body.data.result.announcedUpdated, 1);
    await withPool((pool) => pool.query(
      `UPDATE festivals SET lineup = (SELECT jsonb_agg(CASE WHEN e->'artists'->0->>'name' = 'Zed' THEN jsonb_set(e, '{tier}', '2') ELSE e END) FROM jsonb_array_elements(lineup) e) WHERE id = $1`,
      [EMPTY_FEST_ID]));

    const undo = await undoImport(server, admin, EMPTY_FEST_ID, second.body.data.result.importId).expect(200);
    assert.equal(undo.body.data.restoredEntries, 1);
    assert.equal(undo.body.data.removedEntries, 0);
    assert.deepEqual(undo.body.data.kept.map((k: any) => [k.artist, k.reason]), [['Zed', 'edited']]);
    const lineup = await lineupOf(EMPTY_FEST_ID);
    assert.deepEqual(lineup.map((e: any) => e.artists[0].name).sort(), ['Alok', 'Sub Focus', 'Zed']);
    // The link lives on the artist's row, so an undo does not take it back: the restored entry shows the artist's links.
    assert.deepEqual(lineup.find((e: any) => e.artists[0].name === 'Alok').artists[0].links, { instagram: 'https://www.instagram.com/alok' });
    void first;
  });
});

describe('lineup-import P6: day moves, display names, links', { skip }, () => {
  const alpha = { row: 2, artist: 'DJ Alpha', stage: 'Main Stage', day: 'Friday', startTime: '20:00', endTime: '21:00' };

  test('a set id row with another day is skipped, moves with the option, and undo moves it back', async () => {
    const { server, admin } = await adminServer();
    const created = await postImport(server, admin, FEST_ID, { rows: [alpha], skipSpotify: true }).expect(200);
    const setId = created.body.data.result.rows[0].setId;
    const dayOf = async () => withPool(async (pool) => (await pool.query(`SELECT day_index, start_time FROM festival_sets WHERE id = $1`, [setId])).rows[0]);
    const moveRow = { row: 2, setId, artist: 'DJ Alpha', day: 'Saturday', startTime: '22:00', endTime: '23:00' };

    const skipped = await postImport(server, admin, FEST_ID, { rows: [moveRow], updateExisting: true, skipSpotify: true }).expect(200);
    assert.equal(skipped.body.data.result.rows[0].status, 'skipped');
    assert.match(skipped.body.data.result.rows[0].message, /^Skipped: the file says Saturday, the stored day is Friday\./);
    assert.deepEqual(await dayOf(), { day_index: 0, start_time: '20:00' });

    const moved = await postImport(server, admin, FEST_ID, { rows: [moveRow], updateExisting: true, moveDays: true, skipSpotify: true }).expect(200);
    assert.equal(moved.body.data.result.rows[0].status, 'updated');
    assert.deepEqual(await dayOf(), { day_index: 1, start_time: '22:00' });

    const undo = await undoImport(server, admin, FEST_ID, moved.body.data.result.importId).expect(200);
    assert.equal(undo.body.data.restored, 1);
    assert.deepEqual(await dayOf(), { day_index: 0, start_time: '20:00' });
  });

  test('undo keeps a moved set that an editor moved again', async () => {
    const { server, admin } = await adminServer();
    const created = await postImport(server, admin, FEST_ID, { rows: [alpha], skipSpotify: true }).expect(200);
    const setId = created.body.data.result.rows[0].setId;
    const moved = await postImport(server, admin, FEST_ID, {
      rows: [{ row: 2, setId, artist: 'DJ Alpha', day: 'Saturday' }], updateExisting: true, moveDays: true, skipSpotify: true,
    }).expect(200);
    await withPool((pool) => pool.query(`UPDATE festival_sets SET day_index = 0 WHERE id = $1`, [setId]));
    const undo = await undoImport(server, admin, FEST_ID, moved.body.data.result.importId).expect(200);
    assert.equal(undo.body.data.restored, 0);
    assert.deepEqual(undo.body.data.kept.map((k: any) => k.reason), ['edited']);
  });

  test('writes the display name and one link per platform, and undo puts the old name back', async () => {
    const { server, admin } = await adminServer();
    const first = await postImport(server, admin, FEST_ID, {
      rows: [{ ...alpha, displayName: 'Alpha Live', spotify: SPOTIFY_22, soundcloud: 'https://soundcloud.com/alpha' }], skipSpotify: true,
    }).expect(200);
    const read = () => withPool(async (pool) => (await pool.query(`SELECT display_name, link_url, artists FROM festival_sets WHERE festival_id = $1`, [FEST_ID])).rows[0]);
    const row = await read();
    assert.equal(row.display_name, 'Alpha Live');
    assert.equal(row.link_url, SPOTIFY_22);
    assert.deepEqual(row.artists[0].links, { spotify: SPOTIFY_22, soundcloud: 'https://soundcloud.com/alpha' });

    const renamed = await postImport(server, admin, FEST_ID, { rows: [{ ...alpha, displayName: 'Alpha Unplugged' }], updateExisting: true, skipSpotify: true }).expect(200);
    assert.equal((await read()).display_name, 'Alpha Unplugged');
    await undoImport(server, admin, FEST_ID, renamed.body.data.result.importId).expect(200);
    assert.equal((await read()).display_name, 'Alpha Live');
    void first;
  });
});

describe('lineup-import P6: artist matching', { skip }, () => {
  const cleanArtists = (pool: any) =>
    pool.query(`UPDATE artists SET merged_into = NULL WHERE id LIKE $1`, [`ar-${RUN_ID}-%`])
      .then(() => pool.query(`DELETE FROM artists WHERE id LIKE $1`, [`ar-${RUN_ID}-%`]));

  test('one live artist attaches its id, two with one name stop at Needs choice until a row names the id', async () => {
    const { server, admin } = await adminServer();
    await withPool(async (pool) => {
      await seedArtist(pool, 'alok', 'Alok', '', { instagram: 'https://www.instagram.com/alok' });
      await seedArtist(pool, 'uk', 'Nina Kraviz', 'UK');
      await seedArtist(pool, 'ru', 'Nina Kraviz', 'Russia');
    });
    try {
      const rows = [
        { row: 2, artist: 'Alok', stage: 'Main Stage', day: 'Friday', startTime: '20:00', endTime: '21:00' },
        { row: 3, artist: 'Nina Kraviz', stage: 'Forest', day: 'Friday', startTime: '20:00', endTime: '21:00' },
      ];
      const blocked = await postImport(server, admin, FEST_ID, { rows, skipSpotify: true }).expect(200);
      assert.equal(blocked.body.data.committed, false);
      assert.equal(blocked.body.data.plan.counts.needsChoice, 1);
      assert.deepEqual(blocked.body.data.plan.rows[1].resolutions[0].candidates.map((c: any) => c.label), ['Russia', 'UK']);
      assert.equal(await countSets(FEST_ID), 0);

      const picked = [rows[0]!, { ...rows[1]!, artistId: AR('ru') }];
      const committed = await postImport(server, admin, FEST_ID, { rows: picked, skipSpotify: true }).expect(200);
      assert.equal(committed.body.data.committed, true);
      const sets = await withPool((pool) => pool.query(`SELECT artist, artists FROM festival_sets WHERE festival_id = $1 ORDER BY artist`, [FEST_ID]));
      assert.deepEqual(sets.rows.map((r: any) => [r.artist, r.artists[0].id]), [['Alok', AR('alok')], ['Nina Kraviz', AR('ru')]]);
      assert.deepEqual(sets.rows[0].artists[0].links, { instagram: 'https://www.instagram.com/alok' });

      const again = await postImport(server, admin, FEST_ID, { rows, skipSpotify: true }, '/preview').expect(200);
      assert.equal(again.body.data.counts.needsChoice, 0, 'a matched set keeps its stored artist, so a re-import never asks again');
      assert.equal(again.body.data.counts.error, 0);
    } finally {
      await withPool(cleanArtists);
    }
  });

  test('a merged artist id is an error row, and commit refuses when an artist merges after the plan', async () => {
    const { server, admin } = await adminServer();
    await withPool(async (pool) => {
      await seedArtist(pool, 'keep', 'Keeper');
      await seedArtist(pool, 'gone', 'Gone Name');
      await pool.query(`UPDATE artists SET merged_into = $2 WHERE id = $1`, [AR('gone'), AR('keep')]);
    });
    try {
      const res = await postImport(server, admin, FEST_ID, {
        rows: [{ row: 2, artist: 'Gone Name', artistId: AR('gone'), stage: 'Main Stage', day: 'Friday' }], skipSpotify: true,
      }).expect(200);
      assert.equal(res.body.data.committed, false);
      assert.match(res.body.data.plan.rows[0].errors[0].message, /was merged into another artist/);

      await withPool(async (pool) => {
        const store = createLineupImportsStore(pool, { festivals: { getById: async () => ({}) } });
        const plan = { counts: { error: 0 }, problems: [] as string[] };
        const writes = { newStages: [], newDays: [], inserts: [], updates: [], announced: { inserts: [], updates: [] }, artistIds: [AR('gone')], spotifyMatched: 0 };
        const outcome: any = await store.commit(FEST_ID, () => ({ plan, writes }) as any, { createdBy: null });
        assert.equal(outcome.committed, false);
        assert.deepEqual(outcome.plan.problems, ['An artist changed while you were importing. Check the rows again.']);
      });
    } finally {
      await withPool(cleanArtists);
    }
  });

  test('commit plans from the locked artist rows, so an edit after the lookup reaches the new entry, and the lock query orders by id', async () => {
    await withPool(async (pool) => {
      await seedArtist(pool, 'late', 'Late Edit', '', { instagram: 'https://www.instagram.com/old' });
      const store = createLineupImportsStore(pool, { festivals: { getById: async () => ({}) } });
      try {
        const rows = [{ row: 1, artist: 'Late Edit', artistId: AR('late') }];
        const stale = await store.lookupArtists([], [AR('late')]);
        await pool.query(`UPDATE artists SET links = $2::jsonb WHERE id = $1`, [AR('late'), JSON.stringify({ instagram: 'https://www.instagram.com/new' })]);

        const sql: string[] = [];
        const spy = {
          connect: async () => {
            const client = await pool.connect();
            const run = client.query.bind(client);
            client.query = (text: any, ...rest: any[]) => (sql.push(String(text?.text ?? text)), run(text, ...rest));
            return client;
          },
        };
        const spied = createLineupImportsStore(spy as any, { festivals: { getById: async () => ({ id: EMPTY_FEST_ID, name: 'Empty', b2bSeparator: 'b2b', stages: [], days: [], lineup: [] }) } });
        const outcome: any = await spied.commit(
          EMPTY_FEST_ID,
          (f: any, locked?: Map<string, any>) =>
            planLineupImport({ festival: f, rows, options: { updateExisting: false, createMissing: true }, config: { MAX_IMPORT_SETS: 500, MAX_STAGES: 20, MAX_DAYS: 10, MAX_SETS_PER_DAY: 200 } as any, artists: locked ? withLockedArtists(stale, locked) : stale }),
          { createdBy: null },
        );
        assert.equal(outcome.committed, true);
        const lineup = await lineupOf(EMPTY_FEST_ID);
        assert.deepEqual(lineup.at(-1).artists[0].links, { instagram: 'https://www.instagram.com/new' });
        assert.match(sql.find((q) => q.includes('FOR SHARE')) ?? '', /ORDER BY\s+id\s+FOR SHARE/);
      } finally {
        await pool.query(`UPDATE festivals SET lineup = '[]'::jsonb WHERE id = $1`, [EMPTY_FEST_ID]);
        await cleanArtists(pool);
      }
    });
  });
});
