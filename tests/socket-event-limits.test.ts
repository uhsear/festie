/**
 * location:share and location:sync event limits. No database: the handlers are
 * built with a fake io, fake stores and the real consumeSocketRateLimit.
 */
import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';

import { createRateLimiters } from '../lib/rate-limiting.js';

const noop = () => {};
const SOCKET_JOIN_RATE_LIMIT = 12;

function buildDeps() {
  const config = {
    NODE_ENV: 'test',
    CLUSTER_SIZE: 1,
    MAX_RATE_LIMIT_ENTRIES: 10000,
    SOCKET_EVENT_WINDOW: 10_000,
    SOCKET_JOIN_RATE_LIMIT,
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
  test('the 13th location:sync in one window is refused before any store call', async () => {
    const deps = buildDeps();
    const handlers = await connectSocket(deps);
    for (let i = 0; i < SOCKET_JOIN_RATE_LIMIT; i++) {
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

  test('the 13th location:share in one window answers RATE_LIMITED before any store call', async () => {
    const deps = buildDeps();
    const handlers = await connectSocket(deps);
    for (let i = 0; i < SOCKET_JOIN_RATE_LIMIT; i++) {
      const ack = await emit(handlers['location:share'], { crewId: 'crew-1' });
      assert.equal(ack.ok, true);
    }
    const members = deps.stores.crews.getMember.mock.callCount();

    const ack = await emit(handlers['location:share'], { crewId: 'crew-1' });
    assert.deepEqual(ack, { ok: false, code: 'RATE_LIMITED' });
    assert.equal(deps.stores.crews.getMember.mock.callCount(), members);
  });
});
