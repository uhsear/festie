import 'dotenv/config';
/**
 * Integration tests: POST /api/v1/auth/reauth and the 15-minute window that
 * gates DELETE /api/v1/admin/festivals/:id (T4 P1).
 * Covers: wrong password 403 PASSWORD_INCORRECT, delete refused without
 * re-auth, delete allowed inside the window, delete refused once reauth_at is
 * older than 15 minutes.
 *
 * Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID on teardown.
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { after, describe, test } from 'node:test';
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

const RUN_ID = `rea${Date.now().toString(36)}`;
const USERNAME = `rea-${RUN_ID}-admin`;
const FEST_ID = `fest-${RUN_ID}`;

async function withPool<T>(fn: (pool: any) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

after(async () => {
  if (skip) return;
  await withPool(async (pool) => {
    await pool.query('DELETE FROM audit_log WHERE target_id = $1', [FEST_ID]);
    await pool.query('DELETE FROM festivals WHERE id = $1', [FEST_ID]);
    const like = [`rea-${RUN_ID}%`];
    await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
    await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
    await pool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
    await pool.query('DELETE FROM users WHERE username LIKE $1', like);
  });
});

describe('re-auth window (admin festival delete)', { skip, concurrency: 1 }, () => {
  test('wrong password, no window, open window, expired window', async () => {
    await withPool((pool) =>
      pool.query(
        `INSERT INTO festivals (id, name, location, created_at, updated_at)
         VALUES ($1, 'Reauth Fest', 'Here', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
        [FEST_ID],
      ),
    );
    const planner = await (createFestivalPlanner as any)({
      DATABASE_URL: TEST_DATABASE_URL,
      PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(__dirname, '..'),
      NODE_ENV: 'test',
      REDIS_ENABLED: 'false',
      PUBLIC_ORIGIN: '',
    });
    await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
    try {
      const api = request(planner.app);
      await api
        .post('/api/v1/auth/register')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: USERNAME, password: ADMIN_PASSWORD, confirmPassword: ADMIN_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true })
        .expect(201);
      await withPool((pool) =>
        pool.query(
          `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
           SELECT u.id, r.id, NULL, NOW() FROM users u, roles r
           WHERE u.username = $1 AND r.name = 'admin'
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [USERNAME],
        ),
      );
      const login = await api
        .post('/api/v1/auth/login')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: USERNAME, password: ADMIN_PASSWORD })
        .expect(200);
      const token = login.body.data.token;
      const reauth = (password: string) =>
        api.post('/api/v1/auth/reauth').set('x-user-token', token).set(TRUSTED_MUTATION_HEADER, '1').send({ password });
      const del = () =>
        api.delete(`/api/v1/admin/festivals/${FEST_ID}`).set('x-user-token', token).set(TRUSTED_MUTATION_HEADER, '1');
      const reauthAt = () =>
        withPool(async (pool) => {
          // Register and login each create a session; only the login one is stamped.
          const { rows } = await pool.query(
            'SELECT MAX(reauth_at) AS reauth_at FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)',
            [USERNAME],
          );
          return rows[0]?.reauth_at ?? null;
        });

      const wrong = await reauth('not-the-password');
      assert.equal(wrong.status, 403);
      assert.equal(wrong.body.error.code, 'PASSWORD_INCORRECT');
      assert.equal(await reauthAt(), null);

      const refused = await del();
      assert.equal(refused.status, 403);
      assert.equal(refused.body.error.code, 'REAUTH_REQUIRED');

      const ok = await reauth(ADMIN_PASSWORD);
      assert.equal(ok.status, 200);
      assert.ok(new Date(ok.body.data.reauthUntil).getTime() > Date.now());
      assert.notEqual(await reauthAt(), null);

      await withPool((pool) =>
        pool.query(
          "UPDATE user_sessions SET reauth_at = NOW() - INTERVAL '16 minutes' WHERE user_id = (SELECT id FROM users WHERE username = $1)",
          [USERNAME],
        ),
      );
      const expired = await del();
      assert.equal(expired.status, 403);
      assert.equal(expired.body.error.code, 'REAUTH_REQUIRED');

      await reauth(ADMIN_PASSWORD).expect(200);
      const deleted = await del();
      assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    } finally {
      await planner.close();
    }
  });
});
