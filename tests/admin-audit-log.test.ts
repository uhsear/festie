import 'dotenv/config';
/**
 * Integration tests: admin audit log (T4 P3).
 * Covers: web-vitals beacons write no rows, a role grant writes exactly one
 * admin-typed row, a user delete writes one row with targetUsername, the
 * default scope is admin-only with meta at the top level, and page 2 shares no
 * ids with page 1.
 *
 * Skip-gate on TEST_DATABASE_URL. DELETE BY EXACT ID / run-scoped username on teardown.
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

const RUN_ID = `aud${Date.now().toString(36)}`;
const ADMIN = `aud-${RUN_ID}-admin`;
const TARGET = `aud-${RUN_ID}-target`;

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
    const like = [`aud-${RUN_ID}%`];
    await pool.query('DELETE FROM audit_log WHERE details_json::text LIKE $1 OR actor_id IN (SELECT id FROM users WHERE username LIKE $2)', [`%${RUN_ID}%`, like[0]]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
    await pool.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
    await pool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)', like);
    await pool.query('DELETE FROM users WHERE username LIKE $1', like);
  });
});

describe('admin audit log', { skip, concurrency: 1 }, () => {
  test('beacons skipped, one admin row per action, scoped and paged reads', async () => {
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
      const register = (username: string) =>
        api
          .post('/api/v1/auth/register')
          .set(TRUSTED_MUTATION_HEADER, '1')
          .send({ username, password: ADMIN_PASSWORD, confirmPassword: ADMIN_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true })
          .expect(201);
      const registered = await register(ADMIN);
      const target = await register(TARGET);
      const targetId = target.body.data.user.id;
      await withPool((pool) =>
        pool.query(
          `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
           SELECT u.id, r.id, NULL, NOW() FROM users u, roles r
           WHERE u.username = $1 AND r.name = 'admin'
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [ADMIN],
        ),
      );
      const login = await api
        .post('/api/v1/auth/login')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: ADMIN, password: ADMIN_PASSWORD })
        .expect(200);
      const token = login.body.data.token;
      const adminId = registered.body.data.user.id;
      const authed = (req: any) => req.set('x-user-token', token).set(TRUSTED_MUTATION_HEADER, '1');
      const countRows = (where: string, params: any[]) =>
        withPool(async (pool) => Number((await pool.query(`SELECT COUNT(*) AS n FROM audit_log WHERE ${where}`, params)).rows[0].n));

      // 1. Ten web-vitals beacons write zero rows.
      const before = await countRows("action LIKE '%web-vitals%' OR action LIKE '%metrics%'", []);
      for (let i = 0; i < 10; i++) {
        await api.post('/api/v1/metrics/web-vitals').set(TRUSTED_MUTATION_HEADER, '1').send({ name: 'LCP', value: 1, id: `v${i}` });
      }
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await countRows("action LIKE '%web-vitals%' OR action LIKE '%metrics%'", []), before);

      // 2. Role grant needs re-auth, then writes exactly one admin row.
      const grant = () => authed(api.post(`/api/v1/admin/users/${targetId}/roles`)).send({ role: 'admin' });
      const refused = await grant();
      assert.equal(refused.status, 403);
      assert.equal(refused.body.error.code, 'REAUTH_REQUIRED');
      await authed(api.post('/api/v1/auth/reauth')).send({ password: ADMIN_PASSWORD }).expect(200);
      await grant().expect(200);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await countRows("action = 'role_grant' AND target_id = $1 AND actor_type = 'admin'", [targetId]), 1);
      // The successful grant has no generic duplicate; the refused attempt stays on record as a failure.
      assert.equal(await countRows("target_id = $1 AND action <> 'role_grant' AND status = 'success'", [targetId]), 0);
      assert.equal(await countRows("target_id = $1 AND status = 'failure' AND actor_type = 'admin'", [targetId]), 1);

      // 3. User delete writes one admin_delete_user row with targetUsername.
      await authed(api.delete(`/api/v1/admin/users/${targetId}`)).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      const del: any = await withPool((pool) =>
        pool.query("SELECT details_json FROM audit_log WHERE action = 'admin_delete_user' AND target_id = $1", [targetId]),
      );
      assert.equal(del.rows.length, 1);
      const details = typeof del.rows[0].details_json === 'string' ? JSON.parse(del.rows[0].details_json) : del.rows[0].details_json;
      assert.equal(details.targetUsername, TARGET);

      // 4. Default scope is admin-only, meta is flat.
      const page1 = await authed(api.get('/api/v1/admin/audit?limit=1')).expect(200);
      assert.ok(page1.body.data.length === 1);
      assert.ok(page1.body.data.every((e: any) => e.actorType === 'admin'));
      assert.equal(typeof page1.body.meta.total, 'number');
      assert.equal(page1.body.meta.meta, undefined);
      assert.ok(page1.body.meta.nextCursor);
      assert.ok(page1.body.data[0].friendlyAction);
      assert.equal(page1.body.data[0].actorUsername, ADMIN);
      assert.equal(page1.body.data[0].actorId, adminId);

      // 5. Page 2 shares no ids with page 1.
      const page2 = await authed(
        api.get(`/api/v1/admin/audit?limit=1&cursor=${encodeURIComponent(page1.body.meta.nextCursor)}`),
      ).expect(200);
      const ids1 = new Set(page1.body.data.map((e: any) => e.id));
      assert.ok(page2.body.data.length > 0);
      assert.ok(page2.body.data.every((e: any) => !ids1.has(e.id)));
    } finally {
      await planner.close();
    }
  });
});
