import 'dotenv/config';
/**
 * Integration tests: GET /api/v1/profiles/:festivalId shows other users' picks
 * only to crew mates on that festival (T48 owner decision, 2026-11-02), and
 * meta.pickCounts still counts every other attendee, with no user ids.
 *
 * Skip-gate on TEST_DATABASE_URL: the integration helpers exit the process
 * without it, so they load only inside the gated suite.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('GET /profiles/:festivalId crew-only picks', { skip, concurrency: 1 }, () => {
  let server: any;
  let alice: any;
  let bob: any;
  let carl: any;

  const pick = async (user: any, profile: any, picks: Record<string, string>, extra: Record<string, unknown> = {}) =>
    server.request.put(`/api/v1/profiles/${profile.id}`).set('x-user-token', user.token).send({ picks, ...extra }).expect(200);

  const list = async (user: any) =>
    (await server.request.get('/api/v1/profiles/fest-1').set('x-user-token', user.token).expect(200)).body;

  before(async () => {
    const { startServer, registerUser, joinFestivalProfile } = await import('./_integration-helpers');
    server = await startServer();
    alice = await registerUser(server, 'alice');
    bob = await registerUser(server, 'bob');
    carl = await registerUser(server, 'carl');
    const aliceProfile = await joinFestivalProfile(server, alice.token);
    const bobProfile = await joinFestivalProfile(server, bob.token);
    const carlProfile = await joinFestivalProfile(server, carl.token);

    const crew = (
      await server.request
        .post('/api/v1/crews')
        .set('x-user-token', alice.token)
        .send({ name: 'Alpha', festivalId: 'fest-1' })
        .expect(201)
    ).body.data;
    await server.request
      .post('/api/v1/crews/join')
      .set('x-user-token', bob.token)
      .send({ inviteCode: crew.inviteCode })
      .expect(200);

    await pick(alice, aliceProfile, { 'set-a': 'must' }, { notes: { 'set-a': 'front left' }, reminders: { 'set-a': 15 } });
    await pick(bob, bobProfile, { 'set-a': 'maybe', 'set-b': 'must' });
    await pick(carl, carlProfile, { 'set-a': 'want-to-see' });
  });

  after(async () => {
    await server?.close();
  });

  const byUser = (body: any, user: any) => body.data.find((p: any) => p.userId === user.user.id);

  test('a non-crew attendee gets no picks of others, only anonymous counts', async () => {
    const body = await list(carl);
    assert.equal(body.data.length, 3);
    assert.deepEqual(byUser(body, carl).picks, { 'set-a': 'want-to-see' });
    assert.deepEqual(byUser(body, alice).picks, {});
    assert.deepEqual(byUser(body, bob).picks, {});
    // Counts include everyone except the caller, crew or not.
    assert.deepEqual(body.meta.pickCounts, { 'set-a': 2, 'set-b': 1 });
    assert.ok(!JSON.stringify(body.meta).includes(alice.user.id));
  });

  test('a crew mate gets the crew mate picks but not an outsider picks', async () => {
    const body = await list(bob);
    assert.deepEqual(byUser(body, alice).picks, { 'set-a': 'must' });
    assert.deepEqual(byUser(body, carl).picks, {});
    assert.deepEqual(byUser(body, bob).picks, { 'set-a': 'maybe', 'set-b': 'must' });
    assert.deepEqual(body.meta.pickCounts, { 'set-a': 2 });
  });

  test('only the viewer gets notes and reminders', async () => {
    const own = byUser(await list(alice), alice);
    assert.deepEqual(own.notes, { 'set-a': 'front left' });
    assert.deepEqual(own.reminders, { 'set-a': 15 });
    const seenByBob = byUser(await list(bob), alice);
    assert.equal('notes' in seenByBob, false);
    assert.equal('reminders' in seenByBob, false);
  });

  test('the paginated form carries pickCounts beside pagination', async () => {
    const body = (
      await server.request.get('/api/v1/profiles/fest-1?limit=2').set('x-user-token', alice.token).expect(200)
    ).body;
    assert.equal(body.data.length, 2);
    assert.ok(body.meta.pagination);
    assert.deepEqual(body.meta.pickCounts, { 'set-a': 2, 'set-b': 1 });
  });
});
