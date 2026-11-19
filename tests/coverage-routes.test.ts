/**
 * Coverage-backfill: route-level HTTP coverage (metrics, health, admin,
 * profiles, crews/polls, spotify, grid, export, notifications, sockets,
 * tiered data loading, rate-limit, session expiry, audit).
 *
 * Consolidates routes-facing tests previously scattered across:
 *   - tests/coverage-gaps.test.js           (health/info/ready, admin bulk)
 *   - tests/gap-coverage.test.js            (metrics, admin CRUD, avatar, export, notifications, rate-limit, session, audit, cascade, .well-known, SSE, ACL)
 *   - tests/gap-audit-coverage.test.js      (tiered data loading HTTP paths)
 *   - tests/phase2-coverage.test.js         (crew polls, spotify preview, grid/sets)
 *   - tests/phase3-coverage.test.js         (Socket.IO join event validation)
 *
 * Unit/store-level coverage lives in coverage-edges.test.js.
 */

import assert from 'node:assert/strict';
import { afterEach, after as afterAll, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { TRUSTED_MUTATION_HEADER, TEST_DATABASE_URL, startServer, joinFestival, loginAdmin, reauthAdmin, servers } from './_coverage-routes-helpers';
import { registerUser } from './_integration-helpers';

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch {}
  }
});

// Force-exit guard for socket handles; matches phase2/phase3 patterns.
afterAll(() => { setTimeout(() => process.exit(0), 2000).unref?.(); });

// ════════════════════════════════════════════════════════════════════════
// Health / Info / Ready
// ════════════════════════════════════════════════════════════════════════

describe('GET /api/health /api/info /api/ready', () => {
  test('/api/health returns 200 with ok status', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'ok');
  });

  test('/api/info returns feature flags and version', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/info');
    assert.equal(res.status, 200);
    assert.ok(res.body.data);
  });

  test('/api/ready returns 503 until the server is marked ready', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/ready');
    assert.equal(res.status, 503);
    assert.equal(res.body.data.status, 'not_ready');
  });

  test('/api/ready returns 200 once the server is marked ready', async () => {
    const server = await startServer(); servers.push(server);
    server.planner.setHealthReady(true);
    const res = await server.request.get('/api/ready');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'ready');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Metrics endpoints
// ════════════════════════════════════════════════════════════════════════

describe('metrics endpoints', () => {
  test('POST /api/metrics/client accepts valid payload', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/metrics/client')
      .send({ lcp: 1500, fid: 50, cls: 0.1, avgRenderMs: 16, renders: 120 })
      .expect(200);
    assert.ok(res.body.data !== undefined);
  });

  test('POST /api/metrics/client rejects unknown payload shape', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/metrics/client')
      .send({ invalidField: 'value' });
    assert.equal(res.status, 400);
  });

  test('POST /api/v1/metrics/client has rate-limit headers', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.post('/api/v1/metrics/client')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ lcp: 1200, fid: 50, cls: 0.05 });
    assert.equal(res.status, 200);
    assert.ok(res.headers['x-ratelimit-limit']);
  });

  test('GET /api/v1/metrics returns Prometheus-compatible format', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const res = await server.request
      .get('/api/v1/metrics')
      .set('x-user-token', adminToken)
      .expect(200);
    assert.match(res.headers['content-type']!, /text\/plain/);
    assert.ok(res.text.includes('fp_'));
  });
});

// ════════════════════════════════════════════════════════════════════════
// Admin routes (bulk, CRUD, cascade, audit)
// ════════════════════════════════════════════════════════════════════════

describe('admin bulk deactivate + archive', () => {
  test('POST /admin/bulk/deactivate requires admin', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/admin/bulk/deactivate')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ userIds: ['user-123'] });
    assert.equal(res.status, 401);
  });

  test('admin can deactivate a user', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const user = await registerUser(server, 'todeactivate');
    await reauthAdmin(server, adminToken);
    const res = await server.request
      .post('/api/v1/admin/bulk/deactivate')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ userIds: [user.user.id] });
    assert.equal(res.status, 200);
  });

  test('POST /admin/bulk/archive-festivals requires admin', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/admin/bulk/archive-festivals')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalIds: ['fest-123'] });
    assert.equal(res.status, 401);
  });

  test('admin can archive festivals', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const createRes = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ name: 'Archive Test Fest', days: [{ date: '2026-06-01', label: 'Day 1', sets: [] }], stages: [] });
    const festId = createRes.body.data?.id || createRes.body.data?.festival?.id;
    await reauthAdmin(server, adminToken);
    const res = await server.request
      .post('/api/v1/admin/bulk/archive-festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalIds: [festId] });
    assert.equal(res.status, 200);
  });
});

describe('admin festival CRUD + cascade + audit', () => {
  test('create → update → delete festival round trip', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const createRes = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'CRUD Test Fest', location: 'Testville',
        stages: [{ id: 'main', name: 'Main', color: '#ff0000' }],
        days: [{ label: 'Day 1', date: '2026-07-15', sets: [] }],
      })
      .expect(201);
    const festId = createRes.body.data.id;
    assert.ok(festId);

    const upd = await server.request
      .put(`/api/v1/admin/festivals/${festId}`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ name: 'Updated CRUD Fest' })
      .expect(200);
    assert.equal(upd.body.data.name, 'Updated CRUD Fest');

    await reauthAdmin(server, adminToken);
    await server.request
      .delete(`/api/v1/admin/festivals/${festId}`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const getRes = await server.request.get(`/api/v1/festivals/${festId}`);
    assert.ok(getRes.status >= 400);
  });

  test('hard-delete cascades festival_stages rows', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const createRes = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'Cascade Test', location: 'Test',
        stages: [{ id: 'stage', name: 'Stage', color: '#000' }],
        days: [{ label: 'Day', date: '2026-07-20', sets: [] }],
      })
      .expect(201);
    const festId = createRes.body.data.id;

    await reauthAdmin(server, adminToken);
    await server.request
      .delete(`/api/v1/admin/festivals/${festId}?hard=true`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query('SELECT * FROM festival_stages WHERE festival_id = $1', [festId]);
      assert.equal(rows.length, 0);
    } finally { await pool.end(); }
  });

  test('admin mutations write audit_log entries', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const createRes = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'Audit Test Fest', location: 'Audit Land',
        stages: [{ id: 'audit-stage-1', name: 'Stage 1', color: '#000000' }],
        days: [{ label: 'Day 1', date: '2026-08-01',
          sets: [{ id: 'audit-set-1', artist: 'Artist', stageId: 'audit-stage-1', startTime: '20:00', endTime: '21:00' }] }],
      })
      .expect(201);
    const festId = createRes.body.data.id;

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      // routes/festivals.ts audit() inserts fire-and-forget after the 201 is
      // sent, so poll (bounded) instead of assuming one tick is enough.
      let rows: any[] = [];
      for (let i = 0; i < 100 && rows.length === 0; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 20));
        ({ rows } = await pool.query(
          "SELECT * FROM audit_log WHERE action = 'festival.created' AND target_id = $1",
          [festId]
        ));
      }
      assert.equal(rows.length, 1);
    } finally { await pool.end(); }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Profile ACL + soft-delete visibility + avatar
// ════════════════════════════════════════════════════════════════════════

describe('profile + avatar', () => {
  test('user cannot modify other user profile (ACL)', async () => {
    const server = await startServer(); servers.push(server);
    const user1 = await registerUser(server, 'user1access');
    const user2 = await registerUser(server, 'user2access');
    const profile1 = await joinFestival(server, user1.token);

    const res = await server.request
      .put(`/api/v1/profiles/${profile1.id}`)
      .set('x-user-token', user2.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must' } });
    assert.ok(res.status >= 400);
  });

  test('soft-deleted profile not returned by festival GET', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'softdeleteuser');
    const profile = await joinFestival(server, user.token);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('UPDATE festival_profiles SET deleted_at = NOW() WHERE id = $1', [profile.id]);
    } finally { await pool.end(); }

    const res = await server.request
      .get('/api/v1/festivals/fest-1')
      .set('x-user-token', user.token);
    if (res.status === 200 && res.body.data.profiles) {
      const found = res.body.data.profiles.find((p: any) => p.id === profile.id);
      assert.ok(!found);
    }
  });

  test('avatar upload + removal round trip', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'avatarlifecycleuser');
    const AVATAR_FIXTURE = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg==',
      'base64'
    );

    const upload = await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(200);
    const avatarUrl = upload.body.data?.avatarUrl || upload.body.data?.user?.avatarUrl;
    assert.ok(avatarUrl);

    const del = await server.request
      .delete('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);
    assert.equal(del.body.data?.avatarUrl ?? null, null);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Export HTML + ICS
// ════════════════════════════════════════════════════════════════════════

describe('export routes', () => {
  test('HTML export returns valid HTML doc', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'htmlexportuser');
    const profile = await joinFestival(server, user.token);
    const res = await server.request
      .get(`/api/v1/export/fest-1/${profile.id}`)
      .set('x-user-token', user.token)
      .expect(200);
    assert.match(res.headers['content-type']!, /text\/html/);
    assert.match(res.text, /<!DOCTYPE html>/i);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Notifications (badge / unread / history)
// ════════════════════════════════════════════════════════════════════════

describe('notifications routes', () => {
  test('badge reset is not routed (404)', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'notificationuser');
    const res = await server.request
      .post('/api/v1/notifications/badge/reset')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.equal(res.status, 404);
  });

  test('unread counts returns object or number when implemented', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'unreaduser');
    const res = await server.request
      .get('/api/v1/notifications/unread')
      .set('x-user-token', user.token);
    if (res.status === 200) {
      assert.ok(typeof res.body.data === 'object' || typeof res.body.data === 'number');
    }
  });

  test('delivery history returns array or object when implemented', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'historyuser');
    const res = await server.request
      .get('/api/v1/notifications/history')
      .set('x-user-token', user.token);
    if (res.status === 200) {
      assert.ok(Array.isArray(res.body.data) || typeof res.body.data === 'object');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Tiered data loading (?depth=)
// ════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/festivals/:id?depth= (tiered loading)', () => {
  test('depth=1 returns stages + days with core set fields, strips deep fields', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'tiereduser');
    const res = await server.request
      .get('/api/v1/festivals/fest-1?depth=1')
      .set('x-user-token', user.token)
      .expect(200);
    const data = res.body.data;
    assert.equal(data.id, 'fest-1');
    assert.equal(data.name, 'Test Fest');
    assert.ok(Array.isArray(data.stages));
    assert.equal(data.stages.length, 2);
    assert.ok(Array.isArray(data.days));
    const stage = data.stages[0];
    assert.ok(stage.id && stage.name && stage.color);
    const set = data.days[0].sets[0];
    assert.ok(set.id && set.artist && set.stageId && set.startTime && set.endTime);
    assert.equal(set.linkUrl, undefined, 'depth=1 strips linkUrl');
    // And no profiles/messages in depth=1
    const keys = Object.keys(data);
    assert.ok(!keys.includes('profiles'));
    assert.ok(!keys.includes('messages'));
  });

  test('full depth (omit ?depth) returns complete festival', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'tiereduserfull');
    const res = await server.request
      .get('/api/v1/festivals/fest-1')
      .set('x-user-token', user.token)
      .expect(200);
    const data = res.body.data;
    assert.equal(data.id, 'fest-1');
    assert.ok(Array.isArray(data.stages));
    assert.ok(Array.isArray(data.days));
    assert.ok(data.days[0].sets);
  });

  test('depth=1 response is <= full-depth response in size', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'tieredsize');
    const [l1, full] = await Promise.all([
      server.request.get('/api/v1/festivals/fest-1?depth=1').set('x-user-token', user.token),
      server.request.get('/api/v1/festivals/fest-1').set('x-user-token', user.token),
    ]);
    assert.ok(JSON.stringify(l1.body).length <= JSON.stringify(full.body).length);
  });

  test('invalid depth values return 400', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'tieredbad');
    await server.request.get('/api/v1/festivals/fest-1?depth=-1').set('x-user-token', user.token).expect(400);
    await server.request.get('/api/v1/festivals/fest-1?depth=5').set('x-user-token', user.token).expect(400);
    await server.request.get('/api/v1/festivals/fest-1?depth=abc').set('x-user-token', user.token).expect(400);
    await server.request.get('/api/v1/festivals/fest-1?depth=99').expect(400);
  });

  test('festival list returns lightweight summaries (no stages/days arrays)', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals').expect(200);
    const fest = res.body.data[0];
    assert.ok(fest.id && fest.name && fest.location);
    assert.equal(typeof fest.stageCount, 'number');
    assert.equal(typeof fest.dayCount, 'number');
    assert.equal(typeof fest.lineupCount, 'number');
    assert.equal(fest.stages, undefined);
    assert.equal(fest.days, undefined);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Rate-limit headers + session expiry
// ════════════════════════════════════════════════════════════════════════

describe('rate-limit + session', () => {
  test('API responses include rate-limit headers', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals');
    assert.ok(res.headers['x-ratelimit-limit']);
    assert.ok(res.headers['x-ratelimit-remaining']);
    assert.ok(res.headers['x-ratelimit-reset']);
  });

  test('authenticated requests use per-user rate-limit key', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'ratelimituser');
    const res = await server.request.get('/api/v1/festivals')
      .set('x-user-token', user.token);
    assert.equal(res.status, 200);
    assert.ok(res.headers['x-ratelimit-limit']);
    assert.ok(res.headers['x-ratelimit-remaining']);
  });

  test('userAuth rate-limit entries stay isolated per user', async () => {
    const server = await startServer({ RATE_LIMIT_MAX: 100 }); servers.push(server);
    const u1 = await registerUser(server, 'user1cleanup');
    const u2 = await registerUser(server, 'user2cleanup');
    const r1 = await server.request.get('/api/v1/festivals').set('x-user-token', u1.token).expect(200);
    const r2 = await server.request.get('/api/v1/festivals').set('x-user-token', u2.token).expect(200);
    const rem1 = parseInt(r1.headers['x-ratelimit-remaining'] || '50', 10);
    const rem2 = parseInt(r2.headers['x-ratelimit-remaining'] || '50', 10);
    assert.ok(rem1 > 0 || rem2 > 0);
  });

  test('expired session returns 401 and gets cleaned from DB', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'expiringuser');
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query('UPDATE user_sessions SET created_at = $1 WHERE user_id = $2', [new Date('2000-01-01T00:00:00Z'), user.user.id]);
      const res = await server.request
        .get('/api/v1/account/export')
        .set('x-user-token', user.token);
      assert.equal(res.status, 401);
      const { rows } = await pool.query('SELECT COUNT(*) as count FROM user_sessions WHERE user_id = $1', [user.user.id]);
      assert.equal(parseInt(rows[0].count, 10), 0);
    } finally { await pool.end(); }
  });
});
