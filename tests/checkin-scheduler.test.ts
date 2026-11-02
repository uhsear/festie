/**
 * Unit tests for the check-in timer scheduler (lib/checkin.ts): warn pushes,
 * missed-timer SOS raises, and the ZREM claim that makes each timer fire once
 * across PM2 workers. In-memory Redis; no database required.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';

import { createCheckinScheduler, startCheckin } from '../lib/checkin.js';
import { makeFakeRedis } from './_fake-redis.js';

const NOW = Date.parse('2026-07-11T22:00:00.000Z');
const POSITION = { lat: 41.8843, lng: -87.6324, accuracy: 12, capturedAt: '2026-07-11T21:59:00.000Z' };

function makeScheduler(redis: any, over: any = {}) {
  const raiser = { raise: over.raise || mock.fn(async () => ({ activityId: 'a-1', raisedAt: '' })) };
  const notificationService = { send: mock.fn(async () => ({ ok: true })) };
  const stores = { crews: { getMember: over.getMember || mock.fn(async () => ({ userId: 'user-1' })) } };
  const log = { info() {}, warn: mock.fn(() => {}), error() {}, debug() {} };
  const scheduler = createCheckinScheduler({
    redis,
    stores,
    raiser,
    notificationService,
    log,
    config: { PUBLIC_ORIGIN: 'https://festie.us' },
  });
  return { scheduler, raiser, notificationService, log };
}

async function start(redis: any, userId = 'user-1', position: any = POSITION) {
  await startCheckin(redis, {
    crewId: 'crew-1',
    userId,
    username: userId === 'user-1' ? 'maya' : 'sam',
    minutes: 10,
    position,
    now: NOW,
  });
}

describe('lib/checkin — scheduler tick', () => {
  test('a warn member past due sends one crew_sos push; a second tick sends nothing', async () => {
    const redis = makeFakeRedis();
    await start(redis);
    const { scheduler, notificationService, raiser } = makeScheduler(redis);

    await scheduler.tick(NOW + 4 * 60_000);
    assert.equal(notificationService.send.mock.calls.length, 0);

    await scheduler.tick(NOW + 5 * 60_000);
    await scheduler.tick(NOW + 6 * 60_000);

    assert.equal(notificationService.send.mock.calls.length, 1);
    const push = (notificationService.send.mock.calls as any[])[0].arguments[0];
    assert.equal(push.userId, 'user-1');
    assert.equal(push.type, 'crew_sos');
    assert.equal(push.title, 'Check in with your crew');
    assert.equal(push.body, "Your check-in timer ends in 5 min. Open Festie and tap I'm OK.");
    assert.equal(push.data.crewId, 'crew-1');
    assert.equal(push.data.deepLink, 'https://festie.us/crew?tab=find');
    assert.equal(push.threadId, 'checkin-crew-1');
    assert.equal(raiser.raise.mock.calls.length, 0);
  });

  test('a due member raises once with the message and the stored position', async () => {
    const redis = makeFakeRedis();
    await start(redis);
    const { scheduler, raiser } = makeScheduler(redis);

    await scheduler.tick(NOW + 10 * 60_000);
    await scheduler.tick(NOW + 11 * 60_000);

    assert.equal(raiser.raise.mock.calls.length, 1);
    assert.deepEqual((raiser.raise.mock.calls as any[])[0].arguments[0], {
      crewId: 'crew-1',
      userId: 'user-1',
      username: 'maya',
      message: 'Missed a check-in timer.',
      position: POSITION,
    });
    assert.equal(redis.strings.has('checkin:crew-1:user-1'), false);
  });

  test('a fresher cached live position wins over the stored one, coarsened', async () => {
    const redis = makeFakeRedis();
    await start(redis);
    const dueAt = NOW + 10 * 60_000;
    await redis.hset(
      'loc:pos:crew-1',
      'user-1',
      JSON.stringify({
        crewId: 'crew-1',
        userId: 'user-1',
        lat: 41.123456,
        lng: -87.654321,
        accuracy: 5,
        capturedAt: new Date(dueAt - 10_000).toISOString(),
        serverAt: new Date(dueAt - 10_000).toISOString(),
      }),
    );
    const { scheduler, raiser } = makeScheduler(redis);

    await scheduler.tick(dueAt);

    const { position } = (raiser.raise.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(position, {
      lat: 41.1235,
      lng: -87.6543,
      accuracy: 5,
      capturedAt: new Date(dueAt - 10_000).toISOString(),
    });
  });

  test('a due member whose key was deleted (I am OK) raises nothing', async () => {
    const redis = makeFakeRedis();
    await start(redis);
    await redis.del('checkin:crew-1:user-1');
    const { scheduler, raiser } = makeScheduler(redis);

    await scheduler.tick(NOW + 10 * 60_000);

    assert.equal(raiser.raise.mock.calls.length, 0);
  });

  test('a user who left the crew raises nothing', async () => {
    const redis = makeFakeRedis();
    await start(redis);
    const { scheduler, raiser } = makeScheduler(redis, { getMember: mock.fn(async () => null) });

    await scheduler.tick(NOW + 10 * 60_000);

    assert.equal(raiser.raise.mock.calls.length, 0);
  });

  test('two schedulers sharing one Redis raise once in total', async () => {
    const redis = makeFakeRedis();
    await start(redis);
    const a = makeScheduler(redis);
    const b = makeScheduler(redis);

    await Promise.all([a.scheduler.tick(NOW + 10 * 60_000), b.scheduler.tick(NOW + 10 * 60_000)]);

    assert.equal(a.raiser.raise.mock.calls.length + b.raiser.raise.mock.calls.length, 1);
    assert.equal(a.notificationService.send.mock.calls.length + b.notificationService.send.mock.calls.length, 1);
  });

  test('a raise that throws does not stop the next member', async () => {
    const redis = makeFakeRedis();
    await start(redis, 'user-1');
    await start(redis, 'user-2');
    let calls = 0;
    const raise = mock.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { activityId: 'a-2', raisedAt: '' };
    });
    const { scheduler, log } = makeScheduler(redis, { raise });

    await scheduler.tick(NOW + 10 * 60_000);

    assert.equal(raise.mock.calls.length, 2);
    assert.equal(log.warn.mock.calls.length, 1);
  });

  test('a membership lookup that throws keeps the timer and retries on the next tick', async () => {
    const redis = makeFakeRedis();
    await start(redis);
    let calls = 0;
    const getMember = mock.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('db blip');
      return { userId: 'user-1' };
    });
    const { scheduler, raiser, log } = makeScheduler(redis, { getMember });
    const dueAt = NOW + 10 * 60_000;

    await scheduler.tick(dueAt);
    assert.equal(raiser.raise.mock.calls.length, 0);
    assert.equal(log.warn.mock.calls.length, 1);
    assert.ok(redis.strings.has('checkin:crew-1:user-1'));
    assert.equal(redis.zsets.get('checkin:due').get('crew-1|user-1'), dueAt + 15_000);

    await scheduler.tick(dueAt + 15_000);
    assert.equal(raiser.raise.mock.calls.length, 1);
    assert.equal(redis.strings.has('checkin:crew-1:user-1'), false);
  });

  test('a timer restarted after the due read is put back, not fired early', async () => {
    const redis = makeFakeRedis();
    await start(redis);
    // The restart rewrote the key, but this worker still holds the old due score.
    const later = NOW + 40 * 60_000;
    const stored = JSON.parse(redis.strings.get('checkin:crew-1:user-1'));
    redis.strings.set('checkin:crew-1:user-1', JSON.stringify({ ...stored, minutes: 40, dueAt: later }));
    const { scheduler, raiser, notificationService } = makeScheduler(redis);

    await scheduler.tick(NOW + 10 * 60_000);

    assert.equal(raiser.raise.mock.calls.length, 0);
    assert.equal(notificationService.send.mock.calls.length, 0);
    assert.equal(redis.zsets.get('checkin:due').get('crew-1|user-1'), later);
    assert.equal(redis.zsets.get('checkin:warn').get('crew-1|user-1'), later - 5 * 60_000);
    assert.ok(redis.strings.has('checkin:crew-1:user-1'));
  });

  test('with no Redis, tick returns at once', async () => {
    const { scheduler, raiser } = makeScheduler(null);
    await scheduler.tick(NOW);
    assert.equal(raiser.raise.mock.calls.length, 0);
  });
});
