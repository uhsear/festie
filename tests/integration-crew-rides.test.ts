import { afterEach, describe, test } from 'node:test';
import { assert, startServer, registerUser, joinFestivalProfile } from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

// Alice owns the crew; Bob and Charlie join it. All three are on fest-1.
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
      .send({ name: 'Ride Crew', festivalId: 'fest-1' })
      .expect(201)
  ).body.data;
  for (const u of [bob, charlie]) {
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', u.token)
      .send({ inviteCode: crew.inviteCode })
      .expect(200);
  }
  return { server, crew, alice, bob, charlie };
}

async function postRide(server: any, crewId: string, token: string, seats: number) {
  const res = await server.request
    .post(`/api/v1/crews/${crewId}/rides`)
    .set('x-user-token', token)
    .send({ driver: 'Alice', seats, direction: 'to_festival', departTime: '2026-06-05T16:00:00.000Z' })
    .expect(200);
  return res.body.data.offer;
}

describe('Integration — crew ride seats', { concurrency: 1 }, () => {
  test('two people racing for the last seat: one gets it, the other gets 409', async () => {
    const { server, crew, alice, bob, charlie } = await crewOfThree();
    const offer = await postRide(server, crew.id, alice.token, 1);
    assert.equal(offer.direction, 'to_festival');
    assert.equal(new Date(offer.depart_time).toISOString(), '2026-06-05T16:00:00.000Z');
    assert.deepEqual(offer.passenger_ids, []);

    const seatUrl = `/api/v1/crews/${crew.id}/rides/${offer.id}/seat`;
    const results = await Promise.all(
      [bob, charlie].map((u) => server.request.post(seatUrl).set('x-user-token', u.token)),
    );
    const statuses = results.map((r: any) => r.status).sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser: any = results.find((r: any) => r.status === 409);
    assert.equal(loser.body.error.message, 'This ride is full.');

    const rides = (
      await server.request.get(`/api/v1/crews/${crew.id}/rides`).set('x-user-token', alice.token).expect(200)
    ).body.data.offers;
    assert.equal(rides[0].passenger_ids.length, 1);
  });

  test('a passenger who leaves the crew drops off the ride and frees the seat', async () => {
    const { server, crew, alice, bob, charlie } = await crewOfThree();
    const offer = await postRide(server, crew.id, alice.token, 1);
    const seatUrl = `/api/v1/crews/${crew.id}/rides/${offer.id}/seat`;

    const taken = await server.request.post(seatUrl).set('x-user-token', bob.token).expect(200);
    assert.deepEqual(taken.body.data.offer.passenger_ids, [bob.user.id]);

    await server.request.delete(`/api/v1/crews/${crew.id}/leave`).set('x-user-token', bob.token).expect(200);

    const rides = (
      await server.request.get(`/api/v1/crews/${crew.id}/rides`).set('x-user-token', alice.token).expect(200)
    ).body.data.offers;
    assert.deepEqual(rides[0].passenger_ids, []);

    const charlieSeat = await server.request.post(seatUrl).set('x-user-token', charlie.token).expect(200);
    assert.deepEqual(charlieSeat.body.data.offer.passenger_ids, [charlie.user.id]);
  });
});
