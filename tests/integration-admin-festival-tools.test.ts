import { afterEach, describe, test } from 'node:test';
import { assert, Pool, startServer, registerUser, joinFestivalProfile, loginAdmin } from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Admin festival tools', { concurrency: 1 }, () => {
  test('stores, keeps and clears the festival venue', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    const venueOf = async () => {
      const res = await server.request.get('/api/v1/festivals/fest-1').expect(200);
      return [res.body.data.latitude, res.body.data.longitude];
    };

    await server.request
      .put('/api/v1/admin/festivals/fest-1')
      .set('x-user-token', adminToken)
      .send({ name: 'Venue Fest', latitude: 28.5383, longitude: -81.3792 })
      .expect(200);
    assert.deepEqual(await venueOf(), [28.5383, -81.3792]);

    // A save that leaves the venue out keeps it. (The PUT always needs a name.)
    await server.request
      .put('/api/v1/admin/festivals/fest-1')
      .set('x-user-token', adminToken)
      .send({ name: 'Renamed Fest' })
      .expect(200);
    assert.deepEqual(await venueOf(), [28.5383, -81.3792]);

    // Half a venue clears both.
    await server.request
      .put('/api/v1/admin/festivals/fest-1')
      .set('x-user-token', adminToken)
      .send({ name: 'Renamed Fest', latitude: 28.5 })
      .expect(200);
    assert.deepEqual(await venueOf(), [null, null]);
  });

  test('counts picks and reminders per set and skips deleted profiles', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    const profiles: any[] = [];
    for (const name of ['eng-alice', 'eng-bob', 'eng-carol']) {
      const user = await registerUser(server, name);
      const profile = await joinFestivalProfile(server, user.token);
      profiles.push(profile);
      await server.request
        .put(`/api/v1/profiles/${profile.id}`)
        .set('x-user-token', user.token)
        .send({ picks: { 'set-a': 'must', 'set-b': 'maybe' }, reminders: { 'set-a': 15 } })
        .expect(200);
    }

    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      await pool.query('UPDATE festival_profiles SET deleted_at = NOW() WHERE id = $1', [profiles[2].id]);
    } finally {
      await pool.end();
    }

    const res = await server.request
      .get('/api/v1/admin/festivals/fest-1/set-engagement')
      .set('x-user-token', adminToken)
      .expect(200);
    assert.deepEqual(res.body.data, {
      'set-a': { picks: 2, reminders: 2 },
      'set-b': { picks: 2, reminders: 0 },
    });

    await server.request
      .get('/api/v1/admin/festivals/missing-fest/set-engagement')
      .set('x-user-token', adminToken)
      .expect(404);
  });
});
