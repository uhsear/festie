import { afterEach, describe, test } from 'node:test';
import {
  assert,
  Pool,
  TEST_DATABASE_URL,
  startServer,
  registerUser,
  joinFestivalProfile,
  loginAdmin,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

// Seeds fest-1 (live, from the fixture) and fest-dead (deleted); alice and bob
// (live) and carol (deleted); picks of each priority; a 1-member crew, a crew of
// alice, bob and carol, and a crew on the deleted festival.
async function seed(server: any) {
  const adminToken = await loginAdmin(server);
  const alice = await registerUser(server, 'alice');
  const bob = await registerUser(server, 'bob');
  const carol = await registerUser(server, 'carol');
  for (const u of [alice, bob, carol]) await joinFestivalProfile(server, u.token);

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const ids = { alice: alice.user.id, bob: bob.user.id, carol: carol.user.id };
    const { rows } = await pool.query(
      "SELECT id, user_id FROM festival_profiles WHERE festival_id = 'fest-1'",
    );
    const plan = (userId: string) => rows.find((r: any) => r.user_id === userId).id;

    await pool.query(
      "INSERT INTO festivals (id, name, location, created_at, updated_at, deleted_at) VALUES ('fest-dead', 'Dead Fest', 'Nowhere', NOW(), NOW(), NOW())",
    );
    await pool.query(
      "INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ('fest-dead', 'main', 'Main', '#fff', 0)",
    );
    await pool.query(
      "INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ('set-z', 'fest-dead', 0, 'Zed', 'main', '10:00', '11:00', 0)",
    );
    await pool.query(
      "INSERT INTO festival_profiles (id, festival_id, user_id, name, created_at, updated_at) VALUES ('plan-dead', 'fest-dead', $1, 'alice', NOW(), NOW())",
      [ids.alice],
    );

    const picks: Array<[string, string, string]> = [
      [plan(ids.alice), 'set-a', 'must'],
      [plan(ids.alice), 'set-b', 'want-to-see'],
      [plan(ids.alice), 'set-d', 'maybe'],
      [plan(ids.bob), 'set-a', 'must'],
      [plan(ids.carol), 'set-a', 'must'],
      ['plan-dead', 'set-z', 'must'],
    ];
    for (const [profileId, setId, priority] of picks) {
      await pool.query(
        'INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, $3)',
        [profileId, setId, priority],
      );
    }

    const crews: Array<[string, string, string[]]> = [
      ['crew-solo', 'fest-1', [ids.alice]],
      ['crew-three', 'fest-1', [ids.alice, ids.bob, ids.carol]],
      ['crew-dead', 'fest-dead', [ids.bob, ids.alice]],
    ];
    for (const [crewId, festivalId, members] of crews) {
      await pool.query(
        'INSERT INTO crews (id, festival_id, name, created_by) VALUES ($1, $2, $1, $3)',
        [crewId, festivalId, members[0]],
      );
      for (const userId of members) {
        await pool.query('INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)', [crewId, userId]);
      }
    }

    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [ids.carol]);
  } finally {
    await pool.end();
  }
  return adminToken;
}

// Seeds clashing picks on fest-1: five live users pick set-a, set-b, set-c and the
// past-midnight pair set-late/set-later; four of them also pick set-e (overlaps
// set-c, under the floor); a sixth user picks set-a and set-b, then is deleted.
async function seedClashes(server: any) {
  const adminToken = await loginAdmin(server);
  const users: any[] = [];
  for (const name of ['u1', 'u2', 'u3', 'u4', 'u5', 'gone']) {
    // /auth/register allows 5 per IP per window; six users need a fresh window.
    server.planner.state.routeRateLimits.clear();
    const u = await registerUser(server, name);
    await joinFestivalProfile(server, u.token);
    users.push(u);
  }
  const plainToken = users[0].token;
  const userIds = users.map((u) => u.user.id);
  const usernames = ['u1', 'u2', 'u3', 'u4', 'u5', 'gone'];

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const extraSets: Array<[string, string, string, string, string]> = [
      ['set-e', 'Epsilon', 'forest', '12:30', '13:30'],
      ['set-late', 'Late', 'main', '23:00', '01:00'],
      ['set-later', 'Later', 'forest', '00:30', '02:00'],
    ];
    for (const [id, artist, stageId, start, end] of extraSets) {
      await pool.query(
        "INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, 'fest-1', 0, $2, $3, $4, $5, 10)",
        [id, artist, stageId, start, end],
      );
    }
    const { rows } = await pool.query(
      "SELECT id, user_id FROM festival_profiles WHERE festival_id = 'fest-1'",
    );
    const plan = (userId: string) => rows.find((r: any) => r.user_id === userId).id;

    const picks: Array<[string, string]> = [];
    userIds.slice(0, 5).forEach((userId, i) => {
      for (const setId of ['set-a', 'set-b', 'set-c', 'set-late', 'set-later']) picks.push([plan(userId), setId]);
      if (i < 4) picks.push([plan(userId), 'set-e']);
    });
    for (const setId of ['set-a', 'set-b']) picks.push([plan(userIds[5]), setId]);
    for (const [profileId, setId] of picks) {
      await pool.query(
        'INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, $3)',
        [profileId, setId, 'must'],
      );
    }

    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [userIds[5]]);
  } finally {
    await pool.end();
  }
  return { adminToken, plainToken, userIds, usernames };
}

const EXPECTED_TOTALS = {
  signedUp: 3, // admin, alice, bob
  usersWithPlan: 2,
  plans: 2,
  plansWithPicks: 2,
  usersWithPick: 2,
  picks: 4,
  crews: 2,
  crewMembers: 3,
  usersInCrews: 2,
  crewsWithTwoPlus: 1,
};

describe('Integration — Admin analytics', { concurrency: 1 }, () => {
  test('returns true totals that skip deleted festivals and users', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await seed(server);

    for (const event of ['shown', 'shown', 'accepted']) {
      await server.request.post('/api/v1/analytics/install').send({ platform: 'desktop', event }).expect(204);
    }

    const res = await server.request.get('/api/v1/admin/analytics').set('x-user-token', adminToken).expect(200);
    const data = res.body.data;
    assert.deepEqual(data.scope, { festivalId: null, festivalName: null });
    assert.deepEqual(data.totals, EXPECTED_TOTALS);
    assert.deepEqual(data.pickDistribution, { must: 2, want: 1, maybe: 1 });
    assert.deepEqual(data.install, { days: 30, shown: 2, accepted: 1, dismissed: 0 });

    assert.equal(data.topSets[0].artist, 'Alpha');
    assert.equal(data.topSets[0].pickCount, 2);
    assert.equal(data.topSets[0].festivalName, 'Test Fest');
    assert.equal(data.topSets[0].dayLabel, 'Friday');
    assert.ok(data.topSets.every((s: any) => s.festivalId === 'fest-1'));

    assert.deepEqual(data.crews.map((c: any) => c.id).sort(), ['crew-solo', 'crew-three']);
    assert.equal(data.crews.find((c: any) => c.id === 'crew-three').memberCount, 2);
    assert.ok(data.crews.every((c: any) => c.festivalName === 'Test Fest'));

    assert.deepEqual(data.festivalStats.map((f: any) => f.id), ['fest-1']);
    assert.ok(!data.activeUsers.some((u: any) => u.username === 'carol'));
  });

  test('filters by festival and refuses unknown or deleted festivals', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await seed(server);

    const res = await server.request
      .get('/api/v1/admin/analytics?festivalId=fest-1')
      .set('x-user-token', adminToken)
      .expect(200);
    assert.deepEqual(res.body.data.scope, { festivalId: 'fest-1', festivalName: 'Test Fest' });
    assert.deepEqual(res.body.data.totals, EXPECTED_TOTALS);
    assert.ok(res.body.data.topSets.every((s: any) => s.festivalId === 'fest-1'));

    for (const festivalId of ['nope', 'fest-dead']) {
      const missing = await server.request
        .get(`/api/v1/admin/analytics?festivalId=${festivalId}`)
        .set('x-user-token', adminToken)
        .expect(404);
      assert.equal(missing.body.error.message, 'Festival not found.');
    }

    await server.request.get('/api/v1/admin/analytics/view').set('x-user-token', adminToken).expect(404);
  });
  test('pick insight returns clashing pairs over the floor and no user ids', async () => {
    const server = await startServer();
    servers.push(server);
    const { adminToken, plainToken, userIds, usernames } = await seedClashes(server);
    const path = '/api/v1/admin/analytics/festivals/fest-1/picks';

    const res = await server.request.get(path).set('x-user-token', adminToken).expect(200);
    const data = res.body.data;
    assert.equal(data.minPairPeople, 5);
    assert.deepEqual(
      data.clashes.map((c: any) => [c.aSetId, c.bSetId, c.people]).sort(),
      [['set-a', 'set-b', 5], ['set-late', 'set-later', 5]],
    );
    const setA = data.sets.find((s: any) => s.setId === 'set-a');
    assert.equal(setA.picks, 5);
    assert.equal(setA.must, 5);
    assert.equal(setA.dayLabel, 'Friday');
    assert.equal(data.sets.find((s: any) => s.setId === 'set-e').picks, 4);
    assert.equal(data.sets.find((s: any) => s.setId === 'set-d').picks, 0);

    const body = JSON.stringify(res.body);
    for (const id of userIds) assert.ok(!body.includes(id), 'no user id in the body');
    for (const name of usernames) assert.ok(!body.includes(`"${name}"`), 'no username in the body');

    await server.request.get(path).set('x-user-token', plainToken).expect(403);
    await server.request.get('/api/v1/admin/analytics/festivals/nope/picks').set('x-user-token', adminToken).expect(404);
  });
});
