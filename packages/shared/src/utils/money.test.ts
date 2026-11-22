import { describe, it, expect } from 'vitest';
import {
  settleUpLine,
  formatBalance,
  formatAmount,
  formatCents,
  toCents,
  centsToInputText,
  ZERO_EPSILON,
  spendingExpenses,
  ledgerRows,
  describePayment,
  expenseAmountError,
  MAX_EXPENSE_AMOUNT,
} from './money';

describe('settlement helpers', () => {
  const rows = [
    { id: 'a', category: 'food' },
    { id: 'b', planned: true, category: 'food' },
    { id: 'c', category: 'settlement' },
  ];

  it('spendingExpenses drops planned and settlement rows', () => {
    expect(spendingExpenses(rows).map((r) => r.id)).toEqual(['a']);
  });

  it("ledgerRows('all') drops only settlements", () => {
    expect(ledgerRows(rows, 'all').map((r) => r.id)).toEqual(['a', 'b']);
    expect(ledgerRows(rows, 'planned').map((r) => r.id)).toEqual(['b']);
  });

  it('describePayment gives the three forms and fallbacks', () => {
    const names: Record<string, string> = { me: 'Me', sam: 'Sam', alex: 'Alex' };
    const nameOf = (id: string) => names[id];
    const pay = (paid_by: string, to: string) => ({ paid_by, split_with: [to], amount: '12' });
    expect(describePayment(pay('me', 'sam'), 'me', nameOf)).toBe('You paid Sam $12.00');
    expect(describePayment(pay('sam', 'me'), 'me', nameOf)).toBe('Sam paid you $12.00');
    expect(describePayment(pay('sam', 'alex'), 'me', nameOf)).toBe('Sam paid Alex $12.00');
    expect(describePayment({ ...pay('x', 'y'), paid_by_name: 'Zed' }, 'me', () => undefined)).toBe(
      'Zed paid a crewmate $12.00',
    );
    expect(describePayment(pay('x', 'y'), 'me', () => undefined)).toBe('A crewmate paid a crewmate $12.00');
  });
});

describe('formatBalance', () => {
  it('prefixes a positive balance with +$', () => {
    expect(formatBalance(12.5)).toBe('+$12.50');
  });

  it('prefixes a negative balance with -$ using the absolute value', () => {
    expect(formatBalance(-12.5)).toBe('-$12.50');
  });

  it('renders exact zero as $0.00', () => {
    expect(formatBalance(0)).toBe('$0.00');
  });

  it('swallows sub-cent rounding noise inside the epsilon to $0.00', () => {
    expect(formatBalance(0.01)).toBe('$0.00');
    expect(formatBalance(-0.01)).toBe('$0.00');
    expect(formatBalance(0.005)).toBe('$0.00');
    expect(formatBalance(-0.009)).toBe('$0.00');
  });

  it('treats values just past the epsilon as signed', () => {
    expect(formatBalance(0.02)).toBe('+$0.02');
    expect(formatBalance(-0.02)).toBe('-$0.02');
  });

  it('rounds to two decimal places', () => {
    expect(formatBalance(1.005)).toBe('+$1.00');
    expect(formatBalance(2.349)).toBe('+$2.35');
  });
});

describe('formatAmount', () => {
  it('formats a numeric amount as $X.XX', () => {
    expect(formatAmount(9.5)).toBe('$9.50');
  });

  it('coerces a string amount (the API returns amounts as strings)', () => {
    expect(formatAmount('15')).toBe('$15.00');
    expect(formatAmount('15.4')).toBe('$15.40');
  });

  it('renders zero as $0.00', () => {
    expect(formatAmount(0)).toBe('$0.00');
  });

  it('does not sign negative amounts (bare formatter)', () => {
    expect(formatAmount(-3.2)).toBe('$-3.20');
  });
});

describe('settleUpLine', () => {
  it('words owe, owed and settled', () => {
    expect(settleUpLine(-24)).toBe('You owe $24.00');
    expect(settleUpLine(12.5)).toBe("You're owed $12.50");
    expect(settleUpLine(0.004)).toBe("You're all settled up");
  });
});

describe('currency formatting', () => {
  it('formats amounts and signed balances in the crew currency', () => {
    expect(formatAmount('12.4', 'EUR')).toBe('€12.40');
    expect(formatAmount(12.4, 'GBP')).toBe('£12.40');
    expect(formatBalance(12.4, 'EUR')).toBe('+€12.40');
    expect(formatBalance(-12.4, 'EUR')).toBe('-€12.40');
    expect(formatBalance(0.004, 'EUR')).toBe('€0.00');
  });

  it('formatCents and toCents work in integer cents', () => {
    expect(formatCents(1240)).toBe('$12.40');
    expect(formatCents(1240, 'EUR')).toBe('€12.40');
    expect(toCents('12.345')).toBe(1235);
    expect(toCents(12.4)).toBe(1240);
    expect(toCents('abc')).toBe(0);
  });
});

describe('centsToInputText / ZERO_EPSILON', () => {
  it('renders integer cents as a 2-dp input string', () => {
    expect(centsToInputText(1240)).toBe('12.40');
    expect(centsToInputText(5)).toBe('0.05');
    expect(centsToInputText(0)).toBe('0.00');
  });
  it('round-trips with toCents', () => {
    expect(toCents(centsToInputText(1999))).toBe(1999);
  });
  it('is the settled threshold formatBalance uses', () => {
    expect(formatBalance(ZERO_EPSILON)).toBe('$0.00');
    expect(formatBalance(ZERO_EPSILON + 0.001)).toBe('+$0.01');
  });
});

describe('expenseAmountError', () => {
  it('stays quiet for an empty or usable amount', () => {
    expect(expenseAmountError('')).toBeUndefined();
    expect(expenseAmountError('12.50')).toBeUndefined();
    expect(expenseAmountError(MAX_EXPENSE_AMOUNT)).toBeUndefined();
  });
  it('explains an amount below one cent', () => {
    expect(expenseAmountError('0')).toBe('Enter an amount of at least $0.01');
    expect(expenseAmountError('.')).toBe('Enter an amount of at least $0.01');
    expect(expenseAmountError('-3')).toBe('Enter an amount of at least $0.01');
  });
  it('explains an amount above the server bound', () => {
    expect(expenseAmountError('999999999')).toBe("Amount can't be more than $99,999,999.99");
  });
});
