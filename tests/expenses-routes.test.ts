/**
 * Mock-based route tests for the T30 money routes in routes/expenses.ts:
 * paid-by, uneven shares, edit, delete rights, currency, settle push,
 * payment confirmation and settle-up reminders. Real Zod schemas and
 * validation middleware; stores are mock.fn() stubs. No database.
 * Pattern cloned from tests/crew-rides.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

import { schemas, validate, validateParams } from '../lib/schemas.js';
import { createExpensesStore } from '../lib/db/stores/expenses.js';

const noop = () => {};

const MEMBERS = [
  { userId: 'user-a', username: 'alex', name: 'Alex', role: 'owner' },
  { userId: 'user-b', username: 'sam99', name: 'Sam', role: 'member' },
  { userId: 'user-c', username: 'cara', name: null, role: 'member' },
];

const FOOD = {
  id: 'exp-1',
  crew_id: 'crew-1',
  paid_by: 'user-a',
  created_by: 'user-a',
  description: 'Dinner',
  amount: '30.00',
  split_with: ['user-a', 'user-b'],
  category: 'food',
};

const PAYMENT = {
  id: 'exp-9',
  crew_id: 'crew-1',
  paid_by: 'user-c',
  description: 'Settlement payment',
  amount: '20.00',
  split_with: ['user-b'],
  category: 'settlement',
};

function buildDeps(opts: { expense?: any; currency?: string; balancesCents?: any[]; reminderFresh?: boolean } = {}) {
  const usernames: Record<string, string> = { 'user-a': 'alex', 'user-b': 'sam99', 'user-c': 'cara' };
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    // The caller is picked per request with the x-user header (default user-a).
    userAuth: (req: any, _res: any, next: any) => {
      const userId = req.get('x-user') || 'user-a';
      req.user = { userId, username: usernames[userId] };
      next();
    },
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, status, code } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    sanitizeIdentifier: (s: string) => s,
    schemas,
    validate,
    validateParams,
    config: { PUBLIC_ORIGIN: 'https://festie.us' },
    notificationService: { send: mock.fn(async () => ({ sent: 1 })) },
    emitter: { crewExpenseAdded: mock.fn(), crewExpenseDeleted: mock.fn(), crewExpenseUpdated: mock.fn() },
    stores: {
      crews: {
        getMember: mock.fn(async (_crewId: string, userId: string) => MEMBERS.find((m) => m.userId === userId) ?? null),
        getMembers: mock.fn(async () => MEMBERS),
      },
      expenses: {
        create: mock.fn(async (data: any) => ({ id: 'exp-new', ...data })),
        update: mock.fn(async (id: string, data: any) => ({ id, ...data })),
        getById: mock.fn(async () => opts.expense ?? null),
        delete: mock.fn(async () => {}),
        setConfirmation: mock.fn(async (id: string, received: boolean) => ({
          ...opts.expense,
          id,
          confirmed_at: received ? 'now' : null,
          disputed_at: received ? null : 'now',
        })),
        getCurrency: mock.fn(async () => opts.currency ?? 'USD'),
        setCurrency: mock.fn(async () => {}),
        getBalancesCents: mock.fn(async () => opts.balancesCents ?? []),
        recordReminder: mock.fn(async () => opts.reminderFresh ?? true),
        getByCrew: mock.fn(async () => []),
      },
      users: { getByIds: mock.fn(async () => new Map()) },
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

const calls = (fn: any) => fn.mock.calls.map((c: any) => c.arguments);

describe('POST /crews/:crewId/expenses — paid by and uneven shares', () => {
  const body = {
    description: 'Tent',
    amount: 100,
    splitWith: ['user-a', 'user-b'],
    shares: [
      { userId: 'user-a', cents: 4000 },
      { userId: 'user-b', cents: 6000 },
    ],
    paidBy: 'user-a',
  };

  test('stores the payer, the adder and the shares; balances follow the shares', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    await request(app).post('/crews/crew-1/expenses').set('x-user', 'user-c').send(body).expect(201);

    const [created] = calls(deps.stores.expenses.create)[0];
    assert.equal(created.paidBy, 'user-a');
    assert.equal(created.createdBy, 'user-c');
    assert.deepEqual(created.splitAmounts, { 'user-a': 4000, 'user-b': 6000 });

    // Feed the stored row through the real ledger.
    const row = {
      paid_by: created.paidBy,
      amount: String(created.amount),
      split_with: created.splitWith,
      split_amounts: created.splitAmounts,
    };
    const memberRows = MEMBERS.map((m) => ({ user_id: m.userId, username: m.username }));
    let i = 0;
    const results = [{ rows: [row] }, { rows: memberRows }];
    const store = createExpensesStore({ query: async () => results[i++] } as any);
    const balances = Object.fromEntries(
      (await store.getBalancesCents('crew-1')).map((b) => [b.userId, b.balanceCents]),
    );
    assert.deepEqual(balances, { 'user-a': 6000, 'user-b': -6000, 'user-c': 0 });

    const [activity] = calls(deps.stores.activity.log)[0];
    assert.equal(activity.detail, 'Tent $100.00 (paid by Alex)');
  });

  test('shares that do not add up are refused', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    const res = await request(app)
      .post('/crews/crew-1/expenses')
      .send({
        ...body,
        shares: [
          { userId: 'user-a', cents: 4000 },
          { userId: 'user-b', cents: 5999 },
        ],
      })
      .expect(400);

    assert.match(res.body.error.message, /Shares must add up to the total\./);
    assert.equal(deps.stores.expenses.create.mock.callCount(), 0);
  });

  test('a payer outside the crew is refused', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    const res = await request(app)
      .post('/crews/crew-1/expenses')
      .send({ description: 'Gas', amount: 10, splitWith: ['user-a'], paidBy: 'stranger' })
      .expect(400);

    assert.equal(res.body.error.message, 'The person who paid must be in the crew.');
  });

  test('paidBy defaults to the caller and the activity uses the crew currency', async () => {
    const deps = buildDeps({ currency: 'EUR' });
    const app = await mount(deps);

    await request(app)
      .post('/crews/crew-1/expenses')
      .set('x-user', 'user-b')
      .send({ description: 'Gas', amount: 12.4, splitWith: ['user-a', 'user-b'] })
      .expect(201);

    const [created] = calls(deps.stores.expenses.create)[0];
    assert.equal(created.paidBy, 'user-b');
    assert.equal(created.splitAmounts, null);
    assert.equal(calls(deps.stores.activity.log)[0][0].detail, 'Gas €12.40');
  });
});

describe('PUT /crews/:crewId/expenses/:expenseId', () => {
  const edit = { description: 'Dinner', amount: 45, splitWith: ['user-a', 'user-b'], category: 'food' };

  test('any member can change the amount; trail, activity and socket follow', async () => {
    const deps = buildDeps({ expense: FOOD });
    const app = await mount(deps);

    const res = await request(app).put('/crews/crew-1/expenses/exp-1').set('x-user', 'user-c').send(edit).expect(200);

    const [id, data] = calls(deps.stores.expenses.update)[0];
    assert.equal(id, 'exp-1');
    assert.equal(data.updatedBy, 'user-c');
    assert.equal(data.paidBy, 'user-a', 'payer is kept when the body omits paidBy');
    assert.equal(data.amount, 45);
    assert.equal(res.body.data.updatedBy, 'user-c');

    const activity = calls(deps.stores.activity.log);
    assert.equal(activity.length, 1);
    assert.equal(activity[0][0].type, 'expense-edited');
    assert.equal(activity[0][0].detail, 'Dinner: $30.00 → $45.00');

    const emitted = calls(deps.emitter.crewExpenseUpdated);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0].crewId, 'crew-1');
  });

  test('an unchanged amount logs only the description', async () => {
    const deps = buildDeps({ expense: FOOD });
    const app = await mount(deps);

    await request(app)
      .put('/crews/crew-1/expenses/exp-1')
      .send({ ...edit, amount: 30, description: 'Late dinner' })
      .expect(200);

    assert.equal(calls(deps.stores.activity.log)[0][0].detail, 'Late dinner');
  });

  test('a payment cannot be edited', async () => {
    const deps = buildDeps({ expense: PAYMENT });
    const app = await mount(deps);

    const res = await request(app).put('/crews/crew-1/expenses/exp-9').send(edit).expect(400);

    assert.equal(res.body.error.message, "Payments can't be edited. Undo the payment and record it again.");
    assert.equal(deps.stores.expenses.update.mock.callCount(), 0);
  });

  test('another crew’s expense is not found', async () => {
    const deps = buildDeps({ expense: { ...FOOD, crew_id: 'crew-2' } });
    const app = await mount(deps);

    await request(app).put('/crews/crew-1/expenses/exp-1').send(edit).expect(404);
  });

  test('a split user outside the crew is refused', async () => {
    const deps = buildDeps({ expense: FOOD });
    const app = await mount(deps);

    const res = await request(app)
      .put('/crews/crew-1/expenses/exp-1')
      .send({ ...edit, splitWith: ['user-a', 'stranger'] })
      .expect(400);

    assert.equal(res.body.error.message, 'splitWith includes users who are not crew members');
  });

  test('a member who neither paid nor added it cannot change who paid', async () => {
    const deps = buildDeps({ expense: FOOD });
    const app = await mount(deps);

    const res = await request(app)
      .put('/crews/crew-1/expenses/exp-1')
      .set('x-user', 'user-c')
      .send({ ...edit, paidBy: 'user-b' })
      .expect(403);

    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.equal(
      res.body.error.message,
      'Only the payer, the person who added this, or the crew owner can change who paid.',
    );
    assert.equal(deps.stores.expenses.update.mock.callCount(), 0);
  });

  test('the crew owner can change who paid', async () => {
    const deps = buildDeps({ expense: { ...FOOD, paid_by: 'user-b', created_by: 'user-b' } });
    const app = await mount(deps);

    await request(app).put('/crews/crew-1/expenses/exp-1').set('x-user', 'user-a').send({ ...edit, paidBy: 'user-c' }).expect(200);

    assert.equal(calls(deps.stores.expenses.update)[0][1].paidBy, 'user-c');
  });
});

describe('DELETE /crews/:crewId/expenses/:expenseId — who may remove', () => {
  test('the person who added it may remove it', async () => {
    const deps = buildDeps({ expense: { ...FOOD, paid_by: 'user-b', created_by: 'user-c' } });
    const app = await mount(deps);

    await request(app).delete('/crews/crew-1/expenses/exp-1').set('x-user', 'user-c').expect(200);
  });

  test('the owner may remove it', async () => {
    const deps = buildDeps({ expense: { ...FOOD, paid_by: 'user-b', created_by: 'user-b' } });
    const app = await mount(deps);

    await request(app).delete('/crews/crew-1/expenses/exp-1').set('x-user', 'user-a').expect(200);
  });

  test('anyone else gets the new 403 copy', async () => {
    const deps = buildDeps({ expense: { ...FOOD, paid_by: 'user-a', created_by: 'user-a' } });
    const app = await mount(deps);

    const res = await request(app).delete('/crews/crew-1/expenses/exp-1').set('x-user', 'user-c').expect(403);

    assert.equal(res.body.error.message, 'Only the payer, the person who added it, or the crew owner can remove this.');
    assert.equal(deps.stores.expenses.delete.mock.callCount(), 0);
  });

  test('a payment stays payer-only, even for the owner', async () => {
    const deps = buildDeps({ expense: PAYMENT });
    const app = await mount(deps);

    await request(app).delete('/crews/crew-1/expenses/exp-9').set('x-user', 'user-a').expect(403);
    assert.equal(deps.stores.expenses.delete.mock.callCount(), 0);
  });
});

describe('PUT /crews/:crewId/expenses/currency', () => {
  test('the owner sets USD; a crew that already stores EUR still reads and settles in EUR', async () => {
    const deps = buildDeps({ currency: 'EUR' });
    const app = await mount(deps);

    const res = await request(app).put('/crews/crew-1/expenses/currency').send({ currency: 'USD' }).expect(200);
    assert.deepEqual(res.body.data, { currency: 'USD' });
    assert.deepEqual(calls(deps.stores.expenses.setCurrency)[0], ['crew-1', 'USD']);
    assert.deepEqual(calls(deps.emitter.crewExpenseUpdated)[0][0], { crewId: 'crew-1' });
    assert.equal(calls(deps.stores.activity.log)[0][0].type, 'currency-changed');
    assert.equal(calls(deps.stores.activity.log)[0][0].detail, 'Currency set to USD');
    assert.equal(deps.stores.expenses.update.mock.callCount(), 0, 'currency is not taken as an expense id');

    const plan = await request(app).get('/crews/crew-1/expenses/settlement-plan').expect(200);
    assert.equal(plan.body.data.currency, 'EUR');

    await request(app)
      .post('/crews/crew-1/expenses/settle')
      .set('x-user', 'user-c')
      .send({ toUserId: 'user-b', amount: 20 })
      .expect(201);
    const settled = calls(deps.stores.activity.log).find((c: any) => c[0].type === 'expense-settled');
    assert.equal(settled[0].detail, '€20.00 to Sam');
  });

  test('a non-USD currency is refused for new writes', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    await request(app).put('/crews/crew-1/expenses/currency').send({ currency: 'EUR' }).expect(400);
    assert.equal(deps.stores.expenses.setCurrency.mock.callCount(), 0);
  });

  test('a member cannot change the currency', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    const res = await request(app)
      .put('/crews/crew-1/expenses/currency')
      .set('x-user', 'user-b')
      .send({ currency: 'USD' })
      .expect(403);

    assert.equal(res.body.error.message, 'Only the crew owner can change the currency.');
    assert.equal(deps.stores.expenses.setCurrency.mock.callCount(), 0);
  });

  test('an unsupported code is refused', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    await request(app).put('/crews/crew-1/expenses/currency').send({ currency: 'JPY' }).expect(400);
  });
});

describe('POST /crews/:crewId/expenses/settle — payee push', () => {
  test('pushes once to the payee as a crew_update', async () => {
    const deps = buildDeps();
    const app = await mount(deps);

    await request(app)
      .post('/crews/crew-1/expenses/settle')
      .set('x-user', 'user-c')
      .send({ toUserId: 'user-b', amount: 20 })
      .expect(201);

    const pushes = calls(deps.notificationService.send);
    assert.equal(pushes.length, 1);
    const [push] = pushes[0];
    assert.equal(push.userId, 'user-b');
    assert.equal(push.type, 'crew_update');
    assert.equal(push.title, 'Payment marked as paid');
    assert.equal(push.body, 'cara marked $20.00 paid to you. Open Festie to confirm you got it.');
    assert.equal(push.data.crewId, 'crew-1');
    assert.equal(push.data.expenseId, 'exp-new');
    assert.equal(push.data.deepLink, 'https://festie.us/crew?tab=money');
    assert.equal(push.threadId, 'crew-money-crew-1');
  });

  test('a failing push does not fail the settle', async () => {
    const deps = buildDeps();
    deps.notificationService.send = mock.fn(async () => {
      throw new Error('apns down');
    });
    const app = await mount(deps);

    await request(app)
      .post('/crews/crew-1/expenses/settle')
      .set('x-user', 'user-c')
      .send({ toUserId: 'user-b', amount: 20 })
      .expect(201);
  });
});

describe('POST /crews/:crewId/expenses/:expenseId/confirm', () => {
  test('"not received" by the payee flags the row and pushes to the payer', async () => {
    const deps = buildDeps({ expense: PAYMENT });
    const app = await mount(deps);

    const res = await request(app)
      .post('/crews/crew-1/expenses/exp-9/confirm')
      .set('x-user', 'user-b')
      .send({ received: false })
      .expect(200);

    assert.deepEqual(calls(deps.stores.expenses.setConfirmation)[0], ['exp-9', false]);
    assert.equal(res.body.data.disputed_at, 'now');
    assert.equal(calls(deps.stores.activity.log)[0][0].type, 'payment-disputed');
    assert.equal(calls(deps.stores.activity.log)[0][0].detail, '$20.00 from cara');
    assert.equal(deps.emitter.crewExpenseUpdated.mock.callCount(), 1);

    const pushes = calls(deps.notificationService.send);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0][0].userId, 'user-c');
    assert.equal(pushes[0][0].title, 'Payment not received');
    assert.equal(pushes[0][0].body, "sam99 says your $20.00 payment hasn't arrived. Check with them.");
  });

  test('"received" logs a confirmation and sends no push', async () => {
    const deps = buildDeps({ expense: PAYMENT });
    const app = await mount(deps);

    await request(app)
      .post('/crews/crew-1/expenses/exp-9/confirm')
      .set('x-user', 'user-b')
      .send({ received: true })
      .expect(200);

    assert.equal(calls(deps.stores.activity.log)[0][0].type, 'payment-confirmed');
    assert.equal(deps.notificationService.send.mock.callCount(), 0);
  });

  test('anyone but the payee gets 403', async () => {
    const deps = buildDeps({ expense: PAYMENT });
    const app = await mount(deps);

    const res = await request(app)
      .post('/crews/crew-1/expenses/exp-9/confirm')
      .set('x-user', 'user-a')
      .send({ received: true })
      .expect(403);

    assert.equal(res.body.error.message, 'Only the person who was paid can confirm this.');
    assert.equal(deps.stores.expenses.setConfirmation.mock.callCount(), 0);
  });

  test('an ordinary expense cannot be confirmed', async () => {
    const deps = buildDeps({ expense: FOOD });
    const app = await mount(deps);

    const res = await request(app)
      .post('/crews/crew-1/expenses/exp-1/confirm')
      .set('x-user', 'user-b')
      .send({ received: true })
      .expect(400);

    assert.equal(res.body.error.message, 'Only payments can be confirmed.');
  });
});

describe('POST /crews/:crewId/expenses/remind', () => {
  // Sam owes Alex $12.40.
  const balancesCents = [
    { userId: 'user-a', username: 'alex', balanceCents: 1240 },
    { userId: 'user-b', username: 'sam99', balanceCents: -1240 },
    { userId: 'user-c', username: 'cara', balanceCents: 0 },
  ];

  test('the creditor reminds the debtor once; a second time that day is 409', async () => {
    const deps = buildDeps({ balancesCents });
    const app = await mount(deps);

    const first = await request(app).post('/crews/crew-1/expenses/remind').send({ userId: 'user-b' }).expect(200);
    assert.deepEqual(first.body.data, { reminded: true });
    assert.deepEqual(calls(deps.stores.expenses.recordReminder)[0], ['crew-1', 'user-a', 'user-b']);
    const pushes = calls(deps.notificationService.send);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0][0].userId, 'user-b');
    assert.equal(pushes[0][0].title, 'Settle-up reminder');
    assert.equal(pushes[0][0].body, 'alex sent a reminder: you owe them $12.40.');
    assert.equal(deps.stores.activity.log.mock.callCount(), 0, 'a nudge is private');

    deps.stores.expenses.recordReminder = mock.fn(async () => false);
    const second = await request(app).post('/crews/crew-1/expenses/remind').send({ userId: 'user-b' }).expect(409);
    assert.equal(second.body.error.message, 'You already reminded Sam today. Try again tomorrow.');
    assert.equal(deps.notificationService.send.mock.callCount(), 1);
  });

  test('reminding someone who owes nothing is 400', async () => {
    const deps = buildDeps({ balancesCents });
    const app = await mount(deps);

    const res = await request(app).post('/crews/crew-1/expenses/remind').send({ userId: 'user-c' }).expect(400);

    assert.equal(res.body.error.message, "cara doesn't owe you anything right now.");
    assert.equal(deps.stores.expenses.recordReminder.mock.callCount(), 0);
  });

  test('only the person who is owed can remind', async () => {
    const deps = buildDeps({ balancesCents });
    const app = await mount(deps);

    await request(app)
      .post('/crews/crew-1/expenses/remind')
      .set('x-user', 'user-c')
      .send({ userId: 'user-b' })
      .expect(400);
  });
});
