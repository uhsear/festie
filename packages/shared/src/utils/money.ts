/**
 * Money formatting shared by the web SPA and the mobile app so both render
 * expense amounts and balances identically.
 *
 * These are pure, non-pixel string formatters: the per-platform pixel code
 * (Tailwind class strings on web, RN StyleSheet on mobile) picks the color and
 * weight; these decide the text.
 */

/** Below this magnitude a balance is treated as exactly zero (rounding noise). */
const ZERO_EPSILON = 0.01;

/**
 * Signed balance string for a net position:
 *   value >  0.01  → "+$X.XX"  (they're owed)
 *   value < -0.01  → "-$X.XX"  (they owe)
 *   otherwise      → "$0.00"   (settled, swallowing sub-cent rounding noise)
 */
export function formatBalance(value: number): string {
  if (value > ZERO_EPSILON) return `+$${value.toFixed(2)}`;
  if (value < -ZERO_EPSILON) return `-$${Math.abs(value).toFixed(2)}`;
  return '$0.00';
}

/** Standing for the wrap-up card: "You owe $24.00", "You're owed $12.50" or "You're all settled up". */
export function settleUpLine(balance: number): string {
  if (balance < -ZERO_EPSILON) return `You owe ${formatAmount(Math.abs(balance))}`;
  if (balance > ZERO_EPSILON) return `You're owed ${formatAmount(balance)}`;
  return "You're all settled up";
}

/**
 * Bare currency string for a (non-signed) amount: "$X.XX". Coerces string|number
 * inputs (the API returns amounts as strings) the same way both apps did inline.
 */
export function formatAmount(value: string | number): string {
  return `$${Number(value).toFixed(2)}`;
}

export function isSettlement(e: { category?: string | null }): boolean {
  return e.category === 'settlement';
}

/** Rows that count as spending: not planned, not a settle-up payment. */
export function spendingExpenses<T extends { planned?: boolean; category?: string | null }>(list: T[]): T[] {
  return list.filter((e) => !e.planned && !isSettlement(e));
}

export function settlementPayments<T extends { category?: string | null }>(list: T[]): T[] {
  return list.filter(isSettlement);
}

export function ledgerRows<T extends { planned?: boolean; category?: string | null }>(
  list: T[],
  view: 'all' | 'actual' | 'planned',
): T[] {
  if (view === 'actual') return spendingExpenses(list);
  if (view === 'planned') return list.filter((e) => e.planned);
  return list.filter((e) => !isSettlement(e));
}

/** "You paid Sam $12.00" | "Sam paid you $12.00" | "Sam paid Alex $12.00". */
export function describePayment(
  e: { paid_by: string; paid_by_name?: string; split_with: string[]; amount: string | number },
  currentUserId: string,
  nameOf: (userId: string) => string | undefined,
): string {
  const recipientId = e.split_with[0];
  const payer = nameOf(e.paid_by) ?? e.paid_by_name ?? 'A crewmate';
  const recipient = (recipientId ? nameOf(recipientId) : undefined) ?? 'a crewmate';
  const amount = formatAmount(e.amount);
  if (e.paid_by === currentUserId) return `You paid ${recipient} ${amount}`;
  if (recipientId === currentUserId) return `${payer} paid you ${amount}`;
  return `${payer} paid ${recipient} ${amount}`;
}
