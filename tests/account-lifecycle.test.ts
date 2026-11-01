import 'dotenv/config';
/**
 * Integration tests for the account lifecycle fixes of tranche T5:
 * change password (body token only for native clients), delete-then-sign-in
 * reactivation with picks and notes restored, the 30-day bound, and a
 * pending email change that survives "resend verification".
 *
 * DB-gated like tests/account.test.ts: set TEST_DATABASE_URL to run.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { afterEach, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { createFestivalPlanner } from '../server';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PASSWORD = 'Str0ngLife!Cycle9';
const NEW_PASSWORD = 'N3wer!Cycle#Pass';
const TRUSTED_MUTATION_HEADER = 'x-festie-request';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const RUN_TAG = `lc${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FESTIVAL_ID = `fest-${RUN_TAG}`;
const STAGE_ID = `stage-${RUN_TAG}`;
const SET_ID = `set-${RUN_TAG}`;

let testDbReady = false;

async function withPool<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function ensureTestSchema() {
  if (testDbReady) return;
  await withPool(async (pool) => {
    const { rows } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1");
    if (rows.length === 0) {
      await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
      await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '004_postgresql_baseline.sql'), 'utf8'));
    }
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.startsWith('004_')).sort();
    for (const file of files) {
      await pool.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8')).catch(() => {});
    }
  });
  testDbReady = true;
}

async function resetData() {
  await withPool(async (pool) => {
    await pool.query(`
      TRUNCATE TABLE
        email_verification_tokens, password_reset_tokens,
        audit_log, notification_topic_subs, notification_counts, notification_log,
        notification_preferences, device_tokens,
        crew_members, crews, festival_profile_notes,
        festival_profile_picks, festival_profiles, festival_sets, festival_days,
        festival_stages, festivals, user_sessions, user_roles, users
      CASCADE
    `);
    await pool.query(
      'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
      [FESTIVAL_ID, 'Lifecycle Fest', 'Ground'],
    );
    await pool.query('INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, 0)', [
      FESTIVAL_ID,
      STAGE_ID,
      'Main',
      '#ff0000',
    ]);
    await pool.query('INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, $2, $3)', [
      FESTIVAL_ID,
      'Day 1',
      '2026-07-01',
    ]);
    await pool.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order)
       VALUES ($1, $2, 0, $3, $4, '20:00', '21:00', 0)`,
      [SET_ID, FESTIVAL_ID, 'Alpha', STAGE_ID],
    );
  });
}

async function startServer() {
  await ensureTestSchema();
  await resetData();
  const planner = await createFestivalPlanner({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR,
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    AUTH_RATE_LIMIT_MAX: 1000,
    // Empty key keeps every email send on the skip path (no network).
    RESEND_API_KEY: '',
    EMAIL_FROM: 'test@example.com',
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  const { port } = planner.server.address() as { port: number };
  return {
    planner,
    // Requests go to the listening server so the Host header is known and a
    // same-host Origin passes the CSRF origin check.
    request: request(planner.server),
    origin: `http://127.0.0.1:${port}`,
    async close() {
      await planner.close();
    },
  };
}

type Server = Awaited<ReturnType<typeof startServer>>;

async function register(server: Server, username: string, email?: string) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password: PASSWORD, confirmPassword: PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.data.user.id as string, token: res.body.data.token as string };
}

async function login(server: Server, username: string, password = PASSWORD) {
  return server.request.post('/api/v1/auth/login').set(TRUSTED_MUTATION_HEADER, '1').send({ username, password });
}

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close().catch(() => {});
});

let counter = 0;
const uniqueName = (prefix: string) => `${prefix}${RUN_TAG}${++counter}`.slice(0, 30);

describe('account lifecycle', { concurrency: 1, skip }, () => {
  test('change password with the exact client body rotates the session token', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await register(server, uniqueName('cp'));

    const res = await server.request
      .post('/api/v1/auth/change-password')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.token, 'native client gets the new token in the body');

    const oldSession = await server.request.get('/api/v1/auth/me').set('x-user-token', user.token);
    assert.equal(oldSession.status, 401);
    const newSession = await server.request.get('/api/v1/auth/me').set('x-user-token', res.body.data.token);
    assert.equal(newSession.status, 200);
  });

  test('change password from a browser origin returns no body token', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await register(server, uniqueName('cpw'));

    const res = await server.request
      .post('/api/v1/auth/change-password')
      .set('x-user-token', user.token)
      .set('Origin', server.origin)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.success, true);
    assert.equal('token' in res.body.data, false);
  });

  test('delete then sign in restores the account, its pick and its note', async () => {
    const server = await startServer();
    servers.push(server);
    const username = uniqueName('del');
    const user = await register(server, username);

    const joined = await server.request
      .post('/api/v1/profiles')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalId: FESTIVAL_ID });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    const profileId = joined.body.data.id;
    const saved = await server.request
      .put(`/api/v1/profiles/${profileId}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { [SET_ID]: 'must' }, notes: { [SET_ID]: 'front left' } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const deleted = await server.request
      .delete('/api/v1/account/')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: PASSWORD });
    assert.equal(deleted.status, 200);
    assert.match(deleted.body.data.message, /Sign in before then to keep it\.$/);

    const res = await login(server, username);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.reactivated, true);

    const profiles = await server.request
      .get(`/api/v1/profiles/${FESTIVAL_ID}`)
      .set('x-user-token', res.body.data.token);
    assert.equal(profiles.status, 200, JSON.stringify(profiles.body));
    const own = profiles.body.data.find((p: { id: string }) => p.id === profileId);
    assert.ok(own, 'the profile is live again');
    assert.equal(own.picks[SET_ID], 'must');
    assert.equal(own.notes[SET_ID], 'front left');
  });

  test('an account deleted more than 30 days ago cannot sign in', async () => {
    const server = await startServer();
    servers.push(server);
    const username = uniqueName('old');
    const user = await register(server, username);
    await server.request
      .delete('/api/v1/account/')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: PASSWORD })
      .expect(200);
    await withPool((pool) =>
      pool.query("UPDATE users SET deleted_at = NOW() - INTERVAL '31 days' WHERE id = $1", [user.id]),
    );

    const res = await login(server, username);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('a normal login has no reactivated field', async () => {
    const server = await startServer();
    servers.push(server);
    const username = uniqueName('norm');
    await register(server, username);

    const res = await login(server, username);
    assert.equal(res.status, 200);
    assert.equal('reactivated' in res.body.data, false);
  });

  test('resend verification keeps a pending email-change link, and /me shows it', async () => {
    const server = await startServer();
    servers.push(server);
    const emailA = `a-${RUN_TAG}@example.org`;
    const emailB = `b-${RUN_TAG}@example.org`;
    const user = await register(server, uniqueName('em'), emailA);

    const changed = await server.request
      .post('/api/v1/account/email')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: emailB, password: PASSWORD });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));

    const resent = await server.request
      .post('/api/v1/auth/resend-verification')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(resent.status, 200, JSON.stringify(resent.body));

    const { rows } = await withPool((pool) =>
      pool.query('SELECT 1 FROM email_verification_tokens WHERE user_id = $1 AND email = $2 AND used_at IS NULL', [
        user.id,
        emailB,
      ]),
    );
    assert.equal(rows.length, 1, 'the change link for B is still live');

    const me = await server.request.get('/api/v1/auth/me').set('x-user-token', user.token);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.pendingEmail, emailB);
  });
});
