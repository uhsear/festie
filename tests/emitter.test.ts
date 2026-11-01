import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';

import { createSocketEmitter } from '../lib/emitter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIo() {
  const rooms: any = {};
  const globalEmits: any[] = [];
  return {
    _globalEmits: globalEmits,
    _rooms: rooms,
    to: mock.fn((room: any) => {
      if (!rooms[room]) rooms[room] = [];
      return {
        emit: mock.fn((...args: any[]) => rooms[room].push(args)),
      };
    }),
    emit: mock.fn((...args: any[]) => globalEmits.push(args)),
  };
}

function makeLog() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    debug: mock.fn(),
    error: mock.fn(),
  };
}

function defaultDeps(overrides: any = {}) {
  return {
    io: overrides.io || makeIo(),
    log: overrides.log || makeLog(),
    notificationService: overrides.notificationService || null,
    buildAvatarUrl: overrides.buildAvatarUrl || ((user: any) => user?.avatarKey ? `/avatar/${user.avatarKey}` : null),
    _getUserById: overrides._getUserById || (async () => null),
    stores: overrides.stores || null,
    config: overrides.config || { PUBLIC_ORIGIN: 'https://festie.example' },
  };
}

function crewStores(membersByCrew: Record<string, string[]>) {
  return {
    crews: {
      listByUserAndFestival: mock.fn(async () => Object.keys(membersByCrew).map((id) => ({ id }))),
      getMembersForCrews: mock.fn(
        async (ids: string[]) => new Map(ids.map((id) => [id, (membersByCrew[id] || []).map((userId) => ({ userId }))])),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitter: profileCreated', () => {
  it('emits profile:created to the festival room', () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.profileCreated({
      festivalId: 'fest-1',
      profile: { id: 'prof-1', name: 'Alice' },
      user: { avatarKey: 'abc' },
    });

    assert.equal(io.to.mock.callCount(), 1);
    assert.deepEqual(io.to.mock.calls[0]!.arguments, ['fest-1']);
    const emitted = io._rooms['fest-1'];
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], 'profile:created');
    assert.equal(emitted[0][1]._v, 1);
    assert.equal(emitted[0][1].profile.name, 'Alice');
  });
});

describe('emitter: profileUpdated', () => {
  it('batches updates and emits after debounce', async () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.profileUpdated({
      profile: { festivalId: 'fest-1', id: 'prof-1', name: 'Alice', picks: { s1: 'must' }, updatedAt: new Date().toISOString() },
      user: { avatarKey: 'abc' },
    });

    // Wait for batch debounce (200ms)
    await new Promise((r) => setTimeout(r, 300));

    const emitted = io._rooms['fest-1'];
    assert.ok(emitted, 'should have emitted to fest-1');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], 'profile:updated');
    assert.equal(emitted[0][1].profileId, 'prof-1');
    emitter.flushAll();
  });

  it('coalesces multiple rapid updates into one broadcast', async () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    for (let i = 0; i < 5; i++) {
      emitter.profileUpdated({
        profile: { festivalId: 'fest-1', id: 'prof-1', name: `Alice-${i}`, picks: {}, updatedAt: new Date().toISOString() },
        user: {},
      });
    }

    await new Promise((r) => setTimeout(r, 300));

    const emitted = io._rooms['fest-1'] || [];
    assert.equal(emitted.length, 1, 'should batch into one emission');
    // Last update wins
    assert.equal(emitted[0][1].name, 'Alice-4');
    emitter.flushAll();
  });

  it('digests crew pick pushes: one per crewmate, none for author or outsider', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const send = mock.fn(async (_a: any) => ({ sent: 1 }));
    const notificationService = { isConfigured: true, send };
    const stores = {
      crews: {
        listByUserAndFestival: mock.fn(async () => [{ id: 'c1' }, { id: 'c2' }]),
        getMembersForCrews: mock.fn(async () => new Map([
          ['c1', [{ userId: 'user-1' }, { userId: 'bob' }]],
          ['c2', [{ userId: 'user-1' }, { userId: 'bob' }, { userId: 'cara' }]],
        ])),
      },
      topicSubscriptions: { getUnsubscribedUsers: mock.fn(async () => ['cara']) },
    };
    const emitter = createSocketEmitter({ ...defaultDeps({ notificationService }), stores });
    stores.topicSubscriptions.getUnsubscribedUsers.mock.mockImplementation(async () => []);

    for (let i = 0; i < 10; i++) {
      emitter.profileUpdated({
        profile: { festivalId: 'fest-1', id: 'prof-1', name: `Alice${i}`, userId: 'user-1', picks: {} },
        user: {},
        changedFields: { picks: true },
      });
    }
    t.mock.timers.tick(4 * 60 * 1000);
    assert.equal(send.mock.callCount(), 0);
    t.mock.timers.tick(60 * 1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const calls = send.mock.calls.map((c: any) => c.arguments[0]);
    assert.deepEqual(calls.map((c: any) => c.userId).sort(), ['bob', 'cara']);
    assert.equal(calls[0].type, 'crew_update');
    assert.equal(calls[0].title, 'Crew update');
    assert.equal(calls[0].body, 'Alice9 updated their picks.');
    // Push links are absolute web URLs so one link opens on web and on mobile.
    assert.equal(calls[0].data.deepLink, 'https://festie.example/compare');
    assert.equal(calls[0].threadId, 'crew-fest-1');
    emitter.flushAll();
  });

  it('skips crewmates who muted the festival crew topic and sends nothing without crews', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const send = mock.fn(async (_a: any) => ({ sent: 1 }));
    let crews: any[] = [{ id: 'c1' }];
    const stores = {
      crews: {
        listByUserAndFestival: async () => crews,
        getMembersForCrews: async () => new Map([['c1', [{ userId: 'user-1' }, { userId: 'bob' }, { userId: 'cara' }]]]),
      },
      topicSubscriptions: { getUnsubscribedUsers: async () => ['cara'] },
    };
    const emitter = createSocketEmitter({ ...defaultDeps({ notificationService: { isConfigured: true, send } }), stores });
    const save = () => emitter.profileUpdated({
      profile: { festivalId: 'fest-1', id: 'prof-1', name: 'Alice', userId: 'user-1', picks: {} },
      user: {},
      changedFields: { picks: true },
    });
    save();
    t.mock.timers.tick(5 * 60 * 1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.deepEqual(send.mock.calls.map((c: any) => c.arguments[0].userId), ['bob']);

    crews = [];
    save();
    t.mock.timers.tick(5 * 60 * 1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(send.mock.callCount(), 1);
    emitter.flushAll();
  });

  it('sends the picks push only to crew-mates, with a compare link', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const io = makeIo();
    const send = mock.fn(async (_a: any) => ({ sent: 1 }));
    const notificationService = { isConfigured: true, send };
    const stores = crewStores({ c1: ['user-1', 'user-2'], c2: ['user-2', 'user-3'] });
    const emitter = createSocketEmitter(defaultDeps({ io, notificationService, stores }));

    emitter.profileUpdated({
      profile: { festivalId: 'fest-1', id: 'prof-1', name: 'Alice', userId: 'user-1', picks: {} },
      user: {},
      changedFields: { picks: true },
    });

    t.mock.timers.tick(5 * 60 * 1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const calls = send.mock.calls.map((c: any) => c.arguments[0]);
    assert.deepEqual(calls.map((c: any) => c.userId).sort(), ['user-2', 'user-3']);
    for (const call of calls) {
      assert.equal(call.type, 'crew_update');
      assert.equal(call.data.festivalId, 'fest-1');
      assert.equal(call.data.deepLink, 'https://festie.example/compare');
    }
    assert.deepEqual(stores.crews.listByUserAndFestival.mock.calls[0]!.arguments, ['user-1', 'fest-1']);
    emitter.flushAll();
  });

  it('sends no visible picks push when the user has no crew', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const io = makeIo();
    const send = mock.fn(async () => ({ sent: 1 }));
    const sendSilentSync = mock.fn(async () => {});
    const notificationService = { isConfigured: true, send, sendSilentSync };
    const emitter = createSocketEmitter(defaultDeps({ io, notificationService, stores: crewStores({}) }));

    emitter.profileUpdated({
      profile: { festivalId: 'fest-1', id: 'prof-1', name: 'Alice', userId: 'user-1', picks: {} },
      user: {},
      changedFields: { picks: true },
    });

    t.mock.timers.tick(5 * 60 * 1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(send.mock.callCount(), 0);
    assert.equal(sendSilentSync.mock.callCount(), 1, 'silent sync still runs');
    emitter.flushAll();
  });

  it('logs and never throws when the crew lookup fails', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const log = makeLog();
    const send = mock.fn(async () => ({ sent: 1 }));
    const stores = {
      crews: {
        listByUserAndFestival: mock.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    const emitter = createSocketEmitter(
      defaultDeps({ log, notificationService: { isConfigured: true, send }, stores }),
    );

    emitter.profileUpdated({
      profile: { festivalId: 'fest-1', id: 'prof-1', name: 'Alice', userId: 'user-1', picks: {} },
      user: {},
      changedFields: { picks: true },
    });

    t.mock.timers.tick(5 * 60 * 1000);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(send.mock.callCount(), 0);
    assert.equal(log.warn.mock.calls[0]!.arguments[0], 'crew push failed');
    emitter.flushAll();
  });

  it('does not trigger push when picks did not change', async () => {
    const io = makeIo();
    const sendToOfflineUsers = mock.fn(async () => {});
    const notificationService = { isConfigured: true, sendToOfflineUsers };
    const emitter = createSocketEmitter(defaultDeps({ io, notificationService }));

    emitter.profileUpdated({
      profile: { festivalId: 'fest-1', id: 'prof-1', name: 'Alice', userId: 'user-1' },
      user: {},
      changedFields: {},
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sendToOfflineUsers.mock.callCount(), 0);
    emitter.flushAll();
  });
});

describe('emitter: profileDeleted', () => {
  it('emits profile:deleted and cancels pending batch', async () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    // Queue an update (creates a pending batch)
    emitter.profileUpdated({
      profile: { festivalId: 'fest-1', id: 'prof-1', name: 'Alice', picks: {} },
      user: {},
    });

    // Immediately delete — should cancel the batch
    emitter.profileDeleted({ festivalId: 'fest-1', profileId: 'prof-1' });

    const emitted = io._rooms['fest-1'] || [];
    // Should have the delete event
    const deleteEvent = emitted.find((e: any) => e[0] === 'profile:deleted');
    assert.ok(deleteEvent, 'should emit profile:deleted');
    assert.equal(deleteEvent[1].profileId, 'prof-1');

    // Wait for debounce — batched update should NOT fire
    await new Promise((r) => setTimeout(r, 300));
    const updateEvents = (io._rooms['fest-1'] || []).filter((e: any) => e[0] === 'profile:updated');
    assert.equal(updateEvents.length, 0, 'batched update should have been cancelled');
    emitter.flushAll();
  });
});

describe('emitter: festivalCreated', () => {
  it('emits festival:created globally with event version', () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.festivalCreated({ id: 'fest-1', name: 'Coachella' });

    assert.equal(io.emit.mock.callCount(), 1);
    const args = io.emit.mock.calls[0]!.arguments;
    assert.equal(args[0], 'festival:created');
    assert.equal(args[1]._v, 1);
    assert.equal(args[1].id, 'fest-1');
    assert.equal(args[1].name, 'Coachella');
  });
});

describe('emitter: festivalUpdated', () => {
  it('emits festival:updated globally', () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.festivalUpdated({ festival: { id: 'fest-1', name: 'EDC' } });

    assert.equal(io.emit.mock.callCount(), 1);
    assert.equal(io._globalEmits[0][0], 'festival:updated');
    assert.equal(io._globalEmits[0][1].id, 'fest-1');
  });

  it('sends no visible push, only the silent sync', async () => {
    const sendToOfflineUsers = mock.fn(async () => {});
    const send = mock.fn(async () => {});
    const sendSilentSync = mock.fn(async () => {});
    const notificationService = { isConfigured: true, sendToOfflineUsers, send, sendSilentSync };
    const emitter = createSocketEmitter(defaultDeps({ notificationService }));

    emitter.festivalUpdated({ festival: { id: 'fest-1', name: 'EDC' } });

    await new Promise((r) => setTimeout(r, 10));
    assert.equal(sendToOfflineUsers.mock.callCount(), 0);
    assert.equal(send.mock.callCount(), 0);
    assert.equal(sendSilentSync.mock.callCount(), 1);
  });
});

describe('emitter: scheduleChanged', () => {
  const slot = (startTime: string) => ({ dayLabel: 'Sat', startTime, endTime: null, stageName: 'Sahara' });
  const festival = { id: 'fest-1', name: 'EDC' };

  it('skips topic-muted users and links one moved set to /set/{id}', async () => {
    const send = mock.fn(async (_args: any) => ({ sent: 1 }));
    const getUnsubscribedUsers = mock.fn(async () => new Set(['u2']));
    const emitter = createSocketEmitter(
      defaultDeps({
        notificationService: { isConfigured: true, send },
        stores: { topicSubscriptions: { getUnsubscribedUsers } },
      }),
    );

    await emitter.scheduleChanged({
      festival,
      changes: [{ kind: 'moved', setId: 'set-1', artist: 'Peggy Gou', before: slot('22:00'), after: slot('23:30') }],
      pickersBySet: new Map([['set-1', ['u1', 'u2']]]),
    });

    assert.deepEqual(getUnsubscribedUsers.mock.calls[0]!.arguments, ['fest-1', 'schedule']);
    assert.equal(send.mock.callCount(), 1);
    const call = send.mock.calls[0]!.arguments[0];
    assert.equal(call.userId, 'u1');
    assert.equal(call.type, 'schedule_change');
    assert.equal(call.title, 'Peggy Gou moved');
    assert.equal(call.threadId, 'schedule-fest-1');
    assert.deepEqual(call.data, {
      festivalId: 'fest-1',
      setId: 'set-1',
      deepLink: 'https://festie.example/set/set-1',
    });
  });

  it('links a removal to /picks', async () => {
    const send = mock.fn(async (_args: any) => ({ sent: 1 }));
    const emitter = createSocketEmitter(defaultDeps({ notificationService: { isConfigured: true, send } }));

    await emitter.scheduleChanged({
      festival,
      changes: [{ kind: 'removed', setId: 'set-1', artist: 'Peggy Gou' }],
      pickersBySet: new Map([['set-1', ['u1']]]),
    });

    assert.equal(send.mock.calls[0]!.arguments[0].data.deepLink, 'https://festie.example/picks');
    assert.equal(send.mock.calls[0]!.arguments[0].data.setId, undefined);
  });

  it('logs a failed send and keeps sending the rest', async () => {
    const log = makeLog();
    const send = mock.fn(async (args: any) => {
      if (args.userId === 'u1') throw new Error('fcm down');
      return { sent: 1 };
    });
    const emitter = createSocketEmitter(defaultDeps({ log, notificationService: { isConfigured: true, send } }));

    await emitter.scheduleChanged({
      festival,
      changes: [{ kind: 'removed', setId: 'set-1', artist: 'A' }],
      pickersBySet: new Map([['set-1', ['u1', 'u2']]]),
    });

    assert.equal(send.mock.callCount(), 2);
    assert.equal(log.warn.mock.callCount(), 1);
  });
});

describe('emitter: festivalDeleted', () => {
  it('emits festival:deleted globally', () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.festivalDeleted({ id: 'fest-1' });

    assert.equal(io.emit.mock.callCount(), 1);
    assert.equal(io._globalEmits[0][0], 'festival:deleted');
    assert.equal(io._globalEmits[0][1].id, 'fest-1');
  });
});

describe('emitter: presenceUpdate', () => {
  it('emits presence:update to the festival room', () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.presenceUpdate({ festivalId: 'fest-1', online: [{ userId: 'u1' }] });

    assert.equal(io.to.mock.callCount(), 1);
    const emitted = io._rooms['fest-1'];
    assert.equal(emitted[0][0], 'presence:update');
    assert.deepEqual(emitted[0][1].online, [{ userId: 'u1' }]);
  });
});

describe('emitter: flushAll', () => {
  it('flushes all pending batched profile updates', async () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    // Queue two profile updates for different profiles
    emitter.profileUpdated({
      profile: { festivalId: 'fest-1', id: 'prof-1', name: 'Alice', picks: {} },
      user: {},
    });
    emitter.profileUpdated({
      profile: { festivalId: 'fest-2', id: 'prof-2', name: 'Bob', picks: {} },
      user: {},
    });

    // Flush immediately (before debounce)
    emitter.flushAll();

    const fest1 = io._rooms['fest-1'] || [];
    const fest2 = io._rooms['fest-2'] || [];
    assert.equal(fest1.length, 1, 'fest-1 should have been flushed');
    assert.equal(fest2.length, 1, 'fest-2 should have been flushed');
  });
});

describe('emitter: crew events', () => {
  it('emits crew:expense-added to the crew room', () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.crewExpenseAdded({ crewId: 'crew-1', expense: { amount: 50 } });

    assert.equal(io.to.mock.callCount(), 1);
    assert.deepEqual(io.to.mock.calls[0]!.arguments, ['crew:crew-1']);
  });

  it('emits crew:expense-deleted to the crew room', () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.crewExpenseDeleted({ crewId: 'crew-1', expenseId: 'exp-1' });

    const emitted = io._rooms['crew:crew-1'];
    assert.ok(emitted);
    assert.equal(emitted[0][0], 'crew:expense-deleted');
    assert.equal(emitted[0][1].expenseId, 'exp-1');
  });

  it('emits crew:activity to the crew room', () => {
    const io = makeIo();
    const emitter = createSocketEmitter(defaultDeps({ io }));

    emitter.crewActivityLogged({ crewId: 'crew-1', item: { action: 'joined' } });

    const emitted = io._rooms['crew:crew-1'];
    assert.ok(emitted);
    assert.equal(emitted[0][0], 'crew:activity');
    assert.deepEqual(emitted[0][1].item, { action: 'joined' });
  });
});

describe('emitter: EVENT_VERSION', () => {
  it('is exposed as a property on the emitter', () => {
    const emitter = createSocketEmitter(defaultDeps());
    assert.equal(emitter.EVENT_VERSION, 1);
    emitter.flushAll();
  });
});
