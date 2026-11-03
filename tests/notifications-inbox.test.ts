/**
 * The in-app notification inbox: send() and sendToOfflineUsers() write one
 * notification_log row with platform 'inbox' per user per notification.
 * Mocked stores; no database. The read side is in notifications-history.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { createSendService } from '../lib/notifications/send.js';

const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };
const config = { PUBLIC_ORIGIN: 'https://festie.us' };
const androidA = 'a'.repeat(64);
const androidB = 'b'.repeat(64);

/** A quiet-hours window around the current UTC hour, so the test never sits on its edge. */
function quietHoursNow() {
  const h = new Date().getUTCHours();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { dndStart: `${pad((h + 23) % 24)}:00`, dndEnd: `${pad((h + 1) % 24)}:59`, dndTimeZone: 'UTC' };
}

function makeStores({ prefs = {}, tokens = {}, unsubscribed = [], festivalUsers = [] }: any = {}) {
  return {
    notificationPrefs: { get: mock.fn(async (uid: string) => prefs[uid] ?? null) },
    deviceTokens: {
      listByUser: mock.fn(async (uid: string) => tokens[uid] ?? []),
      unregister: mock.fn(async () => {}),
    },
    notificationCounts: { getByUser: mock.fn(async () => []), increment: mock.fn(async () => {}) },
    notificationLog: { insert: mock.fn(async (_row: any) => null) },
    profiles: { userIdsByFestival: mock.fn(async () => festivalUsers) },
    topicSubscriptions: { getUnsubscribedUsers: mock.fn(async () => new Set(unsubscribed)) },
  };
}

function build(stores: any) {
  const messaging = {
    send: mock.fn(async (_m: any) => 'fcm-id'),
    sendEach: mock.fn(async (batch: any[]) => ({ responses: batch.map(() => ({ success: true })) })),
  };
  return createSendService({ stores, config, log: fakeLog, messaging, retryQueue: { enqueue() {} } });
}

const rows = (stores: any) => stores.notificationLog.insert.mock.calls.map((c: any) => c.arguments[0]);
const inboxRows = (stores: any) => rows(stores).filter((r: any) => r.platform === 'inbox');
const deviceRows = (stores: any) => rows(stores).filter((r: any) => r.platform !== 'inbox');

const update = {
  userId: 'u1',
  type: 'crew_update',
  title: 'Alex updated their picks',
  body: 'See what changed',
  data: { festivalId: 'f1', crewId: 'c1', deepLink: 'https://festie.us/crew' },
};

describe('notification inbox rows (mocked stores)', () => {
  it('a send() to a user with no device returns no_tokens and writes one inbox row', async () => {
    const stores = makeStores();
    const result = await build(stores).send(update);
    assert.equal(result.reason, 'no_tokens');
    const [row] = rows(stores);
    assert.equal(rows(stores).length, 1);
    assert.equal(row.platform, 'inbox');
    assert.equal(row.status, 'inbox');
    assert.equal(row.userId, 'u1');
    assert.equal(row.title, 'Alex updated their picks');
    assert.deepEqual(JSON.parse(row.dataJson), update.data);
  });

  it('a send() during quiet hours writes one held inbox row and no device row', async () => {
    const stores = makeStores({
      prefs: { u1: { crewUpdates: true, ...quietHoursNow() } },
      tokens: { u1: [{ token: androidA, platform: 'android' }] },
    });
    const result = await build(stores).send(update);
    assert.equal(result.reason, 'dnd_active');
    assert.deepEqual(
      inboxRows(stores).map((r: any) => r.status),
      ['held'],
    );
    assert.equal(deviceRows(stores).length, 0);
  });

  it('an SOS send() logs no coordinates in the inbox or device rows', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: androidA, platform: 'android' }] } });
    const data = { crewId: 'c1', userId: 'u9', deepLink: 'https://festie.us/crew?sos=u9', lat: '28.5', lng: '-81.4' };
    await build(stores).send({ userId: 'u1', type: 'crew_sos', title: 'Alex raised an SOS', body: 'Tap', data });
    assert.ok(rows(stores).length >= 2);
    for (const row of rows(stores)) {
      assert.deepEqual(JSON.parse(row.dataJson), { crewId: 'c1', userId: 'u9', deepLink: 'https://festie.us/crew?sos=u9' });
    }
  });

  it('a send() of a type the user turned off writes nothing', async () => {
    const stores = makeStores({
      prefs: { u1: { crewUpdates: false } },
      tokens: { u1: [{ token: androidA, platform: 'android' }] },
    });
    const result = await build(stores).send(update);
    assert.equal(result.reason, 'user_disabled');
    assert.equal(rows(stores).length, 0);
  });

  it('a crew_sos send() writes the inbox row even with every type off and quiet hours set', async () => {
    const allOff = {
      crewUpdates: false,
      scheduleChanges: false,
      setReminders: false,
      crewMeetingPoints: false,
      crewPolls: false,
      crewMoney: false,
      crewRides: false,
    };
    const stores = makeStores({
      prefs: { u1: { ...allOff, ...quietHoursNow() } },
      tokens: { u1: [{ token: androidA, platform: 'android' }] },
    });
    const result = await build(stores).send({ ...update, type: 'crew_sos', title: 'SOS from Alex' });
    assert.equal(result.sent, 1);
    assert.equal(inboxRows(stores).length, 1);
    assert.equal(inboxRows(stores)[0].type, 'crew_sos');
    assert.equal(inboxRows(stores)[0].status, 'inbox');
    assert.equal(deviceRows(stores).length, 1);
  });

  it('a send() to a user with two devices writes one inbox row and two device rows', async () => {
    const stores = makeStores({
      tokens: {
        u1: [
          { token: androidA, platform: 'android' },
          { token: androidB, platform: 'android' },
        ],
      },
    });
    const result = await build(stores).send(update);
    assert.equal(result.sent, 2);
    assert.equal(inboxRows(stores).length, 1);
    assert.deepEqual(
      deviceRows(stores).map((r: any) => [r.platform, r.status]),
      [
        ['android', 'sent'],
        ['android', 'sent'],
      ],
    );
  });

  it('sendToOfflineUsers() to three eligible users and one topic-unsubscribed user writes three inbox rows', async () => {
    const stores = makeStores({
      unsubscribed: ['u4'],
      tokens: { u1: [{ token: androidA, platform: 'android' }], u4: [{ token: androidB, platform: 'android' }] },
    });
    await build(stores).sendToOfflineUsers({
      festivalId: 'f1',
      userIds: ['u1', 'u2', 'u3', 'u4'],
      type: 'crew_update',
      title: 't',
      body: 'b',
      topic: 'crew',
    });
    assert.deepEqual(
      inboxRows(stores).map((r: any) => [r.userId, r.status]),
      [
        ['u1', 'inbox'],
        ['u2', 'inbox'],
        ['u3', 'inbox'],
      ],
    );
  });

  it('sendSilentSync() writes no inbox row', async () => {
    const stores = makeStores({ festivalUsers: ['u1'], tokens: { u1: [{ token: androidA, platform: 'android' }] } });
    await build(stores).sendSilentSync({ festivalId: 'f1', syncType: 'schedule' });
    assert.equal(rows(stores).length, 0);
  });

  it('a festival_announcement through sendToOfflineUsers() keeps festivalId, announcementId and deepLink', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: androidA, platform: 'android' }] } });
    const data = { festivalId: 'f1', announcementId: 'a1', deepLink: 'https://festie.us/' };
    await build(stores).sendToOfflineUsers({
      festivalId: 'f1',
      userIds: ['u1', 'u2'],
      type: 'festival_announcement',
      title: 'Gates open at 4',
      body: 'Bring water',
      data,
    });
    const inbox = inboxRows(stores);
    assert.deepEqual(
      inbox.map((r: any) => r.userId),
      ['u1', 'u2'],
    );
    for (const row of inbox) assert.deepEqual(JSON.parse(row.dataJson), data);
  });
});
