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

const formatters = new Map<string, Intl.NumberFormat>();

/** Round half-binary like `toFixed(2)` so existing USD output is unchanged (Intl alone rounds 1.005 up). */
function formatTwoDp(value: number, currency: string): string {
  return currencyFormatter(currency).format(Number.isFinite(value) ? Number(value.toFixed(2)) : value);
}

function currencyFormatter(currency: string): Intl.NumberFormat {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    formatters.set(currency, f);
  }
  return f;
}

/**
 * Signed balance string for a net position in the crew's currency (default USD,
 * all supported currencies have 2 decimals):
 *   value >  0.01  → "+$X.XX"  (they're owed)
 *   value < -0.01  → "-$X.XX"  (they owe)
 *   otherwise      → "$0.00"   (settled, swallowing sub-cent rounding noise)
 */
export function formatBalance(value: number, currency = 'USD'): string {
  if (value > ZERO_EPSILON) return `+${formatTwoDp(value, currency)}`;
  if (value < -ZERO_EPSILON) return `-${formatTwoDp(Math.abs(value), currency)}`;
  return formatTwoDp(0, currency);
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
export function formatAmount(value: string | number, currency = 'USD'): string {
  // A negative keeps its sign after the symbol ("$-3.20"), as the bare formatter always did.
  return formatTwoDp(Number(value), currency).replace(/^-(\D*)/, '$1-');
}

/** Format an integer-cent amount, e.g. 1240 → "$12.40". */
export function formatCents(cents: number, currency = 'USD'): string {
  return formatAmount(cents / 100, currency);
}

/** Decimal amount (string or number) to integer cents. 0 for a non-finite value. */
export function toCents(value: string | number): number {
  const cents = Math.round(Number(value) * 100);
  return Number.isFinite(cents) ? cents : 0;
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
  currency = 'USD',
): string {
  const recipientId = e.split_with[0];
  const payer = nameOf(e.paid_by) ?? e.paid_by_name ?? 'A crewmate';
  const recipient = (recipientId ? nameOf(recipientId) : undefined) ?? 'a crewmate';
  const amount = formatAmount(e.amount, currency);
  if (e.paid_by === currentUserId) return `You paid ${recipient} ${amount}`;
  if (recipientId === currentUserId) return `${payer} paid you ${amount}`;
  return `${payer} paid ${recipient} ${amount}`;
}
