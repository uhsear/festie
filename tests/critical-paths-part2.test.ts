import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { TRUSTED_MUTATION_HEADER, TEST_DATABASE_URL, startServer, registerUser, joinFestival, shareToken, loginAdmin, servers } from './_critical-paths-helpers';

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    await s.close();
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. Prometheus Metrics Format
// ════════════════════════════════════════════════════════════════════════════════

describe('observability', { concurrency: 1 }, () => {
  test('GET /metrics returns Prometheus-compatible format', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    // Metrics is mounted on the health router at /metrics, which is at /api/v1/metrics
    const res = await server.request
      .get('/api/v1/metrics')
      .set('x-user-token', adminToken)
      .expect(200);

    assert.match(res.headers['content-type']!, /text\/plain/);
    assert.match(res.text, /fp_uptime_seconds \d+/);
    assert.match(res.text, /fp_users_total \d+/);
    assert.match(res.text, /fp_festivals_total \d+/);
  });

  test('health endpoint returns status ok', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request.get('/api/health').expect(200);
    assert.equal(res.body.data.status, 'ok');
    assert.ok(typeof res.body.data.uptime === 'number');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6. Redis-Unavailable Fallback
// ════════════════════════════════════════════════════════════════════════════════

describe('redis unavailable fallback', { concurrency: 1 }, () => {
  test('app starts and serves requests without Redis', async () => {
    const server = await startServer({ REDIS_ENABLED: 'false' });
    servers.push(server);

    // Core endpoints should work
    const healthRes = await server.request.get('/api/health').expect(200);
    assert.equal(healthRes.body.data.status, 'ok');

    const festivalsRes = await server.request.get('/api/v1/festivals').expect(200);
    assert.ok(Array.isArray(festivalsRes.body.data));

    // Auth should work
    const user = await registerUser(server, 'redisless');
    assert.ok(user.token);

    // Profile CRUD should work
    const profile = await joinFestival(server, user.token);
    assert.ok(profile.id);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 7. Session Expiration Mid-Use
// ════════════════════════════════════════════════════════════════════════════════

describe('session invalidation', { concurrency: 1 }, () => {
  test('logged out session returns 401 on subsequent requests', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'loggedout');

    // Verify token works
    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', user.token)
      .expect(200);

    // Logout
    await server.request
      .post('/api/v1/auth/logout')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // Token should now be invalid
    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', user.token)
      .expect(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 8. Festival Tiered Data Loading
// ════════════════════════════════════════════════════════════════════════════════

describe('tiered data loading', { concurrency: 1 }, () => {
  test('depth=1 returns structural data without profiles', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request.get('/api/v1/festivals/fest-1?depth=1').expect(200);

    assert.equal(res.body.data.name, 'Test Fest');
    assert.ok(Array.isArray(res.body.data.stages));
    assert.ok(Array.isArray(res.body.data.days));
    assert.equal(res.body.data.stages.length, 2);
    assert.equal(res.body.data.days.length, 2);
    // Sets should be present in depth=1
    assert.ok(res.body.data.days[0].sets.length > 0);
  });

  test('invalid depth returns 400', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request.get('/api/v1/festivals/fest-1?depth=5').expect(400);
    await server.request.get('/api/v1/festivals/fest-1?depth=-1').expect(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 9. Audit Logging
// ════════════════════════════════════════════════════════════════════════════════

describe('audit logging', { concurrency: 1 }, () => {
  test('admin festival mutations write audit log entries', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    // Create a festival
    const createRes = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'Audited Fest',
        location: 'Audit Land',
        stages: [{ id: 'audit-stage', name: 'Stage 1', color: '#000000' }],
        days: [
          {
            label: 'Day 1',
            date: '2026-08-01',
            sets: [{ id: 'set-audit-1', artist: 'AuditDJ', stageId: 'audit-stage', startTime: '22:00', endTime: '23:00' }],
          },
        ],
      })
      .expect(201);
    const festId = createRes.body.data.id;

    // Query audit log directly
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      // routes/festivals.ts audit() inserts fire-and-forget after the 201 is
      // sent, so poll (bounded) instead of sleeping a fixed 100ms.
      let rows: any[] = [];
      for (let i = 0; i < 100 && rows.length === 0; i++) {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 20));
        ({ rows } = await pool.query(
          "SELECT * FROM audit_log WHERE action = 'festival.created' AND target_id = $1",
          [festId]
        ));
      }
      assert.ok(rows.length > 0, 'Audit log should contain festival.created entry');
      assert.ok(['admin', 'user'].includes(rows[0].actor_type), 'actor_type should be admin or user');
      assert.equal(rows[0].target_type, 'festival');
    } finally {
      await pool.end();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 10. Shareable Pick Links
// ════════════════════════════════════════════════════════════════════════════════

describe('shareable pick links', { concurrency: 1 }, () => {
  test('public share page renders HTML with picks', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'sharer');
    const profile = await joinFestival(server, user.token);

    // Save some picks
    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must', 'set-b': 'want-to-see' } })
      .expect(200);

    // Access share page without auth
    const res = await server.request.get(`/s/${await shareToken(server, user.token)}`).expect(200);
    assert.match(res.headers['content-type']!, /text\/html/);
    assert.match(res.text, /sharer/); // username in page
    assert.match(res.text, /Test Fest/); // festival name
    assert.match(res.text, /Alpha/); // picked artist name
    assert.match(res.text, /Must See/); // priority label
  });

  test('share JSON endpoint returns structured data', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'jsonsharer');
    const profile = await joinFestival(server, user.token);

    await server.request
      .put(`/api/v1/profiles/${profile.id}`)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-c': 'maybe' } })
      .expect(200);

    const res = await server.request.get(`/s/${await shareToken(server, user.token)}/json`).expect(200);
    assert.equal(res.body.data.username, 'jsonsharer');
    assert.equal(res.body.data.festivalName, 'Test Fest');
    assert.equal(res.body.data.picks['set-c'], 'maybe');
    assert.ok(res.body.data.festival.stages);
    assert.ok(res.body.data.festival.days);
  });

  test('share page returns 404 for nonexistent profile', async () => {
    const server = await startServer();
    servers.push(server);
    await server.request.get('/s/nonexistent-profile-id').expect(404);
  });

  test('share page rejects invalid profile IDs', async () => {
    const server = await startServer();
    servers.push(server);
    // Spaces and special chars should be rejected by the regex filter
    const res = await server.request.get('/s/prof%20with%20spaces');
    assert.ok([400, 404].includes(res.status), 'Should reject invalid profile ID format');
  });

  test('share page sets cache headers', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'cachesharer');
    await joinFestival(server, user.token);

    const res = await server.request.get(`/s/${await shareToken(server, user.token)}`).expect(200);
    assert.equal(res.headers['cache-control'], 'private, no-cache');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 11. Per-User Rate Limiting
// ════════════════════════════════════════════════════════════════════════════════

describe('per-user rate limiting', { concurrency: 1 }, () => {
  test('authenticated requests rate limit by user token, not IP', async () => {
    // Use a higher limit to account for setup requests (register/login/join consume quota)
    // The key behavior: two different tokens get separate rate limit buckets
    const server = await startServer({ RATE_LIMIT_MAX: 50 });
    servers.push(server);

    const user1 = await registerUser(server, 'ratelimit1');
    const user2 = await registerUser(server, 'ratelimit2');

    // Both users make authenticated requests — check that rate limit headers
    // show independent counters (remaining should be similar for both users)
    const res1 = await server.request
      .get('/api/v1/festivals')
      .set('x-user-token', user1.token)
      .expect(200);

    const res2 = await server.request
      .get('/api/v1/festivals')
      .set('x-user-token', user2.token)
      .expect(200);

    // Both users should have high remaining counts (they each get their own 50-request bucket)
    const remaining1 = parseInt(res1.headers['x-ratelimit-remaining']!, 10);
    const remaining2 = parseInt(res2.headers['x-ratelimit-remaining']!, 10);

    // Each user's remaining should be close to 50 (minus their own requests)
    // If they shared an IP bucket, remaining would be much lower due to setup requests
    assert.ok(remaining1 >= 40, `User1 remaining ${remaining1} should be >= 40 (per-token bucket)`);
    assert.ok(remaining2 >= 40, `User2 remaining ${remaining2} should be >= 40 (per-token bucket)`);
  });

  test('unauthenticated requests still rate limit by IP', async () => {
    const server = await startServer({ RATE_LIMIT_MAX: 3 });
    servers.push(server);

    // Unauthenticated requests should rate limit by IP
    for (let i = 0; i < 3; i++) {
      await server.request.get('/api/health').expect(200);
    }

    const limitedRes = await server.request.get('/api/health');
    assert.equal(limitedRes.status, 429);
  });

  test('rate limit headers include correct values', async () => {
    const server = await startServer();
    servers.push(server);

    const res = await server.request
      .get('/api/health')
      .expect(200);

    const limit = parseInt(res.headers['x-ratelimit-limit']!, 10);
    const remaining = parseInt(res.headers['x-ratelimit-remaining']!, 10);
    const reset = parseInt(res.headers['x-ratelimit-reset']!, 10);
    assert.ok(limit > 0, 'X-RateLimit-Limit should be a positive number');
    assert.ok(remaining >= 0 && remaining <= limit, 'X-RateLimit-Remaining should be between 0 and limit');
    assert.ok(reset > Date.now() / 1000 - 60, 'X-RateLimit-Reset should be a recent/future timestamp');
  });
});

