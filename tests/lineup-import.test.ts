import 'dotenv/config';
/**
 * Integration tests for lineup-import route (routes/lineup-import.js).
 * Covers: CSV parse, TSV parse, header detection, time normalization, stage/day
 *         row errors, dryRun, update-in-place, payload validation, admin-only gate, Spotify deferral
 *         (skipSpotify), empty-body rejection, soft-delete behavior on target
 *         festival.
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
  await pool.query(`DELETE FROM festival_sets WHERE festival_id = $1`, [FEST_ID]);
  await pool.query(`DELETE FROM festival_profiles WHERE festival_id = $1`, [FEST_ID]);
  await pool.query(`DELETE FROM festival_days WHERE festival_id = $1`, [FEST_ID]);
  await pool.query(`DELETE FROM festival_stages WHERE festival_id = $1`, [FEST_ID]);
  await pool.query(`DELETE FROM festivals WHERE id = $1`, [FEST_ID]);
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

function postImport(server: any, token: any, festivalId: any, body: any) {
  return server.request
    .post(`/api/v1/admin/festivals/${festivalId}/import-lineup`)
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

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch (_) { /* best-effort */ }
  }
  // Also clear any sets imported during the test to keep tests independent.
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query(`DELETE FROM festival_sets WHERE festival_id = $1`, [FEST_ID]);
  } finally {
    await pool.end();
  }
});

after(async () => {
  if (skip) return;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try { await cleanupById(pool); } finally { await pool.end(); }
});

describe('lineup-import route (admin)', { skip, concurrency: 1 }, () => {
  test('CSV with header row parses artists, stages, days, times', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const csv = [
      'artist,stage,day,startTime,endTime',
      'DJ Alpha,Main Stage,Friday,20:00,21:00',
      'DJ Beta,Forest,Saturday,22:00,23:30',
    ].join('\n');

    const res = await postImport(server, admin, FEST_ID, {
      text: csv, format: 'csv', skipSpotify: true,
    }).expect(200);

    assert.equal(res.body.data.imported, 2);
    const artists = res.body.data.rows.map((s: any) => s.artist);
    assert.ok(artists.includes('DJ Alpha'));
    assert.ok(artists.includes('DJ Beta'));
    assert.equal(await countSets(FEST_ID), 2);
  });

  test('TSV with explicit format:tsv parses tab-delimited rows', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const tsv = [
      'artist\tstage\tday\tstart\tend',
      'Tab Artist\tMain Stage\tFriday\t10:00\t11:00',
    ].join('\n');

    const res = await postImport(server, admin, FEST_ID, {
      text: tsv, format: 'tsv', skipSpotify: true,
    }).expect(200);

    assert.equal(res.body.data.imported, 1);
    assert.equal(res.body.data.rows[0].artist, 'Tab Artist');
    assert.equal(res.body.data.rows[0].startTime, '10:00');
  });

  test('format:auto detects TSV when tabs outnumber commas', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const tsv = 'artist\tstage\tday\tstart\tend\nAuto DJ\tForest\tSaturday\t18:00\t19:00';

    const res = await postImport(server, admin, FEST_ID, {
      text: tsv, format: 'auto', skipSpotify: true,
    }).expect(200);

    assert.equal(res.body.data.imported, 1);
    assert.equal(res.body.data.rows[0].artist, 'Auto DJ');
  });

  test('time normalization: 12-hour am/pm and short hours are padded to HH:mm', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const csv = [
      'artist,stage,day,startTime,endTime',
      'Noon DJ,Main Stage,Friday,9:30,10:30',
      'Night DJ,Main Stage,Saturday,11:00 PM,1:00 AM',
    ].join('\n');

    const res = await postImport(server, admin, FEST_ID, {
      text: csv, format: 'csv', skipSpotify: true,
    }).expect(200);

    const noon = res.body.data.rows.find((s: any) => s.artist === 'Noon DJ');
    const night = res.body.data.rows.find((s: any) => s.artist === 'Night DJ');
    assert.equal(noon.startTime, '09:30');
    assert.equal(night.startTime, '23:00');
    assert.equal(night.endTime, '01:00');
  });

  test('unknown stage is a row error, commit returns 400 and writes nothing', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const csv = [
      'artist,stage,day,startTime,endTime',
      'Mystery DJ,Pluto Stage,Friday,20:00,21:00',
    ].join('\n');

    const res = await postImport(server, admin, FEST_ID, {
      text: csv, format: 'csv', skipSpotify: true,
    }).expect(400);

    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.equal(res.body.error.preview.rows[0].status, 'error');
    assert.match(res.body.error.preview.rows[0].message, /not in this festival/);
    assert.equal(await countSets(FEST_ID), 0);
  });

  test('an empty day is a row error and day numbers are 1-based', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const csv = [
      'artist,stage,day,startTime,endTime',
      'No Day DJ,Main Stage,,20:00,21:00',
      'One DJ,Main Stage,1,20:00,21:00',
      'Two DJ,Main Stage,2,20:00,21:00',
    ].join('\n');

    const res = await postImport(server, admin, FEST_ID, {
      text: csv, format: 'csv', skipSpotify: true, dryRun: true,
    }).expect(200);

    const rows = res.body.data.rows;
    assert.equal(rows[0].status, 'error');
    assert.match(rows[0].message, /day "" is not in this festival/);
    assert.equal(rows[1].dayLabel, 'Friday');
    assert.equal(rows[2].dayLabel, 'Saturday');
  });

  test('dryRun with the web payload returns row statuses and writes nothing', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const csv = 'artist,stage,day,startTime,endTime\nDJ Alpha,Main Stage,Friday,20:00,21:00';
    const res = await postImport(server, admin, FEST_ID, {
      text: csv, format: 'auto', dryRun: true,
    }).expect(200);

    assert.equal(res.body.data.dryRun, true);
    assert.equal(res.body.data.rows[0].status, 'new');
    assert.equal(res.body.data.counts.new, 1);
    assert.equal(res.body.data.imported, 0);
    assert.equal(await countSets(FEST_ID), 0);
  });

  test('importing the same CSV twice with updateExisting reports unchanged and adds no sets', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const csv = [
      'artist,stage,day,startTime,endTime',
      'DJ Alpha,Main Stage,Friday,20:00,21:00',
      'DJ Beta,Forest,Saturday,22:00,23:30',
    ].join('\n');
    const body = { text: csv, format: 'csv', skipSpotify: true, updateExisting: true };

    await postImport(server, admin, FEST_ID, body).expect(200);
    const second = await postImport(server, admin, FEST_ID, body).expect(200);

    assert.deepEqual(second.body.data.rows.map((r: any) => r.status), ['unchanged', 'unchanged']);
    assert.equal(second.body.data.imported, 0);
    assert.equal(await countSets(FEST_ID), 2);
  });

  test('re-import with times fills them in, keeps set ids and keeps picks', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    await postImport(server, admin, FEST_ID, {
      text: 'artist,stage,day\nDJ Alpha,Main Stage,Friday', format: 'csv', skipSpotify: true,
    }).expect(200);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query(`SELECT id FROM festival_sets WHERE festival_id = $1`, [FEST_ID]);
      const setId = rows[0].id;
      const profileId = `prof-${RUN_ID}`;
      await pool.query(
        `INSERT INTO festival_profiles (id, festival_id, name) VALUES ($1, $2, 'p') ON CONFLICT DO NOTHING`,
        [profileId, FEST_ID]
      );
      await pool.query(
        `INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING`,
        [profileId, setId]
      );

      const res = await postImport(server, admin, FEST_ID, {
        text: 'artist,stage,day,start,end\nDJ Alpha,Main Stage,Friday,20:00,21:00',
        format: 'csv', skipSpotify: true, updateExisting: true,
      }).expect(200);
      assert.equal(res.body.data.updated, 1);

      const after = await pool.query(
        `SELECT id, start_time, end_time FROM festival_sets WHERE festival_id = $1`, [FEST_ID]);
      assert.equal(after.rows.length, 1);
      assert.equal(after.rows[0].id, setId);
      assert.equal(after.rows[0].start_time, '20:00');
      const picks = await pool.query(`SELECT 1 FROM festival_profile_picks WHERE set_id = $1`, [setId]);
      assert.equal(picks.rows.length, 1);
      await pool.query(`DELETE FROM festival_profile_picks WHERE set_id = $1`, [setId]);
      await pool.query(`DELETE FROM festival_profiles WHERE festival_id = $1`, [FEST_ID]);
    } finally {
      await pool.end();
    }
  });

  test('a row overlapping an existing set on the same stage is a festival-level error', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    await postImport(server, admin, FEST_ID, {
      text: 'artist,stage,day,start,end\nDJ Alpha,Main Stage,Friday,20:00,21:00', format: 'csv', skipSpotify: true,
    }).expect(200);

    const res = await postImport(server, admin, FEST_ID, {
      text: 'artist,stage,day,start,end\nDJ Clash,Main Stage,Friday,20:30,21:30', format: 'csv', skipSpotify: true,
    }).expect(400);

    assert.ok(res.body.error.preview.errors.some((e: string) => e.startsWith('Stage overlap on')));
    assert.equal(await countSets(FEST_ID), 1);
  });

  test('a commit writes exactly one lineup_import audit row', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    await postImport(server, admin, FEST_ID, {
      text: 'artist,stage,day,start,end\nDJ Alpha,Main Stage,Friday,20:00,21:00', format: 'csv', skipSpotify: true,
    }).expect(200);

    await new Promise((r) => setTimeout(r, 200));
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query(
        `SELECT actor_type FROM audit_log WHERE action = 'lineup_import' AND target_id = $1`, [FEST_ID]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].actor_type, 'admin');
    } finally {
      await pool.end();
    }
  });

  test('rejects empty body with 400 (zod validation)', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    await postImport(server, admin, FEST_ID, { text: '', skipSpotify: true }).expect(400);
    await postImport(server, admin, FEST_ID, { skipSpotify: true }).expect(400);
  });

  test('rejects text where no row has a valid artist → 400 no valid sets', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    // Header claims artist column exists, but every data row has empty artist.
    const csv = 'artist,stage,day,startTime,endTime\n,,Friday,20:00,21:00';
    const res = await postImport(server, admin, FEST_ID, {
      text: csv, format: 'csv', skipSpotify: true,
    });
    assert.equal(res.status, 400);
  });

  test('admin-only gate: non-admin user gets 403', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const user = await registerUser(server, 'regular');

    const csv = 'artist,stage,day,startTime,endTime\nHax DJ,Main Stage,Friday,20:00,21:00';
    const res = await postImport(server, user.token, FEST_ID, {
      text: csv, format: 'csv', skipSpotify: true,
    });
    // Route uses adminAuth → expect 401 (missing token treated as unauth) or 403 (authed but not admin).
    assert.ok([401, 403].includes(res.status), `got ${res.status}`);
    // No sets were written
    assert.equal(await countSets(FEST_ID), 0);
  });

  test('unauthenticated request returns 401', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);

    const csv = 'artist,stage,day,startTime,endTime\nAnon,Main Stage,Friday,20:00,21:00';
    await server.request
      .post(`/api/v1/admin/festivals/${FEST_ID}/import-lineup`)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ text: csv, format: 'csv', skipSpotify: true })
      .expect(401);
  });

  test('Spotify deferral: skipSpotify:true reports spotifyMatched:0 regardless of credentials', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const csv = 'artist,stage,day,startTime,endTime\nNoLink DJ,Main Stage,Friday,20:00,21:00';
    const res = await postImport(server, admin, FEST_ID, {
      text: csv, format: 'csv', skipSpotify: true,
    }).expect(200);

    assert.equal(res.body.data.spotifyMatched, 0);
  });

  test('soft-delete handling: importing into a soft-deleted festival returns 404', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    // Soft-delete the festival directly in the DB (simulates admin soft-delete path).
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query(`UPDATE festivals SET deleted_at = NOW() WHERE id = $1`, [FEST_ID]);
    } finally {
      await pool.end();
    }

    const csv = 'artist,stage,day,startTime,endTime\nGhost,Main Stage,Friday,20:00,21:00';
    const res = await postImport(server, admin, FEST_ID, {
      text: csv, format: 'csv', skipSpotify: true,
    });
    assert.equal(res.status, 404);

    // Restore so other cleanup works.
    const pool2 = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool2.query(`UPDATE festivals SET deleted_at = NULL WHERE id = $1`, [FEST_ID]);
    } finally {
      await pool2.end();
    }
  });

  test('import into nonexistent festival returns 404', async () => {
    if (!createFestivalPlanner) return;
    const server = (await startServer())!;
    servers.push(server);
    const admin = await loginAdmin(server);

    const csv = 'artist,stage,day,startTime,endTime\nAnon,Main,Friday,20:00,21:00';
    await postImport(server, admin, `nope-${RUN_ID}`, {
      text: csv, format: 'csv', skipSpotify: true,
    }).expect(404);
  });
});
