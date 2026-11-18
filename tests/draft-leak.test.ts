import { afterEach, describe, test } from 'node:test';
import {
  assert,
  Pool,
  startServer,
  registerUser,
  joinFestivalProfile,
  loginAdmin,
  connectSocket,
  waitForEvent,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

async function withPool<T>(server: any, fn: (pool: any) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: server.databaseUrl, statement_timeout: 5000 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

// A draft festival with coordinates and one set, made through the admin API as
// production makes it (this also refreshes the festival cache). fest-1 is published.
async function seedDraft(server: any, adminToken: string): Promise<{ id: string; setId: string }> {
  const res = await server.request
    .post('/api/v1/festivals')
    .set('x-user-token', adminToken)
    .send({
      name: 'Secret Draft',
      stages: [{ id: 'main', name: 'Main Stage', color: '#ff3366' }],
      days: [
        {
          label: 'Friday',
          date: '2026-12-01',
          sets: [{ id: 'draft-set-1', artist: 'Hidden', stageId: 'main', startTime: '10:00', endTime: '11:00' }],
        },
      ],
    })
    .expect(201);
  const id = res.body.data.id as string;
  assert.equal(res.body.data.publishedAt, null);
  await withPool(server, (pool) => pool.query('UPDATE festivals SET latitude = 29.2, longitude = -81.0 WHERE id = $1', [id]));
  return { id, setId: 'draft-set-1' };
}

const profileCount = (server: any, festivalId: string) =>
  withPool(server, async (pool) => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM festival_profiles WHERE festival_id = $1', [festivalId]);
    return rows[0].n as number;
  });

describe('Integration — draft festivals are not reachable by non-admins', { concurrency: 1 }, () => {
  test('weather: a draft is 404 and a cached published entry is never served for it', async () => {
    const server = await startServer();
    servers.push(server);
    const admin = await loginAdmin(server);
    const draft = await seedDraft(server, admin);
    const alice = await registerUser(server, 'dl-weather-' + Date.now());

    for (let i = 0; i < 2; i++) {
      await server.request.get(`/api/v1/weather/${draft.id}`).set('x-user-token', alice.token).expect(404);
    }
    // Warm the cache for the published festival, then a draft must still be 404.
    await server.request.get('/api/v1/weather/fest-1').set('x-user-token', alice.token).expect(200);
    await server.request.get(`/api/v1/weather/${draft.id}`).set('x-user-token', alice.token).expect(404);
  });

  test('weather: unpublishing a festival stops a cached entry from being served', async () => {
    const server = await startServer();
    servers.push(server);
    const alice = await registerUser(server, 'dl-weather-unpub-' + Date.now());
    await withPool(server, (pool) => pool.query('UPDATE festivals SET latitude = 29.2, longitude = -81.0 WHERE id = $1', ['fest-1']));
    await server.request.get('/api/v1/weather/fest-1').set('x-user-token', alice.token).expect(200);
    await withPool(server, (pool) => pool.query('UPDATE festivals SET published_at = NULL WHERE id = $1', ['fest-1']));
    await server.request.get('/api/v1/weather/fest-1').set('x-user-token', alice.token).expect(404);
  });

  test('crew create, reform and profile join on a draft are 404 and create no profile', async () => {
    const server = await startServer();
    servers.push(server);
    const admin = await loginAdmin(server);
    const draft = await seedDraft(server, admin);
    const alice = await registerUser(server, 'dl-create-' + Date.now());

    await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Ghosts', festivalId: draft.id })
      .expect(404);

    await joinFestivalProfile(server, alice.token);
    const crewRes = await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Real Crew', festivalId: 'fest-1' })
      .expect(201);
    await server.request
      .post(`/api/v1/crews/${crewRes.body.data.id}/reform`)
      .set('x-user-token', alice.token)
      .send({ targetFestivalId: draft.id })
      .expect(404);

    await server.request
      .post('/api/v1/profiles')
      .set('x-user-token', alice.token)
      .send({ festivalId: draft.id })
      .expect(404);
    assert.equal(await profileCount(server, draft.id), 0);
  });

  test('crew join and invite preview for a crew in a draft festival', async () => {
    const server = await startServer();
    servers.push(server);
    const admin = await loginAdmin(server);
    const draft = await seedDraft(server, admin);
    const alice = await registerUser(server, 'dl-owner-' + Date.now());
    const bob = await registerUser(server, 'dl-joiner-' + Date.now());
    // A crew can reach a draft when a festival is unpublished by hand, so insert one directly.
    await withPool(server, async (pool) => {
      await pool.query("INSERT INTO crews (id, festival_id, name, created_by, invite_code) VALUES ('crew-draft', $1, 'Hidden Crew', $2, 'DRAFT123')", [draft.id, alice.user.id]);
      await pool.query("INSERT INTO crew_members (crew_id, user_id, role) VALUES ('crew-draft', $1, 'owner')", [alice.user.id]);
    });

    const preview = await server.request.get('/api/v1/crews/join-preview/DRAFT123').expect(200);
    assert.equal(preview.body.data.crewName, 'Hidden Crew');
    assert.equal(preview.body.data.festivalId, null);
    assert.equal(preview.body.data.festivalName, null);
    assert.equal(preview.body.data.startDate, null);

    const page = await server.request.get('/join/DRAFT123').expect(200);
    assert.ok(!page.text.includes('Secret Draft'), 'invite page must not name the draft festival');

    await server.request.post('/api/v1/crews/join').set('x-user-token', bob.token).send({ inviteCode: 'DRAFT123' }).expect(404);
    assert.equal(await profileCount(server, draft.id), 0);
  });

  test('socket join and export on a draft are refused for a non-admin', async () => {
    const server = await startServer();
    servers.push(server);
    const admin = await loginAdmin(server);
    const draft = await seedDraft(server, admin);
    const alice = await registerUser(server, 'dl-socket-' + Date.now());

    const socket = connectSocket(server.baseUrl);
    await waitForEvent(socket, 'connect');
    const ack: any = await new Promise((resolve) => {
      socket.emit('join:festival', draft.id, { userToken: alice.token }, resolve);
    });
    socket.close();
    // Regression guard: refusal comes from the missing profile, which a non-admin can no longer
    // create in a draft (see the crew and profile tests above), so there is no other way in.
    assert.equal(ack?.ok, false);
    assert.equal(ack?.error, 'Not a member of this festival');

    await server.request.get(`/api/v1/export/${draft.id}/prof-none`).set('x-user-token', alice.token).expect(404);
  });

  test('locate-set: a draft is 404 for anonymous and admin tokens, a published set stays public', async () => {
    const server = await startServer();
    servers.push(server);
    const admin = await loginAdmin(server);
    const draft = await seedDraft(server, admin);

    await server.request.get(`/api/v1/festivals/locate-set/${draft.setId}`).expect(404);
    await server.request.get(`/api/v1/festivals/locate-set/${draft.setId}`).set('x-user-token', admin).expect(404);

    // The admin mount sets req.isAdmin, so a draft set resolves there and must not be cached.
    const adminRes = await server.request
      .get(`/api/v1/admin/festivals/locate-set/${draft.setId}`)
      .set('x-user-token', admin)
      .expect(200);
    assert.equal(adminRes.headers['cache-control'], 'private, no-store');

    const published = await server.request.get('/api/v1/festivals/locate-set/set-a').expect(200);
    assert.equal(published.headers['cache-control'], 'public, max-age=300');
  });
});
