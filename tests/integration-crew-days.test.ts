import { afterEach, describe, test } from 'node:test';
import { assert, Pool, startServer, registerUser, joinFestivalProfile } from './_integration-helpers';

// 090: crew days and "I'll be there" taps hang off crew_members with ON DELETE
// CASCADE, so leave, kick and crew delete clear them with no route code.

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

// Alice owns the crew; Bob and Charlie join it. fest-1 has two days.
async function crewOfThree() {
  const server = await startServer();
  servers.push(server);
  const alice = await registerUser(server, 'alice');
  const bob = await registerUser(server, 'bob');
  const charlie = await registerUser(server, 'charlie');
  for (const u of [alice, bob, charlie]) await joinFestivalProfile(server, u.token, 'fest-1');
  const crew = (
    await server.request
      .post('/api/v1/crews')
      .set('x-user-token', alice.token)
      .send({ name: 'Days Crew', festivalId: 'fest-1' })
      .expect(201)
  ).body.data;
  for (const u of [bob, charlie]) {
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', u.token)
      .send({ inviteCode: crew.inviteCode })
      .expect(200);
  }
  const point = (
    await server.request
      .post(`/api/v1/crews/${crew.id}/meeting-points`)
      .set('x-user-token', alice.token)
      .send({ label: 'Tree', location: 'By the big tree' })
      .expect(201)
  ).body.data.meetingPoint;
  assert.deepEqual(point.coming, []);
  return { server, crew, point, alice, bob, charlie };
}

async function answerAndTap(server: any, crewId: string, mpId: string, token: string) {
  await server.request
    .put(`/api/v1/crews/${crewId}/days`)
    .set('x-user-token', token)
    .send({
      days: [
        { dayIndex: 0, answer: 'going' },
        { dayIndex: 1, answer: 'no' },
      ],
    })
    .expect(200);
  await server.request
    .put(`/api/v1/crews/${crewId}/meeting-points/${mpId}/coming`)
    .set('x-user-token', token)
    .send({ coming: true })
    .expect(200);
}

async function rowsFor(server: any, crewId: string, userId?: string) {
  const pool = new Pool({ connectionString: server.databaseUrl });
  try {
    const where = userId ? 'crew_id = $1 AND user_id = $2' : 'crew_id = $1';
    const args = userId ? [crewId, userId] : [crewId];
    const days = await pool.query(`SELECT 1 FROM crew_member_days WHERE ${where}`, args);
    const taps = await pool.query(`SELECT 1 FROM crew_meeting_point_coming WHERE ${where}`, args);
    return { days: days.rowCount, taps: taps.rowCount };
  } finally {
    await pool.end();
  }
}

describe('Integration — crew days and "I\'ll be there"', { concurrency: 1 }, () => {
  test('PUT days then GET returns the rows; a day past the festival is 400; a tap is idempotent', async () => {
    const { server, crew, point, alice, bob } = await crewOfThree();
    await answerAndTap(server, crew.id, point.id, bob.token);
    const list = (
      await server.request.get(`/api/v1/crews/${crew.id}/days`).set('x-user-token', alice.token).expect(200)
    ).body.data.days;
    assert.deepEqual(list, [
      { userId: bob.user.id, dayIndex: 0, answer: 'going' },
      { userId: bob.user.id, dayIndex: 1, answer: 'no' },
    ]);

    const past = await server.request
      .put(`/api/v1/crews/${crew.id}/days`)
      .set('x-user-token', bob.token)
      .send({ days: [{ dayIndex: 2, answer: 'going' }] });
    assert.equal(past.status, 400);

    const again = await server.request
      .put(`/api/v1/crews/${crew.id}/meeting-points/${point.id}/coming`)
      .set('x-user-token', bob.token)
      .send({ coming: true })
      .expect(200);
    assert.deepEqual(again.body.data.meetingPoint.coming, [bob.user.id]);
    const points = (
      await server.request.get(`/api/v1/crews/${crew.id}/meeting-points`).set('x-user-token', alice.token).expect(200)
    ).body.data.meetingPoints;
    assert.deepEqual(points[0].coming, [bob.user.id]);
  });

  test('concurrent PUTs and a repeated dayIndex are 200 and leave the last body', async () => {
    const { server, crew, alice, bob } = await crewOfThree();
    const put = (token: string, days: any[]) =>
      server.request.put(`/api/v1/crews/${crew.id}/days`).set('x-user-token', token).send({ days });
    const bodyA = [
      { dayIndex: 0, answer: 'going' },
      { dayIndex: 1, answer: 'no' },
    ];
    const results = await Promise.all([put(bob.token, bodyA), put(bob.token, bodyA), put(bob.token, bodyA)]);
    assert.deepEqual(
      results.map((r) => r.status),
      [200, 200, 200],
    );
    const repeated = await put(bob.token, [
      { dayIndex: 1, answer: 'going' },
      { dayIndex: 1, answer: 'maybe' },
    ]);
    assert.equal(repeated.status, 200);
    const list = (
      await server.request.get(`/api/v1/crews/${crew.id}/days`).set('x-user-token', alice.token).expect(200)
    ).body.data.days;
    assert.deepEqual(list, [{ userId: bob.user.id, dayIndex: 1, answer: 'maybe' }]);
  });

  test("leaving the crew clears that member's days and taps", async () => {
    const { server, crew, point, bob, charlie } = await crewOfThree();
    await answerAndTap(server, crew.id, point.id, bob.token);
    await answerAndTap(server, crew.id, point.id, charlie.token);
    await server.request.delete(`/api/v1/crews/${crew.id}/leave`).set('x-user-token', bob.token).expect(200);
    assert.deepEqual(await rowsFor(server, crew.id, bob.user.id), { days: 0, taps: 0 });
    assert.deepEqual(await rowsFor(server, crew.id, charlie.user.id), { days: 2, taps: 1 });
  });

  test("being kicked clears that member's days and taps", async () => {
    const { server, crew, point, alice, charlie } = await crewOfThree();
    await answerAndTap(server, crew.id, point.id, charlie.token);
    await server.request
      .delete(`/api/v1/crews/${crew.id}/members/${charlie.user.id}`)
      .set('x-user-token', alice.token)
      .expect(200);
    assert.deepEqual(await rowsFor(server, crew.id, charlie.user.id), { days: 0, taps: 0 });
  });

  test('deleting the crew clears every day row and tap', async () => {
    const { server, crew, point, alice, bob } = await crewOfThree();
    await answerAndTap(server, crew.id, point.id, alice.token);
    await answerAndTap(server, crew.id, point.id, bob.token);
    await server.request.delete(`/api/v1/crews/${crew.id}`).set('x-user-token', alice.token).expect(200);
    assert.deepEqual(await rowsFor(server, crew.id), { days: 0, taps: 0 });
  });
});
