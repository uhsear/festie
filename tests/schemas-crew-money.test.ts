import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { schemas } from '../lib/schemas.js';

function messages(result: { success: boolean; error?: { issues: { message: string }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.message);
}

const base = { description: 'Gas', amount: 30, splitWith: ['a', 'b'], category: 'transport' };

describe('schemas: expenseCreate shares', () => {
  it('accepts shares that add up to the total', () => {
    const r = schemas.expenseCreate.safeParse({
      ...base,
      shares: [
        { userId: 'a', cents: 1001 },
        { userId: 'b', cents: 1999 },
      ],
    });
    assert.equal(r.success, true);
  });

  it('accepts an expense with no shares and a paidBy', () => {
    assert.equal(schemas.expenseCreate.safeParse({ ...base, paidBy: 'b' }).success, true);
  });

  it('rejects shares 1 cent short', () => {
    const r = schemas.expenseCreate.safeParse({
      ...base,
      shares: [
        { userId: 'a', cents: 1500 },
        { userId: 'b', cents: 1499 },
      ],
    });
    assert.deepEqual(messages(r), ['Shares must add up to the total.']);
  });

  it('rejects a duplicate share user', () => {
    const r = schemas.expenseCreate.safeParse({
      ...base,
      splitWith: ['a'],
      shares: [
        { userId: 'a', cents: 1500 },
        { userId: 'a', cents: 1500 },
      ],
    });
    assert.ok(messages(r).includes('Each person can appear once in the shares.'));
  });

  it('rejects shares that name someone not in splitWith', () => {
    const r = schemas.expenseCreate.safeParse({
      ...base,
      shares: [
        { userId: 'a', cents: 1500 },
        { userId: 'c', cents: 1500 },
      ],
    });
    assert.deepEqual(messages(r), ['Shares must list the same people as the split.']);
  });

  it('expenseUpdate applies the same rules', () => {
    const r = schemas.expenseUpdate.safeParse({ ...base, shares: [{ userId: 'a', cents: 3000 }] });
    assert.deepEqual(messages(r), ['Shares must list the same people as the split.']);
  });

  it('rejects a settlement category on create and update', () => {
    for (const schema of [schemas.expenseCreate, schemas.expenseUpdate]) {
      const r = schema.safeParse({ ...base, category: 'settlement', paidBy: 'a', splitWith: ['b'] });
      assert.deepEqual(messages(r), ['Record a payment with Settle up, not as an expense.']);
    }
  });
});

describe('schemas: expenseCurrency', () => {
  it('accepts USD', () => {
    assert.equal(schemas.expenseCurrency.safeParse({ currency: 'USD' }).success, true);
  });

  for (const currency of ['EUR', 'eur', 'JPY', 'XXX']) {
    it(`rejects ${currency}`, () => {
      assert.equal(schemas.expenseCurrency.safeParse({ currency }).success, false);
    });
  }
});

describe('schemas: expenseConfirm and expenseRemind', () => {
  it('confirm needs a boolean', () => {
    assert.equal(schemas.expenseConfirm.safeParse({ received: false }).success, true);
    assert.equal(schemas.expenseConfirm.safeParse({}).success, false);
  });

  it('remind needs a userId', () => {
    assert.equal(schemas.expenseRemind.safeParse({ userId: 'u1' }).success, true);
    assert.equal(schemas.expenseRemind.safeParse({ userId: '' }).success, false);
  });
});

describe('schemas: packing', () => {
  it('packingBatch accepts 30 labels and rejects 31', () => {
    const labels = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i}`);
    assert.equal(schemas.packingBatch.safeParse({ labels: labels(30) }).success, true);
    assert.equal(schemas.packingBatch.safeParse({ labels: labels(31) }).success, false);
  });

  it('packingUpdate accepts packed on its own', () => {
    assert.equal(schemas.packingUpdate.safeParse({ packed: true }).success, true);
  });
});

describe('schemas: ride direction and departTime', () => {
  for (const name of ['rideCreate', 'rideUpdate'] as const) {
    it(`${name} rejects direction 'sideways'`, () => {
      assert.equal(schemas[name].safeParse({ direction: 'sideways' }).success, false);
    });

    it(`${name} accepts an ISO departTime and rejects 'Fri 2pm'`, () => {
      assert.equal(
        schemas[name].safeParse({ direction: 'home', departTime: '2026-07-04T18:00:00.000Z' }).success,
        true,
      );
      assert.equal(schemas[name].safeParse({ departTime: 'Fri 2pm' }).success, false);
    });
  }
});

describe('schemas: expense amount bounds and cursor (FND-006, FND-014)', () => {
  it('rejects amounts that round to zero or overflow NUMERIC(10,2)', () => {
    for (const amount of [0.001, 1e15, 100_000_000]) {
      assert.equal(schemas.expenseCreate.safeParse({ ...base, amount }).success, false, String(amount));
      assert.equal(schemas.expenseSettleFull.safeParse({ toUserId: 'a', amount }).success, false, String(amount));
    }
    assert.equal(schemas.expenseCreate.safeParse({ ...base, amount: 0.01 }).success, true);
  });

  it('rejects a pagination cursor containing a NUL byte', () => {
    assert.equal(schemas.paginationQuery.safeParse({ cursor: '\u0000bad' }).success, false);
    assert.equal(schemas.paginationQuery.safeParse({ cursor: 'garbage' }).success, true);
  });
});
