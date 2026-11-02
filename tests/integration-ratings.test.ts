import { afterEach, describe, test } from 'node:test';
import {
  assert,
  Pool,
  TEST_DATABASE_URL,
  startServer,
  registerUser,
  joinFestivalProfile,
  TRUSTED_MUTATION_HEADER,
} from './_integration-helpers';

const servers: any[] = [];

async function savePicks(server: any, token: string, profileId: string, picks: Record<string, string>) {
  await server.request.put(`/api/v1/profiles/${profileId}`).set('x-user-token', token).send({ picks }).expect(200);
}

async function createCrew(server: any, token: string) {
  const res = await server.request
    .post('/api/v1/crews')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ name: `Crew ${Date.now()}`, festivalId: 'fest-1' })
    .expect(201);
  return res.body.data;
}

async function joinCrew(server: any, token: string, inviteCode: string) {
  await server.request
    .post('/api/v1/crews/join')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ inviteCode })
    .expect(200);
}

async function getWrap(server: any, token: string, query = '') {
  const res = await server.request.get(`/api/v1/ratings/wrap/fest-1${query}`).set('x-user-token', token).expect(200);
  return res.body.data;
}

async function markCaught(server: any, token: string, setId: string, caught: boolean | null) {
  return server.request.put(`/api/v1/ratings/${setId}/caught`).set('x-user-token', token).send({ caught }).expect(200);
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Ratings', { concurrency: 1 }, () => {
  test('creates a rating for a set, retrieves it by festival, then deletes it', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'ratings-alice-' + Date.now());
    await joinFestivalProfile(server, alice.token);

    // Create rating for set-a (exists in seed data as part of fest-1)
    const createRes = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', alice.token)
      .send({ rating: 5, note: 'Amazing show!' })
      .expect(200);

    assert.equal(createRes.body.error, null);
    assert.equal(createRes.body.data.rating, 5);
    assert.equal(createRes.body.data.note, 'Amazing show!');
    assert.equal(createRes.body.data.setId, 'set-a');

    // Retrieve ratings for the festival
    const listRes = await server.request
      .get('/api/v1/ratings/festival/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);

    assert.equal(listRes.body.error, null);
    assert.ok(Array.isArray(listRes.body.data.ratings));
    assert.equal(listRes.body.data.ratings.length, 1);
    assert.equal(listRes.body.data.ratings[0].setId, 'set-a');
    assert.equal(listRes.body.data.ratings[0].rating, 5);

    // Delete the rating
    const deleteRes = await server.request
      .delete('/api/v1/ratings/set-a')
      .set('x-user-token', alice.token)
      .expect(200);

    assert.equal(deleteRes.body.error, null);
    assert.equal(deleteRes.body.data.deleted, true);

    // Verify deletion
    const afterDelete = await server.request
      .get('/api/v1/ratings/festival/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);

    assert.equal(afterDelete.body.data.ratings.length, 0);
  });

  test('upserts a rating when the same set is rated again', async () => {
    const server = await startServer();
    servers.push(server);

    const bob = await registerUser(server, 'ratings-bob-' + Date.now());
    await joinFestivalProfile(server, bob.token);

    // Create initial rating
    await server.request
      .post('/api/v1/ratings/set-b')
      .set('x-user-token', bob.token)
      .send({ rating: 3 })
      .expect(200);

    // Update rating for the same set
    const upsertRes = await server.request
      .post('/api/v1/ratings/set-b')
      .set('x-user-token', bob.token)
      .send({ rating: 5, note: 'Changed my mind, was great!' })
      .expect(200);

    assert.equal(upsertRes.body.data.rating, 5);
    assert.equal(upsertRes.body.data.note, 'Changed my mind, was great!');

    // Verify only one rating exists for that set
    const listRes = await server.request
      .get('/api/v1/ratings/festival/fest-1')
      .set('x-user-token', bob.token)
      .expect(200);

    assert.equal(listRes.body.data.ratings.length, 1);
    assert.equal(listRes.body.data.ratings[0].rating, 5);
  });

  test('requires authentication for rating endpoints', async () => {
    const server = await startServer();
    servers.push(server);

    // POST without auth
    await server.request
      .post('/api/v1/ratings/set-a')
      .send({ rating: 4 })
      .expect(401);

    // GET user ratings without auth
    await server.request
      .get('/api/v1/ratings/festival/fest-1')
      .expect(401);

    // DELETE without auth
    await server.request
      .delete('/api/v1/ratings/set-a')
      .expect(401);
  });

  test('rejects invalid rating values', async () => {
    const server = await startServer();
    servers.push(server);

    const charlie = await registerUser(server, 'ratings-charlie-' + Date.now());
    await joinFestivalProfile(server, charlie.token);

    // Rating too low (0)
    const tooLow = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', charlie.token)
      .send({ rating: 0 });
    assert.ok(tooLow.status >= 400, 'Rating of 0 should be rejected');

    // Rating too high (6)
    const tooHigh = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', charlie.token)
      .send({ rating: 6 });
    assert.ok(tooHigh.status >= 400, 'Rating of 6 should be rejected');

    // Non-integer rating
    const nonInt = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', charlie.token)
      .send({ rating: 3.5 });
    assert.ok(nonInt.status >= 400, 'Non-integer rating should be rejected');

    // Missing rating field
    const missing = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', charlie.token)
      .send({ note: 'no rating' });
    assert.ok(missing.status >= 400, 'Missing rating should be rejected');
  });

  test('returns 404 when rating a nonexistent set', async () => {
    const server = await startServer();
    servers.push(server);

    const dave = await registerUser(server, 'ratings-dave-' + Date.now());
    await joinFestivalProfile(server, dave.token);

    const res = await server.request
      .post('/api/v1/ratings/nonexistent-set-' + Date.now())
      .set('x-user-token', dave.token)
      .send({ rating: 4 });

    assert.equal(res.status, 404);
  });

  test('aggregate ratings endpoint returns data for all users', async () => {
    const server = await startServer();
    servers.push(server);

    const user1 = await registerUser(server, 'ratings-agg1-' + Date.now());
    const user2 = await registerUser(server, 'ratings-agg2-' + Date.now());
    await joinFestivalProfile(server, user1.token);
    await joinFestivalProfile(server, user2.token);

    // Both users rate set-c
    await server.request
      .post('/api/v1/ratings/set-c')
      .set('x-user-token', user1.token)
      .send({ rating: 4 })
      .expect(200);

    await server.request
      .post('/api/v1/ratings/set-c')
      .set('x-user-token', user2.token)
      .send({ rating: 2 })
      .expect(200);

    // Aggregate endpoint is public (no auth required)
    const aggRes = await server.request
      .get('/api/v1/ratings/festival/fest-1/all')
      .expect(200);

    assert.equal(aggRes.body.error, null);
    const setCRating = aggRes.body.data.ratings.find((r: any) => r.setId === 'set-c');
    assert.ok(setCRating, 'set-c should appear in aggregate ratings');
    assert.equal(setCRating.totalRatings, 2);
    assert.equal(setCRating.avgRating, 3); // (4+2)/2
    // Public endpoint: per-set aggregates only, never per-user rows.
    assert.equal('ratings' in setCRating, false);
    assert.ok(!JSON.stringify(aggRes.body).includes('userId'), 'aggregate response must not expose user ids');
  });

  test('wrap stats returns summary for user ratings', async () => {
    const server = await startServer();
    servers.push(server);

    const eve = await registerUser(server, 'ratings-eve-' + Date.now());
    await joinFestivalProfile(server, eve.token);

    // Rate multiple sets
    await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', eve.token)
      .send({ rating: 5 })
      .expect(200);

    await server.request
      .post('/api/v1/ratings/set-d')
      .set('x-user-token', eve.token)
      .send({ rating: 4 })
      .expect(200);

    const wrapRes = await server.request
      .get('/api/v1/ratings/wrap/fest-1')
      .set('x-user-token', eve.token)
      .expect(200);

    assert.equal(wrapRes.body.error, null);
    assert.ok(wrapRes.body.data.stats);
    assert.equal(wrapRes.body.data.stats.totalRated, 2);
    assert.ok(wrapRes.body.data.stats.avgRating > 0);
    assert.ok(Array.isArray(wrapRes.body.data.topSets));
    assert.ok(Array.isArray(wrapRes.body.data.allRatings));
  });

  test('wrap lists picks for a user with no ratings', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'wrap-picks-' + Date.now());
    const profile = await joinFestivalProfile(server, user.token);
    await savePicks(server, user.token, profile.id, { 'set-a': 'must', 'set-d': 'maybe' });

    const wrap = await getWrap(server, user.token);
    assert.equal(wrap.stats.totalRated, 0);
    assert.deepEqual(
      wrap.planned.map((p: any) => [p.setId, p.priority, p.stageName, p.rating]),
      [
        ['set-a', 'must', 'Main Stage', null],
        ['set-d', 'maybe', 'Forest Stage', null],
      ],
    );
    assert.equal(wrap.festival.name, 'Test Fest');
    assert.deepEqual(wrap.festival.days, [
      { date: '2026-06-05', label: 'Friday' },
      { date: '2026-06-06', label: 'Saturday' },
    ]);
  });

  test('re-rating without a note keeps the note; an empty note clears it', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'wrap-note-' + Date.now());
    await joinFestivalProfile(server, user.token);
    const rate = (body: any) =>
      server.request.post('/api/v1/ratings/set-a').set('x-user-token', user.token).send(body).expect(200);

    await rate({ rating: 5, note: 'Front row' });
    const kept = await rate({ rating: 4 });
    assert.equal(kept.body.data.note, 'Front row');
    assert.equal(kept.body.data.rating, 4);

    const cleared = await rate({ rating: 4, note: '' });
    assert.equal(cleared.body.data.note, '');
  });

  test('crewAlso counts only other crew members who picked the set', async () => {
    const server = await startServer();
    servers.push(server);

    const stamp = Date.now();
    const alice = await registerUser(server, 'wrap-crew-a-' + stamp);
    const bob = await registerUser(server, 'wrap-crew-b-' + stamp);
    const outsider = await registerUser(server, 'wrap-crew-o-' + stamp);
    const aliceProfile = await joinFestivalProfile(server, alice.token);
    const bobProfile = await joinFestivalProfile(server, bob.token);
    const outsiderProfile = await joinFestivalProfile(server, outsider.token);

    const crew = await createCrew(server, alice.token);
    await joinCrew(server, bob.token, crew.inviteCode);
    await savePicks(server, alice.token, aliceProfile.id, { 'set-a': 'must', 'set-c': 'maybe' });
    await savePicks(server, bob.token, bobProfile.id, { 'set-a': 'must' });
    await savePicks(server, outsider.token, outsiderProfile.id, { 'set-a': 'must', 'set-c': 'must' });

    const aliceWrap = await getWrap(server, alice.token);
    assert.equal(aliceWrap.crew.id, crew.id);
    assert.equal(aliceWrap.crew.memberCount, 2);
    assert.equal(aliceWrap.planned.find((p: any) => p.setId === 'set-a').crewAlso, 1);
    assert.equal(aliceWrap.planned.find((p: any) => p.setId === 'set-c').crewAlso, 0);

    const bobWrap = await getWrap(server, bob.token);
    assert.equal(bobWrap.planned.find((p: any) => p.setId === 'set-a').crewAlso, 1);

    const outsiderWrap = await getWrap(server, outsider.token);
    assert.equal(outsiderWrap.crew, null);
    assert.ok(outsiderWrap.planned.length > 0);
    assert.ok(outsiderWrap.planned.every((p: any) => p.crewAlso === null));
  });

  test('a crewId the user is not in falls back to their own crew or null', async () => {
    const server = await startServer();
    servers.push(server);

    const stamp = Date.now();
    const alice = await registerUser(server, 'wrap-foreign-a-' + stamp);
    const bob = await registerUser(server, 'wrap-foreign-b-' + stamp);
    await joinFestivalProfile(server, alice.token);
    await joinFestivalProfile(server, bob.token);
    const aliceCrew = await createCrew(server, alice.token);
    const bobCrew = await createCrew(server, bob.token);

    const aliceWrap = await getWrap(server, alice.token, `?crewId=${bobCrew.id}`);
    assert.equal(aliceWrap.crew.id, aliceCrew.id);

    const loner = await registerUser(server, 'wrap-foreign-l-' + stamp);
    await joinFestivalProfile(server, loner.token);
    const lonerWrap = await getWrap(server, loner.token, `?crewId=${bobCrew.id}`);
    assert.equal(lonerWrap.crew, null);
  });

  test('wrap returns 404 for an unknown festival', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'wrap-404-' + Date.now());
    const res = await server.request
      .get('/api/v1/ratings/wrap/no-such-festival')
      .set('x-user-token', user.token)
      .expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('a rated set from 23:00 to 01:00 adds 2 hours', async () => {
    const server = await startServer();
    servers.push(server);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query(
        'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        ['set-late', 'fest-1', 0, 'Late', 'main', '23:00', '01:00', 9],
      );
    } finally {
      await pool.end();
    }

    const user = await registerUser(server, 'wrap-late-' + Date.now());
    await joinFestivalProfile(server, user.token);
    await server.request
      .post('/api/v1/ratings/set-late')
      .set('x-user-token', user.token)
      .send({ rating: 5 })
      .expect(200);

    const wrap = await getWrap(server, user.token);
    assert.equal(wrap.stats.totalHours, 2);
  });

  test('caught marks write and clear, and drive wrap hours and stages when present', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'wrap-caught-' + Date.now());
    const profile = await joinFestivalProfile(server, user.token);
    await savePicks(server, user.token, profile.id, { 'set-a': 'must', 'set-d': 'maybe' });
    for (const setId of ['set-a', 'set-b']) {
      await server.request
        .post(`/api/v1/ratings/${setId}`)
        .set('x-user-token', user.token)
        .send({ rating: 4 })
        .expect(200);
    }

    // No marks: rated sets count (set-a main + set-b forest, 1 h each).
    let wrap = await getWrap(server, user.token);
    assert.equal(wrap.stats.totalHours, 2);
    assert.equal(wrap.stats.stagesVisited, 2);

    const written = await markCaught(server, user.token, 'set-d', true);
    assert.equal(written.body.data.caught, true);
    await markCaught(server, user.token, 'set-a', false);

    // Marks exist: only caught = true sets count (set-d, forest, 1 h).
    wrap = await getWrap(server, user.token);
    assert.equal(wrap.stats.totalHours, 1);
    assert.equal(wrap.stats.stagesVisited, 1);
    assert.equal(wrap.stats.totalRated, 2);
    assert.equal(wrap.planned.find((p: any) => p.setId === 'set-a').caught, false);
    assert.equal(wrap.planned.find((p: any) => p.setId === 'set-d').caught, true);

    const cleared = await markCaught(server, user.token, 'set-d', null);
    assert.equal(cleared.body.data.caught, null);
    await markCaught(server, user.token, 'set-a', null);

    wrap = await getWrap(server, user.token);
    assert.equal(wrap.stats.totalHours, 2);
    assert.ok(wrap.planned.every((p: any) => p.caught === null));
  });

  test('saving profile picks keeps the caught mark', async () => {
    const server = await startServer();
    servers.push(server);

    const user = await registerUser(server, 'wrap-caught-keep-' + Date.now());
    const profile = await joinFestivalProfile(server, user.token);
    await savePicks(server, user.token, profile.id, { 'set-a': 'must' });
    await markCaught(server, user.token, 'set-a', true);
    await savePicks(server, user.token, profile.id, { 'set-a': 'must', 'set-c': 'maybe' });

    const wrap = await getWrap(server, user.token);
    assert.equal(wrap.planned.find((p: any) => p.setId === 'set-a').caught, true);
  });
});
