import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundTasks } from '../lib/shutdown.js';

// The daily retention job calls retention_cleanup() (migration 060), and a failure is logged, not thrown.
describe('retention_cleanup job', () => {
  let ctx: any;

  afterEach(() => {
    for (const t of ctx?.state.timers ?? []) clearInterval(t);
    mock.timers.reset();
  });

  function makeCtx(query: (sql: string) => Promise<any>) {
    return {
      config: { SESSION_TTL: 86400000, AUDIT_LOG_RETENTION_DAYS: 90 },
      state: {
        timers: [],
        rateLimits: new Map(),
        routeRateLimits: new Map(),
        authRateLimits: new Map(),
        socketRateLimits: new Map(),
        onlineUsers: new Map(),
      },
      stores: {
        sessions: { deleteExpiredUserSessions: mock.fn(async () => {}) },
        pool: { query: mock.fn(query) },
        auditLog: { cleanup: mock.fn(async () => 0) },
        crews: { meetingPoints: { expireStale: mock.fn(async () => ({ rowCount: 0 })) } },
      },
      log: { info: mock.fn(), warn: mock.fn(), error: mock.fn(), debug: mock.fn() },
      pool: {},
      validateUserSession: mock.fn(async () => true),
      disconnectSocket: mock.fn(),
      emitPresence: mock.fn(),
      getUsers: mock.fn(async () => []),
      avatarDirPath: mock.fn(() => '/tmp/nonexistent-avatar-dir'),
    };
  }

  const io = { of: () => ({ sockets: new Map() }), engine: { clientsCount: 0 } };
  const retentionCalls = () =>
    ctx.stores.pool.query.mock.calls.filter((c: any) => c.arguments[0] === 'SELECT retention_cleanup()').length;

  it('runs once a day', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    ctx = makeCtx(async () => ({ rows: [], rowCount: 0 }));
    createBackgroundTasks(ctx, { io });
    mock.timers.tick(23 * 60 * 60 * 1000);
    await new Promise((r) => setImmediate(r));
    assert.equal(retentionCalls(), 0);
    mock.timers.tick(60 * 60 * 1000);
    await new Promise((r) => setImmediate(r));
    assert.equal(retentionCalls(), 1);
  });

  it('logs a failure instead of throwing', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    ctx = makeCtx(async (sql) => {
      if (sql === 'SELECT retention_cleanup()') throw new Error('fk violation');
      return { rows: [], rowCount: 0 };
    });
    createBackgroundTasks(ctx, { io });
    mock.timers.tick(24 * 60 * 60 * 1000);
    await new Promise((r) => setImmediate(r));
    assert.ok(ctx.log.warn.mock.calls.some((c: any) => c.arguments[0] === 'retention cleanup failed'));
  });
});
