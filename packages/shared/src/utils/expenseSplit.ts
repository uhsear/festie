/**
 * Expense shares and the sentences built from them. Integer cents throughout,
 * matching the server's computeBalanceCents so what a row says is what the
 * ledger does.
 */
import type { CrewExpense, CrewExpenseBalance, CrewMember, CrewSettlement } from '../types';
import { memberDisplayName } from './crewLogistics';
import { formatAmount, formatCents, toCents } from './money';
import { timeAgo } from './timeAgo';

export type ExpenseShare = { userId: string; cents: number };

/** Same epsilon as `formatBalance`. */
const ZERO_EPSILON = 0.01;

/** Equal split: the leftover cents go one each to the first ids, in order. */
export function evenShares(totalCents: number, userIds: string[]): ExpenseShare[] {
  if (userIds.length === 0) return [];
  const base = Math.floor(totalCents / userIds.length);
  const remainder = totalCents - base * userIds.length;
  return userIds.map((userId, i) => ({ userId, cents: base + (i < remainder ? 1 : 0) }));
}

/**
 * Shares in proportion to the days each person attends. Users with 0 days are
 * returned in `removed` and get no share. Leftover cents go one each by largest
 * remainder, ties in `userIds` order. Everyone at 0 days: no shares, all removed.
 */
export function sharesByDays(
  totalCents: number,
  userIds: string[],
  daysFor: (userId: string) => number,
): { shares: ExpenseShare[]; removed: string[] } {
  const days = userIds.map((id) => Math.max(0, daysFor(id)));
  const sumDays = days.reduce((a, b) => a + b, 0);
  if (sumDays === 0) return { shares: [], removed: [...userIds] };
  const rows = userIds
    .map((userId, i) => {
      const d = days[i] ?? 0;
      return { userId, i, d, cents: Math.floor((totalCents * d) / sumDays) };
    })
    .filter((r) => r.d > 0);
  let leftover = totalCents - rows.reduce((a, r) => a + r.cents, 0);
  // Compare remainders as integers: (total * d) % sumDays.
  const order = [...rows].sort((a, b) => ((totalCents * b.d) % sumDays) - ((totalCents * a.d) % sumDays) || a.i - b.i);
  for (const r of order) {
    if (leftover <= 0) break;
    r.cents += 1;
    leftover -= 1;
  }
  return {
    shares: rows.map((r) => ({ userId: r.userId, cents: r.cents })),
    removed: userIds.filter((_, i) => days[i] === 0),
  };
}

/** Why a set of typed shares cannot be saved, or null when they add up. */
export function sharesError(totalCents: number, shares: ExpenseShare[], currency = 'USD'): string | null {
  if (shares.some((s) => !Number.isInteger(s.cents) || s.cents <= 0)) {
    return 'Give each person an amount above zero, or take them out of the split.';
  }
  const sum = shares.reduce((acc, s) => acc + s.cents, 0);
  if (sum !== totalCents) {
    return `These shares add up to ${formatCents(sum, currency)}. They need to add up to ${formatCents(totalCents, currency)}.`;
  }
  return null;
}

/**
 * The user's share of an expense in cents. Null when the user is not in the
 * split or the row is a plan. Mirrors owedShares in lib/db/stores/expenses.ts:
 * a stored map that does not add up falls back to an equal split over its keys,
 * and the cents of members who left are pooled and spread over the staying keys
 * in `Object.keys(split_amounts)` order (the JSONB order both sides receive).
 */
export function expenseShareCents(
  expense: Pick<CrewExpense, 'amount' | 'split_with' | 'split_amounts' | 'planned'>,
  userId: string,
  memberIds: string[],
): number | null {
  if (expense.planned) return null;
  const present = new Set(memberIds);
  const total = toCents(expense.amount);
  const stored = expense.split_amounts;
  let shares: ExpenseShare[];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const entries = Object.entries(stored);
    const staying = entries.filter(([id]) => present.has(id));
    const stayingIds = staying.map(([id]) => id);
    const valid = entries.every(([, v]) => Number.isInteger(v)) && entries.reduce((sum, [, v]) => sum + v, 0) === total;
    if (!valid) {
      shares = evenShares(total, stayingIds);
    } else {
      const pool = entries.filter(([id]) => !present.has(id)).reduce((sum, [, v]) => sum + v, 0);
      const pooled = new Map(evenShares(pool, stayingIds).map((s) => [s.userId, s.cents]));
      shares = staying.map(([id, v]) => ({ userId: id, cents: v + (pooled.get(id) ?? 0) }));
    }
  } else {
    const named = expense.split_with?.length > 0 ? expense.split_with : memberIds;
    shares = evenShares(
      total,
      named.filter((id) => present.has(id)),
    );
  }
  return shares.find((s) => s.userId === userId)?.cents ?? null;
}

export function settlementSentence(s: CrewSettlement, currentUserId: string, currency = 'USD'): string {
  const amount = formatCents(s.amountCents, currency);
  if (s.fromUserId === currentUserId) return `You owe ${s.toName} ${amount}`;
  if (s.toUserId === currentUserId) return `${s.fromName} owes you ${amount}`;
  return `${s.fromName} owes ${s.toName} ${amount}`;
}

export function balanceSentence(b: CrewExpenseBalance, currentUserId: string, currency = 'USD'): string {
  const self = b.userId === currentUserId;
  if (Math.abs(b.balance) <= ZERO_EPSILON) return self ? "You're settled up" : `${b.username} is settled up`;
  const amount = formatAmount(Math.abs(b.balance), currency);
  if (b.balance > 0) return self ? `You are owed ${amount}` : `${b.username} is owed ${amount}`;
  return self ? `You owe ${amount}` : `${b.username} owes ${amount}`;
}

/** Payments to the current user they have not answered yet, newest first. */
export function paymentsToConfirm(expenses: CrewExpense[], currentUserId: string): CrewExpense[] {
  return expenses
    .filter(
      (e) =>
        e.category === 'settlement' &&
        e.split_with[0] === currentUserId &&
        e.paid_by !== currentUserId &&
        !e.confirmed_at &&
        !e.disputed_at &&
        !e._optimistic,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** What the payee said about a payment. Null for other rows or before they answer. */
export function paymentStatusLine(expense: CrewExpense, members: CrewMember[], currentUserId: string): string | null {
  if (expense.category !== 'settlement') return null;
  const payeeId = expense.split_with[0];
  const you = payeeId === currentUserId;
  const payee = memberDisplayName(members, payeeId);
  if (expense.confirmed_at) return you ? 'You confirmed it arrived.' : `${payee} confirmed it arrived.`;
  if (expense.disputed_at) return you ? "You said it hasn't arrived." : `${payee} says it hasn't arrived.`;
  return null;
}

/** "Added by Alex · Edited by Sam 2h ago". Null when there is nothing to say. */
export function expenseTrailLine(expense: CrewExpense, members: CrewMember[]): string | null {
  const parts: string[] = [];
  if (expense.created_by && expense.created_by !== expense.paid_by) {
    parts.push(`Added by ${memberDisplayName(members, expense.created_by)}`);
  }
  if (expense.updated_by && expense.updated_at) {
    parts.push(
      `Edited by ${memberDisplayName(members, expense.updated_by)} ${timeAgo(Date.parse(expense.updated_at))}`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
