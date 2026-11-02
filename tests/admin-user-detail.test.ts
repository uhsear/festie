/**
 * Integration tests: admin user detail and support routes (T35 P1).
 * Covers: GET /admin/users/:id (detail, view audit row, 404, 403), server-side
 * user list paging and search, the audit action prefix filter, crew owner
 * removal guard, admin force-add audit row, and the reset link expiry.
 *
 * Skip-gate on TEST_DATABASE_URL. The helpers are imported only when the gate
 * passes, because they exit the process without a test database.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const ADMIN_PASSWORD = 'test-admin-password';
const servers: any[] = [];

async function helpers() {
  return import('./_integration-helpers');
}

async function withPool<T>(databaseUrl: string, fn: (pool: any) => Promise<T>): Promise<T> {
  const { Pool } = await helpers();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function setUp(overrides: Record<string, any> = {}) {
  const h = await helpers();
  const server = await h.startServer(overrides);
  servers.push(server);
  const adminToken = await h.loginAdmin(server);
  const adminId = await withPool(server.databaseUrl, async (pool) => {
    const { rows } = await pool.query("SELECT id FROM users WHERE username LIKE 'testadmin-%'");
    return rows[0].id as string;
  });
  return { h, server, adminToken, adminId };
}

async function reauth(server: any, token: string) {
  await server.request
    .post('/api/v1/auth/reauth')
    .set('x-user-token', token)
    .send({ password: ADMIN_PASSWORD })
    .expect(200);
}

async function auditRows(databaseUrl: string, where: string, params: any[]) {
  return withPool(databaseUrl, async (pool) => {
    const { rows } = await pool.query(
      `SELECT action, actor_id, target_type, target_id FROM audit_log WHERE ${where}`,
      params,
    );
    return rows;
  });
}

// The generic audit middleware writes on response finish, so give it a moment.
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — admin user detail and support routes', { skip, concurrency: 1 }, () => {
  test('detail shows picks, crew role, verified and last active, and records one view', async () => {
    const { h, server, adminToken, adminId } = await setUp();
    const carol = await h.registerUser(server, 'carol');
    const profile = await h.joinFestivalProfile(server, carol.token);
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', carol.token)
      .send({ picks: { 'set-a': 'must', 'set-b': 'maybe', 'set-c': 'must' } })
      .expect(200);
    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', carol.token)
      .send({ name: 'Carol Crew', festivalId: 'fest-1' })
      .expect(201);
    await h.loginUser(server, 'carol');

    const res = await server.request
      .get(`/api/v1/admin/users/${carol.user.id}`)
      .set('x-user-token', adminToken)
      .expect(200);

    const { user, festivals, crews, activity } = res.body.data;
    assert.equal(user.username, 'carol');
    assert.equal(user.emailVerified, false);
    assert.ok(user.lastActiveAt, 'lastActiveAt is set after login');
    assert.equal(festivals.length, 1);
    assert.equal(festivals[0].festivalId, 'fest-1');
    assert.equal(festivals[0].picks, 3);
    assert.equal(crews.length, 1);
    assert.equal(crews[0].id, crewRes.body.data.id);
    assert.equal(crews[0].role, 'owner');
    assert.equal(crews[0].memberCount, 1);
    assert.ok(Array.isArray(activity));

    const views = await auditRows(server.databaseUrl, 'action = $1', ['user.private_data.viewed']);
    assert.equal(views.length, 1);
    assert.equal(views[0].actor_id, adminId);
    assert.equal(views[0].target_type, 'user');
    assert.equal(views[0].target_id, carol.user.id);

    const missing = await server.request
      .get('/api/v1/admin/users/no-such-user')
      .set('x-user-token', adminToken)
      .expect(404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
    const viewsAfter404 = await auditRows(server.databaseUrl, 'action = $1', ['user.private_data.viewed']);
    assert.equal(viewsAfter404.length, 1);

    await server.request.get(`/api/v1/admin/users/${carol.user.id}`).set('x-user-token', carol.token).expect(403);
  });

  test('user list pages on the server with a true total and searches every user', async () => {
    const { h, server, adminToken } = await setUp();
    await h.registerUser(server, 'pageuser1');
    await h.registerUser(server, 'pageuser2');
    await h.registerUser(server, 'zed-third');

    const first = await server.request.get('/api/v1/admin/users?limit=2').set('x-user-token', adminToken).expect(200);
    assert.equal(first.body.meta.pagination.total, 4);
    assert.equal(first.body.data.length, 2);
    assert.ok(first.body.meta.pagination.nextCursor);
    assert.ok(first.body.data.every((u: any) => typeof u.emailVerified === 'boolean'));

    const second = await server.request
      .get(`/api/v1/admin/users?limit=2&cursor=${encodeURIComponent(first.body.meta.pagination.nextCursor)}`)
      .set('x-user-token', adminToken)
      .expect(200);
    const firstIds = new Set(first.body.data.map((u: any) => u.id));
    assert.ok(second.body.data.length > 0);
    assert.ok(second.body.data.every((u: any) => !firstIds.has(u.id)));

    const search = await server.request
      .get('/api/v1/admin/users?limit=2&search=zed-third')
      .set('x-user-token', adminToken)
      .expect(200);
    assert.deepEqual(
      search.body.data.map((u: any) => u.username),
      ['zed-third'],
    );
  });

  test('audit action filter matches by prefix', async () => {
    const { h, server, adminToken } = await setUp();
    const dave = await h.registerUser(server, 'dave');
    await reauth(server, adminToken);
    await server.request
      .post(`/api/v1/admin/users/${dave.user.id}/roles`)
      .set('x-user-token', adminToken)
      .send({ role: 'admin' })
      .expect(200);
    await server.request
      .delete(`/api/v1/admin/users/${dave.user.id}/roles/admin`)
      .set('x-user-token', adminToken)
      .expect(200);
    await server.request.get(`/api/v1/admin/users/${dave.user.id}`).set('x-user-token', adminToken).expect(200);

    const res = await server.request
      .get('/api/v1/admin/audit?action=role_')
      .set('x-user-token', adminToken)
      .expect(200);
    const actions = new Set(res.body.data.map((row: any) => row.action));
    assert.deepEqual([...actions].sort(), ['role_grant', 'role_revoke']);
  });

  test('crew member routes block owner removal and audit add and remove', async () => {
    const { h, server, adminToken } = await setUp();
    const owner = await h.registerUser(server, 'erin');
    const member = await h.registerUser(server, 'frank');
    const added = await h.registerUser(server, 'gina');
    await h.joinFestivalProfile(server, owner.token);
    await h.joinFestivalProfile(server, member.token);
    const crew = (
      await server.request
        .post('/api/v1/crews')
        .set('x-user-token', owner.token)
        .send({ name: 'Erin Crew', festivalId: 'fest-1' })
        .expect(201)
    ).body.data;
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', member.token)
      .send({ inviteCode: crew.inviteCode })
      .expect(200);

    const crewList = await server.request.get('/api/v1/admin/crews').set('x-user-token', adminToken).expect(200);
    assert.equal(crewList.body.data.find((c: any) => c.id === crew.id).memberCount, 2);

    const refused = await server.request
      .delete(`/api/v1/admin/crews/${crew.id}/members/${owner.user.id}`)
      .set('x-user-token', adminToken)
      .expect(400);
    assert.equal(refused.body.error.code, 'INVALID_INPUT');
    const members = await server.request
      .get(`/api/v1/admin/crews/${crew.id}/members`)
      .set('x-user-token', adminToken)
      .expect(200);
    assert.ok(members.body.data.some((m: any) => m.userId === owner.user.id));

    await server.request
      .delete(`/api/v1/admin/crews/${crew.id}/members/${member.user.id}`)
      .set('x-user-token', adminToken)
      .expect(200);
    const removedRows = await server.request
      .get('/api/v1/admin/audit?action=crew_remove_member')
      .set('x-user-token', adminToken)
      .expect(200);
    assert.equal(removedRows.body.data.length, 1);
    assert.equal(removedRows.body.data[0].targetLabel, 'frank');

    await server.request
      .post(`/api/v1/crews/${crew.id}/members`)
      .set('x-user-token', adminToken)
      .send({ userId: added.user.id })
      .expect(200);
    await settle();
    const addRows = await auditRows(server.databaseUrl, 'action = $1', ['crew_add_member']);
    assert.equal(addRows.length, 1);
    assert.equal(addRows[0].target_type, 'crew_member');
    assert.equal(addRows[0].target_id, `${crew.id}:${added.user.id}`);
    const genericRows = await auditRows(server.databaseUrl, 'action = $1', ['create:members']);
    assert.equal(genericRows.length, 0);
  });

  test('reset link returns expiresAt one RESET_TOKEN_TTL from now', async () => {
    const { h, server, adminToken } = await setUp({ PUBLIC_ORIGIN: 'http://localhost:3000' });
    const hank = await h.registerUser(server, 'hank');
    const before = Date.now();
    const res = await server.request
      .post(`/api/v1/admin/users/${hank.user.id}/reset-link`)
      .set('x-user-token', adminToken)
      .expect(200);
    const expiresAt = Date.parse(res.body.data.expiresAt);
    const ttl = server.planner.config.RESET_TOKEN_TTL;
    assert.ok(expiresAt >= before + ttl - 1000);
    assert.ok(expiresAt <= Date.now() + ttl + 1000);
  });
});
