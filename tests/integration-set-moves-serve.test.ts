import 'dotenv/config';
/**
 * Integration tests: GET /festivals/:id serves "moved" marks (T46 P6).
 * Seeds a fresh mark and a 49-hour-old mark with SQL, then reads the festival
 * at depth 1 and depth 2, public and admin. Only the fresh set carries movedAt
 * and movedFrom. Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID on teardown.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { after, before, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { createFestivalPlanner } from '../server';
import { festivalSetResponseSchema } from '../lib/responseSchemas';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const ADMIN_PASSWORD = 'test-admin-password-serve';

const RUN_ID = `fsv${Date.now().toString(36)}`;
const FEST_ID = `fest-${RUN_ID}`;
const SAHARA = `sahara-${RUN_ID}`;
const FRESH = `fresh-${RUN_ID}`;
const STALE = `stale-${RUN_ID}`;
const PLAIN = `plain-${RUN_ID}`;
const FRESH_FROM = { dayIndex: 0, stageId: SAHARA, start: '22:00', end: '23:00' };

async function withPool<T>(fn: (pool: any) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function seed(pool: any) {
  await pool.query(
    `INSERT INTO festivals (id, name, location, created_at, updated_at, published_at)
     VALUES ($1, 'Serve Fest', 'Here', NOW(), NOW(), NOW())`,
    [FEST_ID],
  );
  await pool.query(
    `INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, 'Sahara', '#ff3366', 0)`,
    [FEST_ID, SAHARA],
  );
  await pool.query(
    `INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, 'Saturday', '2026-08-22')`,
    [FEST_ID],
  );
  const rows: [string, string, string, number | null, any][] = [
    [FRESH, '22:30', '23:30', 1, FRESH_FROM],
    [STALE, '20:00', '21:00', 49, { ...FRESH_FROM, start: '19:00', end: '20:00' }],
    [PLAIN, '18:00', '19:00', null, null],
  ];
  for (const [i, [id, start, end, hoursAgo, movedFrom]] of rows.entries()) {
    await pool.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists, moved_at, moved_from)
       VALUES ($1, $2, 0, $1, $3, $4, $5, $6, '[]', NOW() - make_interval(hours => $7::int), $8)`,
      [id, FEST_ID, SAHARA, start, end, i, hoursAgo, movedFrom ? JSON.stringify(movedFrom) : null],
    );
  }
}

async function cleanupById(pool: any) {
  await pool.query('DELETE FROM festival_sets WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_days WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festival_stages WHERE festival_id = $1', [FEST_ID]);
  await pool.query('DELETE FROM festivals WHERE id = $1', [FEST_ID]);
  const like = [`fsv-${RUN_ID}%`];
  await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM email_verification_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
  await pool.query('DELETE FROM users WHERE username LIKE $1', like);
}

async function loginAdmin(server: any) {
  const username = `fsv-${RUN_ID}-admin`;
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

let planner: any;
let server: any;

before(async () => {
  if (skip) return;
  await withPool(seed);
  planner = await (createFestivalPlanner as any)({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  server = { request: request(planner.app) };
  server.token = await loginAdmin(server);
});

after(async () => {
  if (skip) return;
  try {
    await planner?.close();
  } finally {
    await withPool(cleanupById);
  }
});

const cases = [
  { name: 'public', url: `/api/v1/festivals/${FEST_ID}`, admin: false },
  { name: 'admin', url: `/api/v1/admin/festivals/${FEST_ID}`, admin: true },
];

describe('GET serves fresh moved marks only', { skip, concurrency: 1 }, () => {
  for (const c of cases) {
    for (const depth of [1, 2]) {
      test(`${c.name}, depth ${depth}`, async () => {
        // Two calls: the second reads the same cached record, which must still be filtered.
        for (let call = 0; call < 2; call++) {
          let req = server.request.get(`${c.url}?depth=${depth}`);
          if (c.admin) req = req.set('x-user-token', server.token);
          const res = await req;
          assert.equal(res.status, 200, JSON.stringify(res.body));
          const sets = Object.fromEntries(res.body.data.days[0].sets.map((s: any) => [s.id, s]));
          assert.ok(Number.isFinite(Date.parse(sets[FRESH].movedAt)), 'movedAt is an ISO date');
          assert.ok(Date.now() - Date.parse(sets[FRESH].movedAt) < 2 * 60 * 60 * 1000);
          assert.deepEqual(sets[FRESH].movedFrom, FRESH_FROM);
          for (const id of [STALE, PLAIN]) {
            assert.equal('movedAt' in sets[id], false, `${id} has movedAt`);
            assert.equal('movedFrom' in sets[id], false, `${id} has movedFrom`);
          }
          const schema = depth === 1 ? festivalSetResponseSchema.omit({ linkUrl: true }) : festivalSetResponseSchema;
          for (const s of Object.values(sets)) schema.strict().parse(s);
        }
      });
    }
  }
});
