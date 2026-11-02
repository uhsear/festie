/**
 * Unit tests for lib/announcements.ts — delivery of festival announcements.
 * No database: every store is a mock.fn() stub. The SQL lives in
 * tests/integration-announcements-store.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';

import { announcementDeepLink, createAnnouncer } from '../lib/announcements.js';

const noop = () => {};
const config = { PUBLIC_ORIGIN: 'https://festie.us' };

function row(over: any = {}) {
  return { id: 'ann-1', festivalId: 'fest 1', title: 'Gates open', body: 'Doors at 4', screen: 'map', ...over };
}

function makeAnnouncer(over: any = {}) {
  const calls: string[] = [];
  const stores = {
    announcements: {
      expireLate: mock.fn(async () => {
        calls.push('expireLate');
        return over.expired ?? 0;
      }),
      claimDue: mock.fn(async () => {
        calls.push('claimDue');
        return over.rows ?? [row()];
      }),
      setRecipientCount: mock.fn(async () => {}),
    },
    festivals: {
      getById: mock.fn(async () => ('festival' in over ? over.festival : { id: 'fest 1', publishedAt: '2026-10-01' })),
    },
    profiles: { userIdsByFestival: mock.fn(async () => over.audience ?? ['u1', 'u2']) },
  };
  const notificationService = {
    isConfigured: over.isConfigured ?? true,
    sendToOfflineUsers: over.sendToOfflineUsers ?? mock.fn(async () => ({ sent: 1 })),
  };
  const log = { info: noop, debug: noop, error: noop, warn: mock.fn(noop) };
  const announcer = createAnnouncer({ stores, notificationService, config, log });
  const counts = () => stores.announcements.setRecipientCount.mock.calls.map((c: any) => c.arguments);
  return { announcer, stores, notificationService, log, calls, counts };
}

describe('announcementDeepLink', () => {
  const cases: [string, string][] = [
    ['home', 'https://festie.us/?festival=fest%201'],
    ['map', 'https://festie.us/map'],
    ['timeline', 'https://festie.us/timeline'],
    ['picks', 'https://festie.us/picks'],
    ['festival-mode', 'https://festie.us/festival-mode'],
    ['crew', 'https://festie.us/crew'],
  ];
  for (const [screen, link] of cases) {
    test(screen, () => {
      assert.equal(announcementDeepLink(config, { festivalId: 'fest 1', screen }), link);
    });
  }
});

describe('createAnnouncer — deliverDue', () => {
  test('pushes to the audience with the announcement data and schedule topic', async () => {
    const { announcer, notificationService, counts } = makeAnnouncer();
    assert.equal(await announcer.deliverDue(), 1);
    const sends = (notificationService.sendToOfflineUsers as any).mock.calls;
    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0].arguments[0], {
      festivalId: 'fest 1',
      type: 'festival_announcement',
      title: 'Gates open',
      body: 'Doors at 4',
      data: { festivalId: 'fest 1', announcementId: 'ann-1', deepLink: 'https://festie.us/map' },
      userIds: ['u1', 'u2'],
      topic: 'schedule',
      threadId: 'announce-fest 1',
    });
    assert.deepEqual(counts(), [['ann-1', 2]]);
  });

  test('450 joined users go out in chunks of 200, 200 and 50, and the count is 450', async () => {
    const audience = Array.from({ length: 450 }, (_, i) => `u${i}`);
    const { announcer, notificationService, counts } = makeAnnouncer({ audience });
    await announcer.deliverDue();
    const sizes = (notificationService.sendToOfflineUsers as any).mock.calls.map(
      (c: any) => c.arguments[0].userIds.length,
    );
    assert.deepEqual(sizes, [200, 200, 50]);
    const sent = (notificationService.sendToOfflineUsers as any).mock.calls.flatMap((c: any) => c.arguments[0].userIds);
    assert.deepEqual(sent, audience);
    assert.deepEqual(counts(), [['ann-1', 450]]);
  });

  test('expires late rows before claiming, and warns with the count', async () => {
    const { announcer, calls, log } = makeAnnouncer({ expired: 2, rows: [] });
    assert.equal(await announcer.deliverDue(), 0);
    assert.deepEqual(calls, ['expireLate', 'claimDue']);
    const warn = (log.warn as any).mock.calls[0].arguments;
    assert.match(warn[0], /30 minutes late/);
    assert.deepEqual(warn[1], { count: 2 });
  });

  test('no warn when nothing expired', async () => {
    const { announcer, log } = makeAnnouncer({ rows: [] });
    await announcer.deliverDue();
    assert.equal((log.warn as any).mock.callCount(), 0);
  });

  for (const [name, festival] of [
    ['missing or deleted', null],
    ['draft', { id: 'fest 1', publishedAt: null }],
  ] as const) {
    test(`${name} festival: no push and recipient count 0`, async () => {
      const { announcer, notificationService, stores, counts } = makeAnnouncer({ festival });
      assert.equal(await announcer.deliverDue(), 1);
      assert.equal((notificationService.sendToOfflineUsers as any).mock.callCount(), 0);
      assert.equal(stores.profiles.userIdsByFestival.mock.callCount(), 0);
      assert.deepEqual(counts(), [['ann-1', 0]]);
    });
  }

  test('push not configured: still records the audience count', async () => {
    const { announcer, notificationService, counts } = makeAnnouncer({ isConfigured: false, audience: ['a', 'b', 'c'] });
    await announcer.deliverDue();
    assert.equal((notificationService.sendToOfflineUsers as any).mock.callCount(), 0);
    assert.deepEqual(counts(), [['ann-1', 3]]);
  });

  test('a failing row is logged and the next row still goes out', async () => {
    let n = 0;
    const sendToOfflineUsers = mock.fn(async () => {
      if (n++ === 0) throw new Error('fcm down');
      return { sent: 1 };
    });
    const rows = [row({ id: 'a1' }), row({ id: 'a2' })];
    const { announcer, log, counts } = makeAnnouncer({ rows, sendToOfflineUsers });
    assert.equal(await announcer.deliverDue(), 2);
    assert.deepEqual(counts(), [['a2', 2]]);
    assert.equal((log.warn as any).mock.calls[0].arguments[1].announcementId, 'a1');
  });

  test('never throws when the store fails', async () => {
    const { announcer, stores, log } = makeAnnouncer();
    stores.announcements.expireLate.mock.mockImplementation(async () => {
      throw new Error('db down');
    });
    stores.announcements.claimDue.mock.mockImplementation(async () => {
      throw new Error('db down');
    });
    assert.equal(await announcer.deliverDue(), 0);
    assert.equal((log.warn as any).mock.callCount(), 2);
  });
});
