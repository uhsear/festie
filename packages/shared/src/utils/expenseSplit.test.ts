import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  balanceSentence,
  evenShares,
  expenseShareCents,
  expenseTrailLine,
  paymentStatusLine,
  paymentsToConfirm,
  settlementSentence,
  sharesByDays,
  sharesError,
} from './expenseSplit';
import type { CrewExpense, CrewMember, CrewSettlement } from '../types';

const members: CrewMember[] = [
  { userId: 'a', name: 'Alex' },
  { userId: 's', username: 'sam' },
];

const expense = (over: Partial<CrewExpense>): CrewExpense => ({
  id: 'e',
  crew_id: 'c',
  paid_by: 'a',
  paid_by_name: 'Alex',
  description: 'x',
  amount: '10.00',
  split_with: [],
  category: 'food',
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

afterEach(() => vi.useRealTimers());

describe('evenShares', () => {
  it('gives the extra cents to the first ids in order', () => {
    expect(evenShares(1000, ['a', 'b', 'c'])).toEqual([
      { userId: 'a', cents: 334 },
      { userId: 'b', cents: 333 },
      { userId: 'c', cents: 333 },
    ]);
    expect(evenShares(100, [])).toEqual([]);
  });
});

describe('sharesByDays', () => {
  const daysOf = (map: Record<string, number>) => (id: string) => map[id] ?? 0;

  it('weights shares by days', () => {
    expect(sharesByDays(4000, ['a', 'b'], daysOf({ a: 3, b: 1 }))).toEqual({
      shares: [
        { userId: 'a', cents: 3000 },
        { userId: 'b', cents: 1000 },
      ],
      removed: [],
    });
    expect(sharesByDays(1000, ['a', 'b', 'c'], () => 1).shares.map((s) => s.cents)).toEqual([334, 333, 333]);
  });

  it('removes zero-day users and gives them no share', () => {
    expect(sharesByDays(1000, ['a', 'b', 'c'], daysOf({ a: 2, c: 2 }))).toEqual({
      shares: [
        { userId: 'a', cents: 500 },
        { userId: 'c', cents: 500 },
      ],
      removed: ['b'],
    });
  });

  it('removes everyone when all are at zero days', () => {
    expect(sharesByDays(1000, ['a', 'b'], () => 0)).toEqual({ shares: [], removed: ['a', 'b'] });
  });

  it('always sums to the total', () => {
    for (let n = 0; n < 200; n += 1) {
      const total = 1 + Math.floor(Math.random() * 100000);
      const ids = Array.from({ length: 1 + Math.floor(Math.random() * 8) }, (_, i) => `u${i}`);
      const days = ids.map(() => Math.floor(Math.random() * 6));
      const { shares } = sharesByDays(total, ids, (id) => days[ids.indexOf(id)]);
      if (days.some((d) => d > 0)) expect(shares.reduce((s, x) => s + x.cents, 0)).toBe(total);
      else expect(shares).toEqual([]);
    }
  });
});

describe('sharesError', () => {
  it('flags a non-positive share and a sum mismatch', () => {
    expect(sharesError(1000, [{ userId: 'a', cents: 0 }])).toBe(
      'Give each person an amount above zero, or take them out of the split.',
    );
    expect(
      sharesError(1000, [
        { userId: 'a', cents: 400 },
        { userId: 'b', cents: 500 },
      ]),
    ).toBe('These shares add up to $9.00. They need to add up to $10.00.');
    expect(sharesError(1000, [{ userId: 'a', cents: 1000 }])).toBeNull();
  });
});

describe('expenseShareCents', () => {
  it('splits equally, with the remainder to the first member', () => {
    const e = expense({ amount: '10.00', split_with: ['a', 'b', 'c'] });
    expect(expenseShareCents(e, 'a', ['a', 'b', 'c'])).toBe(334);
    expect(expenseShareCents(e, 'c', ['a', 'b', 'c'])).toBe(333);
  });

  it('treats an empty split as the whole crew and a non-member as out', () => {
    expect(expenseShareCents(expense({ amount: '9.00' }), 'b', ['a', 'b', 'c'])).toBe(300);
    expect(expenseShareCents(expense({ split_with: ['a'] }), 'b', ['a', 'b'])).toBeNull();
  });

  it('uses stored uneven shares', () => {
    const e = expense({ split_with: ['a', 'b'], split_amounts: { a: 700, b: 300 } });
    expect(expenseShareCents(e, 'a', ['a', 'b'])).toBe(700);
    expect(expenseShareCents(e, 'b', ['a', 'b'])).toBe(300);
  });

  it('redistributes a removed member and keeps the sum equal to the total', () => {
    const even = expense({ amount: '10.00', split_with: ['a', 'b', 'gone'] });
    expect(expenseShareCents(even, 'a', ['a', 'b'])).toBe(500);
    const uneven = expense({
      amount: '10.00',
      split_with: ['a', 'b', 'gone'],
      split_amounts: { a: 500, b: 300, gone: 200 },
    });
    const a = expenseShareCents(uneven, 'a', ['a', 'b'])!;
    const b = expenseShareCents(uneven, 'b', ['a', 'b'])!;
    expect(a + b).toBe(1000);
    expect(a).toBe(600);
  });

  it('spreads a pooled remainder in split_amounts key order, not split_with order', () => {
    // Server order is Object.keys(split_amounts); split_with lists b first.
    const odd = expense({
      amount: '10.01',
      split_with: ['b', 'a', 'gone'],
      split_amounts: { a: 300, b: 300, gone: 401 },
    });
    expect(expenseShareCents(odd, 'a', ['a', 'b'])).toBe(501);
    expect(expenseShareCents(odd, 'b', ['a', 'b'])).toBe(500);
  });

  it('falls back to an equal split over the map keys when the map does not add up', () => {
    const e = expense({ amount: '10.00', split_with: ['a', 'b', 'c'], split_amounts: { a: 900, b: 900 } });
    expect(expenseShareCents(e, 'a', ['a', 'b', 'c'])).toBe(500);
    expect(expenseShareCents(e, 'b', ['a', 'b', 'c'])).toBe(500);
    expect(expenseShareCents(e, 'c', ['a', 'b', 'c'])).toBeNull();
  });

  it('is null for a planned row', () => {
    expect(expenseShareCents(expense({ planned: true }), 'a', ['a'])).toBeNull();
  });
});

describe('sentences', () => {
  const s: CrewSettlement = {
    fromUserId: 'a',
    fromName: 'Alex',
    toUserId: 's',
    toName: 'Sam',
    amountCents: 1240,
    amount: 12.4,
    payeeHandles: {},
  };

  it('writes all three settlement forms', () => {
    expect(settlementSentence(s, 'a', 'USD')).toBe('You owe Sam $12.40');
    expect(settlementSentence(s, 's', 'USD')).toBe('Alex owes you $12.40');
    expect(settlementSentence(s, 'z', 'EUR')).toBe('Alex owes Sam €12.40');
  });

  it('writes every balance form', () => {
    const b = (userId: string, balance: number) => ({ userId, username: 'Sam', balance });
    expect(balanceSentence(b('a', 8), 'a')).toBe('You are owed $8.00');
    expect(balanceSentence(b('a', -8), 'a')).toBe('You owe $8.00');
    expect(balanceSentence(b('s', 8), 'a')).toBe('Sam is owed $8.00');
    expect(balanceSentence(b('s', -8), 'a')).toBe('Sam owes $8.00');
    expect(balanceSentence(b('s', 0.004), 'a')).toBe('Sam is settled up');
    expect(balanceSentence(b('a', 0), 'a')).toBe("You're settled up");
  });
});

describe('payments', () => {
  const pay = (over: Partial<CrewExpense>) =>
    expense({ category: 'settlement', paid_by: 'a', split_with: ['s'], ...over });

  it('paymentsToConfirm keeps unanswered payments to me, newest first', () => {
    const rows = [
      pay({ id: 'old', created_at: '2026-01-01T00:00:00Z' }),
      pay({ id: 'new', created_at: '2026-01-02T00:00:00Z' }),
      pay({ id: 'done', confirmed_at: '2026-01-03T00:00:00Z' }),
      pay({ id: 'no', disputed_at: '2026-01-03T00:00:00Z' }),
      pay({ id: 'opt', _optimistic: true }),
      pay({ id: 'mine', paid_by: 's' }),
      expense({ id: 'food', split_with: ['s'] }),
    ];
    expect(paymentsToConfirm(rows, 's').map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('paymentStatusLine covers payee and other views', () => {
    const ok = pay({ confirmed_at: 'x' });
    const no = pay({ disputed_at: 'x' });
    expect(paymentStatusLine(ok, members, 's')).toBe('You confirmed it arrived.');
    expect(paymentStatusLine(no, members, 's')).toBe("You said it hasn't arrived.");
    expect(paymentStatusLine(ok, members, 'a')).toBe('sam confirmed it arrived.');
    expect(paymentStatusLine(no, members, 'a')).toBe("sam says it hasn't arrived.");
    expect(paymentStatusLine(pay({}), members, 'a')).toBeNull();
    expect(paymentStatusLine(expense({}), members, 'a')).toBeNull();
  });
});

describe('expenseTrailLine', () => {
  it('joins the added-by and edited-by parts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
    const e = expense({
      paid_by: 's',
      created_by: 'a',
      updated_by: 's',
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect(expenseTrailLine(e, members)).toBe('Added by Alex · Edited by sam 2h ago');
    expect(expenseTrailLine(expense({ created_by: 'a' }), members)).toBeNull();
    expect(expenseTrailLine(expense({ paid_by: 's', created_by: 'a' }), members)).toBe('Added by Alex');
  });
});
