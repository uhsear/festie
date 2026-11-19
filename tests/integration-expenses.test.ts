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
      .send({ name: 'Money Crew', festivalId: 'fest-1' })
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

async function plan(server: any, crewId: string, token: string) {
  return (
    await server.request.get(`/api/v1/crews/${crewId}/expenses/settlement-plan`).set('x-user-token', token).expect(200)
  ).body.data;
}

const sumCents = (balances: { balance: number }[]) => balances.reduce((sum, b) => sum + Math.round(b.balance * 100), 0);

describe('Integration — crew money', { concurrency: 1 }, () => {
  test('an uneven expense stays zero-sum after a member leaves', async () => {
    const { server, crew, alice, bob, charlie } = await crewOfThree();
    const ids = [alice.user.id, bob.user.id, charlie.user.id];

    // Charlie logs a $100.01 dinner that Alice paid, split 30.00 / 30.00 / 40.01.
    const created = await server.request
      .post(`/api/v1/crews/${crew.id}/expenses`)
      .set('x-user-token', charlie.token)
      .send({
        description: 'Dinner',
        amount: 100.01,
        splitWith: ids,
        paidBy: alice.user.id,
        shares: [
          { userId: ids[0], cents: 3000 },
          { userId: ids[1], cents: 3000 },
          { userId: ids[2], cents: 4001 },
        ],
      })
      .expect(201);
    assert.equal(created.body.data.paid_by, alice.user.id);
    assert.equal(created.body.data.created_by, charlie.user.id);

    const before = await plan(server, crew.id, alice.token);
    assert.equal(sumCents(before.balances), 0);

    await server.request.delete(`/api/v1/crews/${crew.id}/leave`).set('x-user-token', charlie.token).expect(200);

    const after = await plan(server, crew.id, alice.token);
    assert.equal(after.balances.length, 2);
    assert.equal(sumCents(after.balances), 0);
    // Charlie's 4001 cents are pooled over Alice and Bob as 2001 + 2000. The odd
    // cent goes to the first JSONB key, and JSONB orders keys itself.
    const bobBalance = after.balances.find((b: any) => b.userId === bob.user.id);
    assert.ok([-5000, -5001].includes(Math.round(bobBalance.balance * 100)));
  });

  test('the owner can set USD, a member gets 403, and any other currency is refused', async () => {
    const { server, crew, alice, bob } = await crewOfThree();

    assert.equal((await plan(server, crew.id, alice.token)).currency, 'USD');

    await server.request
      .put(`/api/v1/crews/${crew.id}/expenses/currency`)
      .set('x-user-token', bob.token)
      .send({ currency: 'USD' })
      .expect(403);

    await server.request
      .put(`/api/v1/crews/${crew.id}/expenses/currency`)
      .set('x-user-token', alice.token)
      .send({ currency: 'EUR' })
      .expect(400);

    await server.request
      .put(`/api/v1/crews/${crew.id}/expenses/currency`)
      .set('x-user-token', alice.token)
      .send({ currency: 'USD' })
      .expect(200);

    assert.equal((await plan(server, crew.id, bob.token)).currency, 'USD');
  });

  test('settling, undoing and planned rows move the stored ledger and plan', async () => {
    const { server, crew, alice, bob, charlie } = await crewOfThree();
    const ids = [alice.user.id, bob.user.id, charlie.user.id];
    const base = `/api/v1/crews/${crew.id}/expenses`;

    await server.request
      .post(base)
      .set('x-user-token', alice.token)
      .send({ description: 'Cabin', amount: 90, splitWith: ids })
      .expect(201);
    // A planned budget row must never reach the ledger.
    await server.request
      .post(base)
      .set('x-user-token', bob.token)
      .send({ description: 'Forecast', amount: 500, splitWith: ids, planned: true })
      .expect(201);

    const owed = await plan(server, crew.id, alice.token);
    assert.equal(sumCents(owed.balances), 0);
    assert.deepEqual(
      owed.settlements.map((s: any) => [s.fromUserId, s.toUserId, s.amountCents]).sort(),
      [
        [bob.user.id, alice.user.id, 3000],
        [charlie.user.id, alice.user.id, 3000],
      ].sort(),
    );

    const settled = await server.request
      .post(`${base}/settle`)
      .set('x-user-token', bob.token)
      .send({ toUserId: alice.user.id, amount: 30 })
      .expect(201);
    const afterSettle = await plan(server, crew.id, alice.token);
    assert.equal(sumCents(afterSettle.balances), 0);
    assert.deepEqual(
      afterSettle.settlements.map((s: any) => [s.fromUserId, s.toUserId, s.amountCents]),
      [[charlie.user.id, alice.user.id, 3000]],
    );

    await server.request.delete(`${base}/${settled.body.data.id}`).set('x-user-token', bob.token).expect(200);
    const afterUndo = await plan(server, crew.id, alice.token);
    assert.equal(afterUndo.settlements.length, 2);
    assert.equal(sumCents(afterUndo.balances), 0);
  });
});
