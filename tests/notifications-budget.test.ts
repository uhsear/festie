/**
 * The push budget: at most PUSH_BUDGET_PER_HOUR pushes reach one user in a rolling
 * hour. A push over the cap is held: it writes an inbox row with status 'held' and
 * reaches no device. Exempt types are never held and never counted. Mocked stores.
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { PUSH_BUDGET_EXEMPT, PUSH_BUDGET_PER_HOUR, createSendService } from '../lib/notifications/send.js';

const config = { PUBLIC_ORIGIN: 'https://festie.us' };
const tokenFor = (uid: string) => uid.padEnd(64, 'x');

function makeLog() {
  return { info() {}, error() {}, debug() {}, warn: mock.fn((_msg: string, _meta?: any) => {}) };
}

function makeStores({ counts = {}, users = ['u1'], countRecentPushes }: any = {}) {
  return {
    notificationPrefs: { get: mock.fn(async () => null) },
    deviceTokens: {
      listByUser: mock.fn(async (uid: string) => (users.includes(uid) ? [{ token: tokenFor(uid), platform: 'android' }] : [])),
      unregister: mock.fn(async () => {}),
    },
    notificationCounts: { getByUser: mock.fn(async () => []), increment: mock.fn(async () => {}) },
    notificationLog: {
      insert: mock.fn(async (_row: any) => null),
      countRecentPushes:
        countRecentPushes ??
        mock.fn(async (ids: string[], _exempt: string[]) => new Map(ids.map((id) => [id, counts[id] ?? 0]))),
    },
    profiles: { userIdsByFestival: mock.fn(async () => users) },
  };
}

function build(stores: any, log = makeLog()) {
  const messaging = {
    send: mock.fn(async (_m: any) => 'fcm-id'),
    sendEach: mock.fn(async (batch: any[]) => ({ responses: batch.map(() => ({ success: true })) })),
  };
  return { svc: createSendService({ stores, config, log, messaging, retryQueue: { enqueue() {} } }), messaging, log };
}

const rows = (stores: any) => stores.notificationLog.insert.mock.calls.map((c: any) => c.arguments[0]);
const inboxRows = (stores: any) => rows(stores).filter((r: any) => r.platform === 'inbox');

const change = { userId: 'u1', type: 'crew_update', title: 'Crew update', body: 'New poll', data: { crewId: 'c1' } };

describe('push budget', () => {
  it('allows 6 pushes an hour', () => {
    assert.equal(PUSH_BUDGET_PER_HOUR, 6);
  });

  it('exempts SOS, set reminders, meeting points and set-time changes', () => {
    assert.deepEqual([...PUSH_BUDGET_EXEMPT].sort(), ['crew_meeting_point', 'crew_nudge', 'crew_sos', 'schedule_change', 'set_reminder']);
  });

  it('a user with 6 counted pushes gets a held inbox row and no transport call', async () => {
    const stores = makeStores({ counts: { u1: 6 } });
    const { svc, messaging } = build(stores);
    const result = await svc.send(change);
    assert.deepEqual(result, { sent: 0, reason: 'budget' });
    assert.deepEqual(
      rows(stores).map((r: any) => [r.platform, r.status]),
      [['inbox', 'held']],
    );
    assert.equal(messaging.send.mock.calls.length, 0);
    assert.deepEqual(stores.notificationLog.countRecentPushes.mock.calls[0]!.arguments, [
      ['u1'],
      [...PUSH_BUDGET_EXEMPT],
    ]);
  });

  it('a user with 5 counted pushes still gets the push', async () => {
    const stores = makeStores({ counts: { u1: 5 } });
    const { svc, messaging } = build(stores);
    const result = await svc.send(change);
    assert.equal(result.sent, 1);
    assert.equal(inboxRows(stores)[0].status, 'inbox');
    assert.equal(messaging.send.mock.calls.length, 1);
  });

  for (const type of ['crew_sos', 'set_reminder', 'crew_meeting_point', 'schedule_change', 'crew_nudge']) {
    it(`${type} reaches the device at the cap and is never counted`, async () => {
      const stores = makeStores({ counts: { u1: 20 } });
      const { svc, messaging } = build(stores);
      const result = await svc.send({ ...change, type });
      assert.equal(result.sent, 1);
      assert.equal(inboxRows(stores)[0].status, 'inbox');
      assert.equal(messaging.send.mock.calls.length, 1);
      assert.equal(stores.notificationLog.countRecentPushes.mock.calls.length, 0);
    });
  }

  it('sendToOfflineUsers counts once for the batch and holds only the user at the cap', async () => {
    const stores = makeStores({ users: ['u1', 'u2', 'u3'], counts: { u2: 6 } });
    const { svc, messaging } = build(stores);
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1',
      userIds: ['u1', 'u2', 'u3'],
      type: 'crew_update',
      title: 't',
      body: 'b',
    });
    assert.equal(result.sent, 2);
    assert.equal(stores.notificationLog.countRecentPushes.mock.calls.length, 1);
    assert.deepEqual(stores.notificationLog.countRecentPushes.mock.calls[0]!.arguments[0], ['u1', 'u2', 'u3']);
    assert.deepEqual(
      inboxRows(stores).map((r: any) => [r.userId, r.status]),
      [
        ['u1', 'inbox'],
        ['u2', 'held'],
        ['u3', 'inbox'],
      ],
    );
    const sentTo = messaging.sendEach.mock.calls[0]!.arguments[0].map((m: any) => m.token);
    assert.deepEqual(sentTo, [tokenFor('u1'), tokenFor('u3')]);
  });

  it('sendToOfflineUsers skips the count for an exempt type', async () => {
    const stores = makeStores({ counts: { u1: 20 } });
    const { svc } = build(stores);
    const result = await svc.sendToOfflineUsers({ festivalId: 'f1', userIds: ['u1'], type: 'set_reminder', title: 't', body: 'b' });
    assert.equal(result.sent, 1);
    assert.equal(stores.notificationLog.countRecentPushes.mock.calls.length, 0);
  });

  it('a failing count lets the push out and warns', async () => {
    const countRecentPushes = mock.fn(async () => {
      throw new Error('db down');
    });
    const stores = makeStores({ countRecentPushes });
    const { svc, messaging, log } = build(stores);
    const result = await svc.send(change);
    assert.equal(result.sent, 1);
    assert.equal(messaging.send.mock.calls.length, 1);
    assert.ok(log.warn.mock.calls.some((c: any) => c.arguments[0] === 'push budget count failed'));
  });

  it('stores without countRecentPushes behave as inbox-only', async () => {
    const stores: any = makeStores();
    delete stores.notificationLog.countRecentPushes;
    const { svc, messaging } = build(stores);
    const result = await svc.send(change);
    assert.equal(result.sent, 1);
    assert.equal(messaging.send.mock.calls.length, 1);
    assert.deepEqual(
      rows(stores).map((r: any) => [r.platform, r.status]),
      [
        ['inbox', 'inbox'],
        ['android', 'sent'],
      ],
    );
  });
});
