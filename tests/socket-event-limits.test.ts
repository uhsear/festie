/**
 * location:share and location:sync event limits. No database: the handlers are
 * built with a fake io, fake stores and the real consumeSocketRateLimit.
 */
import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';

import { createRateLimiters } from '../lib/rate-limiting.js';

const noop = () => {};
const SOCKET_JOIN_RATE_LIMIT = 12;
const SOCKET_LOCATION_SHARE_RATE_LIMIT = 5;
const SOCKET_LOCATION_SYNC_RATE_LIMIT = 7;

function buildDeps() {
  const config = {
    NODE_ENV: 'test',
    CLUSTER_SIZE: 1,
    MAX_RATE_LIMIT_ENTRIES: 10000,
    SOCKET_EVENT_WINDOW: 10_000,
    SOCKET_JOIN_RATE_LIMIT,
    SOCKET_LOCATION_SHARE_RATE_LIMIT,
    SOCKET_LOCATION_SYNC_RATE_LIMIT,
    LIVE_LOCATION_ENABLED: true,
    SOCKET_LEAVE_RATE_LIMIT: 100,
    USER_SESSION_COOKIE: 'session',
  };
  const state = {
    socketRateLimits: new Map(),
    metrics: { socketConnections: 0, peakConnections: 0, socketDisconnections: 0, socketErrors: 0 },
  };
  const { consumeSocketRateLimit } = createRateLimiters({ config, state, log: { warn: noop } });
  return {
    config,
    log: { info: noop, warn: noop, error: noop, debug: noop },
    state,
    io: {
      to: () => ({ emit: noop }),
      sockets: { adapter: { rooms: new Map() } },
      engine: { clientsCount: 1 },
      on: noop as any,
    },
    resolveSocketToken: () => 'session-tok',
    validateUserSession: mock.fn(async () => ({ userId: 'user-1', username: 'alice' })),
    stores: { crews: { getMember: mock.fn(async () => ({ role: 'member' })) } },
    disconnectSocket: noop,
    consumeSocketRateLimit,
    redis: null,
  };
}

async function connectSocket(deps: any) {
  const { default: setupSocketHandlers } = await import('../routes/socket.js');
  let onConnection: any;
  deps.io.on = (event: string, handler: any) => {
    if (event === 'connection') onConnection = handler;
  };
  setupSocketHandlers(deps);
  const handlers: Record<string, any> = {};
  const socket = {
    id: 'socket-1',
    data: { crewId: 'crew-1', userId: 'user-1' } as any,
    handshake: { headers: {} },
    on: (event: string, handler: any) => { handlers[event] = handler; },
    to: () => ({ emit: noop }),
    emit: noop,
  };
  onConnection(socket);
  return handlers;
}

function emit(handler: any, data: any) {
  return new Promise<any>((resolve) => { handler(data, resolve); });
}

describe('socket event limits', () => {
  test('the 8th location:sync in one window is refused before any store call', async () => {
    const deps = buildDeps();
    const handlers = await connectSocket(deps);
    for (let i = 0; i < SOCKET_LOCATION_SYNC_RATE_LIMIT; i++) {
      const ack = await emit(handlers['location:sync'], { crewId: 'crew-1' });
      assert.equal(ack.ok, true);
    }
    const lookups = deps.validateUserSession.mock.callCount();
    const members = deps.stores.crews.getMember.mock.callCount();

    const ack = await emit(handlers['location:sync'], { crewId: 'crew-1' });
    assert.deepEqual(ack, { ok: false, peers: [] });
    assert.equal(deps.validateUserSession.mock.callCount(), lookups);
    assert.equal(deps.stores.crews.getMember.mock.callCount(), members);
  });

  test('the 6th location:share in one window answers RATE_LIMITED before any store call', async () => {
    const deps = buildDeps();
    const handlers = await connectSocket(deps);
    for (let i = 0; i < SOCKET_LOCATION_SHARE_RATE_LIMIT; i++) {
      const ack = await emit(handlers['location:share'], { crewId: 'crew-1' });
      assert.equal(ack.ok, true);
    }
    const members = deps.stores.crews.getMember.mock.callCount();

    const ack = await emit(handlers['location:share'], { crewId: 'crew-1' });
    assert.deepEqual(ack, { ok: false, code: 'RATE_LIMITED' });
    assert.equal(deps.stores.crews.getMember.mock.callCount(), members);
  });

  test('location:share refuses an expired or over-long expiresAt', async () => {
    const deps = buildDeps();
    const handlers = await connectSocket(deps);
    const past = new Date(Date.now() - 1000).toISOString();
    const far = new Date(Date.now() + 13 * 3_600_000).toISOString();
    for (const expiresAt of [past, far]) {
      const ack = await emit(handlers['location:share'], { crewId: 'crew-1', expiresAt });
      assert.deepEqual(ack, { ok: false, code: 'INVALID_EXPIRY' });
    }
    const ok = await emit(handlers['location:share'], {
      crewId: 'crew-1',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    assert.equal(ok.ok, true);
  });

  test('a rejected sharing socket is removed from the per-user set', async () => {
    const deps: any = buildDeps();
    const zrem = mock.fn(async () => 1);
    deps.redis = {
      pipeline: () => {
        const p: any = { zremrangebyscore: () => p, zadd: () => p, pexpire: () => p, zcard: () => p };
        p.exec = async () => [[null, 0], [null, 1], [null, 4], [null, 1]];
        return p;
      },
      zrem,
      hset: async () => 1,
      hgetall: async () => ({}),
      expire: async () => 1,
      pexpire: async () => 1,
    };
    const handlers = await connectSocket(deps);
    const ack = await emit(handlers['location:share'], { crewId: 'crew-1' });
    assert.deepEqual(ack, { ok: false, code: 'TOO_MANY_SHARING_SOCKETS' });
    assert.equal(zrem.mock.callCount(), 1);
  });
});
