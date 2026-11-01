/**
 * Route tests for settle-up activity rows in routes/expenses.ts.
 * Settle and undo must log names, never raw user ids. Mocked stores, no DB.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

const noop = () => {};
const noopMw = (_req: any, _res: any, next: any) => next();

function buildDeps(overrides: { expense?: any; members?: any[] } = {}) {
  const members = overrides.members ?? [
    { userId: 'user-1', username: 'alex', name: 'Alex' },
    { userId: 'user-2', username: 'sam99', name: 'Sam' },
    { userId: 'user-3', username: 'cara', name: null },
  ];
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1' };
      next();
    },
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, status, code } }),
    ErrorCodes: { INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', FORBIDDEN: 'FORBIDDEN', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    rateLimit: () => noopMw,
    sanitizeIdentifier: (s: string) => s,
    schemas: {},
    validate: () => (req: any, _res: any, next: any) => {
      req.validatedBody = req.body;
      next();
    },
    validateParams: () => (req: any, _res: any, next: any) => {
      req.validatedParams = req.params;
      next();
    },
    emitter: { crewExpenseAdded: mock.fn(), crewExpenseDeleted: mock.fn() },
    stores: {
      crews: {
        getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        getMembers: mock.fn(async () => members),
      },
      expenses: {
        create: mock.fn(async (data: any) => ({ id: 'exp-new', ...data })),
        getById: mock.fn(async () => overrides.expense ?? null),
        delete: mock.fn(async () => {}),
      },
      activity: { log: mock.fn(async () => 'act-1') },
    },
  };
}

async function mount(deps: any) {
  const { default: createExpenseRoutes } = await import('../routes/expenses.js');
  const app = express();
  app.use(express.json());
  app.use(createExpenseRoutes(deps));
  return app;
}

const SETTLEMENT = {
  id: 'exp-9',
  crew_id: 'crew-1',
  paid_by: 'user-1',
  amount: '12.00',
  split_with: ['user-2'],
  category: 'settlement',
};

describe('routes/expenses — settle-up activity', () => {
  test('settle logs expense-settled with the recipient name and amount', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    await request(app).post('/crews/crew-1/expenses/settle').send({ toUserId: 'user-2', amount: 12 }).expect(201);

    const calls = deps.stores.activity.log.mock.calls as any[];
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].arguments[0], {
      crewId: 'crew-1',
      userId: 'user-1',
      type: 'expense-settled',
      detail: '$12.00 to Sam',
    });
  });

  test('settle falls back to the username when there is no display name', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    await request(app).post('/crews/crew-1/expenses/settle').send({ toUserId: 'user-3', amount: 7.5 }).expect(201);

    const entry = (deps.stores.activity.log.mock.calls as any[])[0].arguments[0];
    assert.equal(entry.detail, '$7.50 to cara');
    assert.ok(!entry.detail.includes('user-3'));
  });

  test('undoing a settlement logs settlement-undone with the recipient name', async () => {
    const deps = buildDeps({ expense: SETTLEMENT });
    const app = await mount(deps);

    await request(app).delete('/crews/crew-1/expenses/exp-9').expect(200);

    assert.equal(deps.stores.expenses.delete.mock.calls.length, 1);
    const calls = deps.stores.activity.log.mock.calls as any[];
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].arguments[0], {
      crewId: 'crew-1',
      userId: 'user-1',
      type: 'settlement-undone',
      detail: '$12.00 to Sam',
    });
  });

  test('deleting an ordinary expense logs no settlement activity', async () => {
    const deps = buildDeps({ expense: { ...SETTLEMENT, category: 'food', split_with: ['user-1', 'user-2'] } });
    const app = await mount(deps);

    await request(app).delete('/crews/crew-1/expenses/exp-9').expect(200);

    assert.equal(deps.stores.activity.log.mock.calls.length, 0);
  });

  test('only the payer can undo a settlement', async () => {
    const deps = buildDeps({ expense: { ...SETTLEMENT, paid_by: 'user-2' } });
    const app = await mount(deps);

    await request(app).delete('/crews/crew-1/expenses/exp-9').expect(403);

    assert.equal(deps.stores.expenses.delete.mock.calls.length, 0);
    assert.equal(deps.stores.activity.log.mock.calls.length, 0);
  });
});
