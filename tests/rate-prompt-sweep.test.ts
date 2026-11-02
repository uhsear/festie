import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundTasks } from '../lib/shutdown.js';

// The hourly rate_prompt sweep: one sendRatePrompt per candidate festival, and
// one failing festival does not stop the rest.
describe('rate_prompt sweep', () => {
  let ctx: any;

  afterEach(() => {
    for (const t of ctx?.state.timers ?? []) clearInterval(t);
    mock.timers.reset();
  });

  function makeCtx(sendRatePrompt: (id: string) => Promise<void>) {
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
        pool: {
          query: mock.fn(async (sql: string) =>
            sql.includes('festival_days d') && sql.includes('CURRENT_DATE - 2')
              ? { rows: [{ id: 'f1' }, { id: 'f2' }] }
              : { rows: [], rowCount: 0 },
          ),
        },
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
      reengagement: { sendRatePrompt: mock.fn(sendRatePrompt) },
    };
  }

  it('sends the prompt for every candidate festival each hour, past a failing one', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    ctx = makeCtx(async (id) => {
      if (id === 'f1') throw new Error('push down');
    });
    createBackgroundTasks(ctx, { io: { of: () => ({ sockets: new Map() }), engine: { clientsCount: 0 } } });

    mock.timers.tick(60 * 60 * 1000);
    await new Promise((r) => setImmediate(r));

    const calls = ctx.reengagement.sendRatePrompt.mock.calls.map((c: any) => c.arguments[0]);
    assert.deepEqual(calls, ['f1', 'f2']);
    assert.ok(ctx.log.debug.mock.calls.some((c: any) => c.arguments[0] === 'rate_prompt sweep: per-festival send failed'));
  });

  it('is not registered without a sendRatePrompt trigger', () => {
    ctx = makeCtx(async () => {});
    delete ctx.reengagement;
    createBackgroundTasks(ctx, { io: { of: () => ({ sockets: new Map() }), engine: { clientsCount: 0 } } });
    assert.ok(!ctx.log.info.mock.calls.some((c: any) => c.arguments[0] === 'rate_prompt sweep registered (hourly, leader-only)'));
  });
});
