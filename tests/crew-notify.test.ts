/**
 * Unit tests for lib/notifications/crew-notify.ts. No database: fake stores,
 * a fake notificationService.send, and node:test mock timers.
 */

import assert from 'node:assert/strict';
import { describe, test, mock, afterEach } from 'node:test';

import { createCrewNotifier } from '../lib/notifications/crew-notify.js';

const noop = () => {};
const MEMBERS = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }];

function make(over: any = {}) {
  const send = over.send ?? mock.fn(async () => ({ sent: 1 }));
  const notificationService = { isConfigured: over.configured ?? true, send };
  const stores = {
    crews: {
      getById: mock.fn(async () => ({ id: 'crew1', name: 'Desert Rats' })),
      getMembers: mock.fn(async () => MEMBERS),
    },
    notificationPrefs: { get: mock.fn(async (id: string) => over.prefs?.[id] ?? null) },
    pool: { query: mock.fn(async () => ({ rows: [{ time_zone: over.zone ?? 'America/New_York' }] })) },
  };
  const warn = mock.fn(noop);
  const notifier = createCrewNotifier({ stores, notificationService, log: { warn } });
  const sent = () => (send.mock.calls as any[]).map((c) => c.arguments[0]);
  return { notifier, sent, warn };
}

const tick = async (ms: number) => {
  mock.timers.tick(ms);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
};

describe('crew notifier', () => {
  afterEach(() => mock.timers.reset());

  test('groups two items into one push per member', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { notifier, sent } = make();
    notifier.queue({ crewId: 'crew1', actorId: 'z', kind: 'member', text: 'Sam joined' });
    notifier.queue({ crewId: 'crew1', actorId: 'z', kind: 'poll', text: 'New poll: Dinner?' });
    await tick(180_000);
    const s = sent();
    assert.equal(s.length, 3);
    assert.equal(s[0].body, 'Sam joined · New poll: Dinner?');
    assert.equal(s[0].title, 'Desert Rats');
    assert.equal(s[0].type, 'crew_update');
    assert.equal(s[0].threadId, 'crew-crew1');
    assert.deepEqual(s[0].data, { crewId: 'crew1', deepLink: 'rave://crew/crew1' });
  });

  test('actor gets nothing for own item but still gets the others', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { notifier, sent } = make();
    notifier.queue({ crewId: 'crew1', actorId: 'a', kind: 'poll', text: 'New poll: X' });
    notifier.queue({ crewId: 'crew1', actorId: 'b', kind: 'member', text: 'Bo joined' });
    await tick(180_000);
    const byUser = Object.fromEntries(sent().map((m) => [m.userId, m.body]));
    assert.equal(byUser.a, 'Bo joined');
    assert.equal(byUser.b, 'New poll: X');
    assert.equal(byUser.c, 'New poll: X · Bo joined');
  });

  test('three items give +1 more', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { notifier, sent } = make();
    for (const t of ['one', 'two', 'three']) notifier.queue({ crewId: 'crew1', actorId: null, kind: 'poll', text: t });
    await tick(180_000);
    assert.equal(sent()[0].body, 'one · two · +1 more');
  });

  test('second batch waits for the minimum gap', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { notifier, sent } = make();
    notifier.queue({ crewId: 'crew1', actorId: null, kind: 'poll', text: 'first' });
    await tick(180_000);
    assert.equal(sent().length, 3);
    notifier.queue({ crewId: 'crew1', actorId: null, kind: 'poll', text: 'second' });
    await tick(180_000);
    assert.equal(sent().length, 3, 'still inside the 5 minute gap');
    await tick(120_000);
    assert.equal(sent().length, 6);
  });

  test('crewUpdates off drops member items for that member', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { notifier, sent } = make({ prefs: { b: { crewUpdates: 0 } } });
    notifier.queue({ crewId: 'crew1', actorId: 'z', kind: 'member', text: 'Sam joined' });
    await tick(180_000);
    assert.deepEqual(sent().map((m) => m.userId).sort(), ['a', 'c']);
  });

  test('now() skips the same key within 2 minutes and formats the time', async () => {
    mock.timers.enable({ apis: ['Date'] });
    const { notifier, sent } = make();
    const item = {
      crewId: 'crew1',
      actorId: 'a',
      kind: 'meeting-point' as const,
      key: 'mp:1',
      text: 'Maya set a meeting point: Ferris wheel',
      meetAt: '2026-07-04T01:00:00.000Z',
    };
    await notifier.now(item);
    await notifier.now(item);
    const s = sent();
    assert.equal(s.length, 2);
    assert.equal(s[0].body, 'Maya set a meeting point: Ferris wheel at 9:00 PM');
    assert.equal(s[0].threadId, 'crew-mp-crew1');
    mock.timers.tick(121_000);
    await notifier.now(item);
    assert.equal(sent().length, 4);
  });

  test('now() with a bad zone drops the time', async () => {
    const { notifier, sent } = make({ zone: 'Not/AZone' });
    await notifier.now({
      crewId: 'crew1',
      actorId: 'a',
      kind: 'meeting-point',
      key: 'mp:2',
      text: 'Maya set a meeting point: Gate',
      meetAt: '2026-07-04T01:00:00.000Z',
    });
    assert.equal(sent()[0].body, 'Maya set a meeting point: Gate');
  });

  test('toUsers() uses the given crew name', async () => {
    const { notifier, sent } = make();
    await notifier.toUsers({
      crewId: 'crew1',
      crewName: 'Gone',
      userIds: ['b'],
      kind: 'member',
      text: 'You were removed from Gone.',
    });
    assert.equal(sent()[0].title, 'Gone');
    assert.equal(sent()[0].userId, 'b');
  });

  test('flushAll() sends the pending batch and clears timers', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { notifier, sent } = make();
    notifier.queue({ crewId: 'crew1', actorId: null, kind: 'poll', text: 'p' });
    await notifier.flushAll();
    assert.equal(sent().length, 3);
    await tick(600_000);
    assert.equal(sent().length, 3, 'timer was cleared, nothing sends twice');
  });

  test('a failing send does not stop the others', async () => {
    const send = mock.fn(async (m: any) => {
      if (m.userId === 'a') throw new Error('boom');
      return { sent: 1 };
    });
    const { notifier, warn } = make({ send });
    await notifier.toUsers({ crewId: 'crew1', userIds: ['a', 'b', 'c'], kind: 'poll', text: 't' });
    assert.equal(send.mock.callCount(), 3);
    assert.equal(warn.mock.callCount(), 1);
  });

  test('does nothing when notifications are not configured', async () => {
    const { notifier, sent } = make({ configured: false });
    notifier.queue({ crewId: 'crew1', actorId: null, kind: 'poll', text: 'p' });
    await notifier.toUsers({ crewId: 'crew1', userIds: ['a'], kind: 'poll', text: 't' });
    await notifier.flushAll();
    assert.equal(sent().length, 0);
  });
});
