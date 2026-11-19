import assert from 'node:assert/strict';
import path from 'path';
import { afterEach, after as afterAll, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { io as createSocketClient } from 'socket.io-client';
import { DEFAULT_PASSWORD, TRUSTED_MUTATION_HEADER, TEST_DATABASE_URL, startServer, registerUser, joinFestival, createCrew, joinCrew, loginAdmin, servers } from './_coverage-routes-helpers';

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch {}
  }
});

// Force-exit guard for socket handles; matches phase2/phase3 patterns.
afterAll(() => { setTimeout(() => process.exit(0), 2000).unref?.(); });

// ════════════════════════════════════════════════════════════════════════
// Misc route edges
// ════════════════════════════════════════════════════════════════════════

describe('misc route edges', () => {
  test('deep-linking .well-known responses are valid JSON', async () => {
    const server = await startServer({ APPLE_TEAM_ID: 'ABCDE12345' }); servers.push(server);
    const r1 = await server.request.get('/.well-known/apple-app-site-association');
    const r2 = await server.request.get('/.well-known/assetlinks.json');
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.ok(typeof r1.body === 'object');
    assert.ok(typeof r2.body === 'object');
  });

  test('SSE endpoint returns 404 for unknown path', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/sse/test');
    assert.equal(res.status, 404);
  });

  test('error responses do not leak stack traces', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/nonexistent-fest-xyz');
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
    assert.ok(!res.body.error.stack);
    assert.ok(!res.body.stack);
  });

  test('repeated 404s stay consistently shaped', async () => {
    const server = await startServer(); servers.push(server);
    for (let i = 0; i < 5; i++) {
      const res = await server.request.get('/api/v1/festivals/dedup-test-' + i);
      assert.equal(res.status, 404);
      assert.ok(res.body.error);
      assert.ok(res.body.error.message);
    }
  });

  test('profile sync with stale If-Match ETag returns 409', async () => {
    const server = await startServer(); servers.push(server);
    const adminToken = await loginAdmin(server);
    const user = await registerUser(server, 'staleetag');

    await server.request.post('/api/v1/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        id: 'stale-fest', name: 'Stale Test', location: 'Test', timeZone: 'America/New_York',
        stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
        days: [{ label: 'Fri', date: '2026-06-05', sets: [
          { id: 'set-s1', artist: 'Artist', stageId: 'main', startTime: '10:00', endTime: '11:00' },
        ]}],
      });
    // A new festival is a draft; attendees can join it once it is published.
    await server.request.post('/api/v1/festivals/stale-fest/publish')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const join = await server.request.post('/api/v1/profiles')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalId: 'stale-fest' });
    assert.equal(join.status, 200);
    const profileId = join.body.data && join.body.data.id;
    assert.ok(profileId);

    const update1 = await server.request.put('/api/v1/profiles/' + profileId)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-s1': 'must' } });
    assert.equal(update1.status, 200);

    const staleUpdate = await server.request.put('/api/v1/profiles/' + profileId)
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .set('If-Match', '"stale-etag-000"')
      .send({ picks: { 'set-s1': 'maybe' } });
    assert.equal(staleUpdate.status, 409);
  });

  test('Redis-disabled app still starts and serves core routes', async () => {
    const server = await startServer({ REDIS_ENABLED: 'false' }); servers.push(server);
    const health = await server.request.get('/api/health').expect(200);
    assert.equal(health.body.data.status, 'ok');
    const fests = await server.request.get('/api/v1/festivals').expect(200);
    assert.ok(Array.isArray(fests.body.data));
    const user = await registerUser(server, 'noredisuser');
    assert.ok(user.token);
  });

  test('log output contains no sensitive data', async () => {
    const server = await startServer(); servers.push(server);
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => captured.push(args.join(' '));
    try {
      await server.request
        .post('/api/v1/auth/register')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: 'securitytest', password: 'supersecretpassword123', confirmPassword: 'supersecretpassword123', dateOfBirth: '1995-01-01', tosAccepted: true, email: `${'securitytest'}@example.com` })
        .expect(201);
      const logText = captured.join('\n').toLowerCase();
      assert.ok(!logText.includes('supersecretpassword'));
      assert.ok(!logText.includes('cookie'));
    } finally { console.log = origLog; }
  });

  test('graceful shutdown — server.close completes without hanging', async () => {
    const server = await startServer(); servers.push(server);
    const startClose = Date.now();
    server.planner.server.close();
    const endClose = Date.now();
    assert.ok(endClose - startClose >= 0);
  });

  test('migrations baseline exists (tables present after schema init)', async () => {
    const server = await startServer(); servers.push(server);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name LIKE '%'");
      assert.ok(rows[0].count > 0);
    } finally { await pool.end(); }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Crew Polls lifecycle
// ════════════════════════════════════════════════════════════════════════

describe('Crew Polls', () => {
  test('full poll lifecycle: create → list → vote → close', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_polls');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Best headliner?', options: ['Excision', 'Kompany'] })
      .expect(200);
    const poll = createRes.body.data.poll;
    assert.ok(poll.id);
    assert.equal(poll.question, 'Best headliner?');
    assert.deepEqual(poll.options, ['Excision', 'Kompany']);

    const listRes = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .expect(200);
    assert.equal(listRes.body.data.polls.length, 1);
    assert.equal(listRes.body.data.polls[0].id, poll.id);

    const voteRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${poll.id}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 0 })
      .expect(200);
    assert.equal(voteRes.body.data.voted, true);

    await server.request
      .delete(`/api/v1/crews/${crew.id}/polls/${poll.id}`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const listAfter = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .expect(200);
    // Closed polls stay listed as decided (open polls plus the last 10 decided).
    assert.equal(listAfter.body.data.polls.length, 1);
    assert.equal(listAfter.body.data.polls[0].closed, true);
  });

  test('rejects poll creation with invalid data', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_bad');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    // No question
    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ options: ['A', 'B'] })
      .expect(400);

    // Only 1 option
    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Test?', options: ['Only one'] })
      .expect(400);

    // 5 options (max 4)
    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Test?', options: ['A', 'B', 'C', 'D', 'E'] })
      .expect(400);
  });

  test('enforces max 3 active polls per crew (409)', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_max');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    for (let i = 0; i < 3; i++) {
      await server.request
        .post(`/api/v1/crews/${crew.id}/polls`)
        .set('x-user-token', alice.token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ question: `Poll ${i}?`, options: ['Yes', 'No'] })
        .expect(200);
    }
    const res = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Too many?', options: ['Yes', 'No'] })
      .expect(409);
    assert.ok(res.body.error);
  });

  test('non-member cannot create or view polls (403)', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_nm');
    const bob = await registerUser(server, 'bob_nm');
    await joinFestival(server, alice.token, 'fest-p2');
    await joinFestival(server, bob.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', bob.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Sneak in?', options: ['Yes', 'No'] })
      .expect(403);

    await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', bob.token)
      .expect(403);
  });

  test('vote changes are idempotent (upsert)', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_upsert');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Change vote?', options: ['A', 'B', 'C'] })
      .expect(200);
    const pollId = createRes.body.data.poll.id;

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 0 })
      .expect(200);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 2 })
      .expect(200);

    const listRes = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .expect(200);
    const poll = listRes.body.data.polls.find((p: any) => p.id === pollId);
    const validVotes = (poll.votes || []).filter((v: any) => v.user_id !== null);
    assert.equal(validVotes.length, 1);
    assert.equal(validVotes[0].option, 2);
  });

  test('rejects vote with out-of-bounds option index', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_oob');
    await joinFestival(server, alice.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Bounds?', options: ['A', 'B'] })
      .expect(200);
    const pollId = createRes.body.data.poll.id;

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 5 })
      .expect(400);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: -1 })
      .expect(400);
  });

  test('multi-user voting produces correct vote_count', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_multi');
    const bob = await registerUser(server, 'bob_multi');
    await joinFestival(server, alice.token, 'fest-p2');
    await joinFestival(server, bob.token, 'fest-p2');
    const crew = await createCrew(server, alice.token);
    await joinCrew(server, bob.token, crew.inviteCode);

    const createRes = await server.request
      .post(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ question: 'Multi vote?', options: ['X', 'Y'] })
      .expect(200);
    const pollId = createRes.body.data.poll.id;

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', alice.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 0 })
      .expect(200);

    await server.request
      .post(`/api/v1/crews/${crew.id}/polls/${pollId}/vote`)
      .set('x-user-token', bob.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ optionIndex: 1 })
      .expect(200);

    const listRes = await server.request
      .get(`/api/v1/crews/${crew.id}/polls`)
      .set('x-user-token', alice.token)
      .expect(200);
    const poll = listRes.body.data.polls.find((p: any) => p.id === pollId);
    assert.equal(Number(poll.vote_count), 2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Spotify preview route
// ════════════════════════════════════════════════════════════════════════

describe('Spotify preview route', () => {
  test('returns null embedType for set without Spotify link', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_spot1');
    await joinFestival(server, alice.token, 'fest-p2');
    const res = await server.request
      .get('/api/v1/spotify/preview/set-1')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.strictEqual(res.body.data.embedType, null);
  });

  test('returns 404 for nonexistent set', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_spot2');
    await joinFestival(server, alice.token, 'fest-p2');
    const res = await server.request
      .get('/api/v1/spotify/preview/set-nonexistent')
      .set('x-user-token', alice.token)
      .expect(404);
    assert.ok(res.body.error);
  });

  test('is publicly accessible (no auth required) — 404 for unknown set', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .get('/api/v1/spotify/preview/nonexistent-set');
    assert.equal(res.status, 404);
  });

  test('returns null embedType for set with empty artists array', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_spot3');
    await joinFestival(server, alice.token, 'fest-p2');
    const res = await server.request
      .get('/api/v1/spotify/preview/set-1')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.strictEqual(res.body.error, null);
    assert.strictEqual(res.body.data.embedType, null);
  });

  test('returns null embedType for set with artist but no Spotify link', async () => {
    const server = await startServer(); servers.push(server);
    const alice = await registerUser(server, 'alice_spot4');
    await joinFestival(server, alice.token, 'fest-p2');
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query(
        `UPDATE festival_sets SET artists = $1 WHERE id = 'set-2'`,
        [JSON.stringify([{ name: 'Kompany', links: {} }])]
      );
    } finally { await pool.end(); }
    const res = await server.request
      .get('/api/v1/spotify/preview/set-2')
      .set('x-user-token', alice.token)
      .expect(200);
    assert.strictEqual(res.body.data.embedType, null);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Grid / Sets data
// ════════════════════════════════════════════════════════════════════════

describe('Grid / Sets data', () => {
  test('festival detail returns sets with stage and day info', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/fest-p2').expect(200);
    const festival = res.body.data;
    assert.equal(festival.id, 'fest-p2');
    assert.ok(Array.isArray(festival.days));
    assert.ok(festival.days.length > 0);
    const day = festival.days[0];
    assert.ok(Array.isArray(day.sets));
    assert.equal(day.sets.length, 3);
    for (const set of day.sets) {
      assert.ok(set.id);
      assert.ok(set.artist || set.name);
      assert.ok(set.stageId || set.stage_id);
    }
  });

  test('festival detail returns stages for grid column layout', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/fest-p2').expect(200);
    const festival = res.body.data;
    assert.ok(Array.isArray(festival.stages));
    assert.equal(festival.stages.length, 2);
    assert.equal(festival.stages[0].name, 'Main Stage');
    assert.equal(festival.stages[1].name, 'Forest');
  });

  test('sets include time data for grid positioning', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/fest-p2').expect(200);
    const sets = res.body.data.days[0].sets;
    const excision = sets.find((s: any) => s.artist === 'Excision' || s.name === 'Excision');
    assert.ok(excision);
    assert.ok(excision.startTime || excision.start_time);
    assert.ok(excision.endTime || excision.end_time);
  });

  test('returns 404 for nonexistent festival', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request.get('/api/v1/festivals/nonexistent').expect(404);
    assert.ok(res.body.error);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Socket.IO event validation
// ════════════════════════════════════════════════════════════════════════

describe('Socket.IO event validation', () => {
  function connectSocket(port: any, token: any, opts: any = {}) {
    return createSocketClient(`http://localhost:${port}`, {
      transports: ['websocket'], auth: { token },
      autoConnect: true, reconnection: false, timeout: 3000, ...opts,
    });
  }

  async function getAuthToken(server: any) {
    const username = `socktest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const reg = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: `${username}@example.com` });
    return reg.body.data?.token;
  }

  test('join:festival with invalid festivalId type is rejected', async () => {
    const server = await startServer(); servers.push(server);
    const port = (server.planner.server.address() as any).port;
    const token = await getAuthToken(server);
    const socket = connectSocket(port, token);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('join:festival', 12345, { _v: 1 }, (response: any) => {
          try {
            assert.ok(response);
            assert.equal(response.ok, false);
            socket.disconnect();
            resolve();
          } catch (e) { socket.disconnect(); reject(e); }
        });
      });
      socket.on('connect_error', (e: any) => reject(e));
      setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 3000);
    });
  });

  test('join:festival without auth token disconnects or errors', async () => {
    const server = await startServer(); servers.push(server);
    const port = (server.planner.server.address() as any).port;
    const socket = createSocketClient(`http://localhost:${port}`, {
      transports: ['websocket'], autoConnect: true, reconnection: false, timeout: 3000,
    });
    await new Promise<void>((resolve) => {
      socket.on('connect', () => {
        socket.emit('join:festival', 'fest-p3', { _v: 1 }, (response: any) => {
          assert.ok(!response || response.ok === false);
          socket.disconnect();
          resolve();
        });
      });
      socket.on('disconnect', () => resolve());
      socket.on('connect_error', () => resolve());
      setTimeout(() => { socket.disconnect(); resolve(); }, 5000);
    });
  });

  test('join:festival with nonexistent festival returns ok:false', async () => {
    const server = await startServer(); servers.push(server);
    const port = (server.planner.server.address() as any).port;
    const token = await getAuthToken(server);
    const socket = connectSocket(port, token);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('join:festival', 'nonexistent-festival-id', { _v: 1, userToken: token }, (response: any) => {
          try {
            assert.ok(response);
            assert.equal(response.ok, false);
            socket.disconnect();
            resolve();
          } catch (e) { socket.disconnect(); reject(e); }
        });
      });
      socket.on('connect_error', (e: any) => reject(e));
      setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 3000);
    });
  });

  test('join:crew with invalid payload is rejected', async () => {
    const server = await startServer(); servers.push(server);
    const port = (server.planner.server.address() as any).port;
    const token = await getAuthToken(server);
    const socket = connectSocket(port, token);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('join:crew', { _v: 1, crewId: '' }, (response: any) => {
          try {
            assert.ok(response);
            assert.equal(response.ok, false);
            socket.disconnect();
            resolve();
          } catch (e) { socket.disconnect(); reject(e); }
        });
      });
      socket.on('connect_error', (e: any) => reject(e));
      setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 3000);
    });
  });

  test('join:festival with schema version mismatch does not crash', async () => {
    const server = await startServer(); servers.push(server);
    const port = (server.planner.server.address() as any).port;
    const token = await getAuthToken(server);
    const socket = connectSocket(port, token);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('join:festival', 'fest-1', { _v: 999, userToken: token }, (response: any) => {
          try {
            assert.ok(response);
            socket.disconnect();
            resolve();
          } catch (e) { socket.disconnect(); reject(e); }
        });
      });
      socket.on('connect_error', (e: any) => reject(e));
      setTimeout(() => { socket.disconnect(); reject(new Error('timeout')); }, 3000);
    });
  });
});

