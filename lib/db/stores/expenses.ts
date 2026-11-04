import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

/**
 * A single member's net position in a crew ledger, in integer cents.
 *   balanceCents > 0  → the crew owes them (creditor)
 *   balanceCents < 0  → they owe the crew (debtor)
 */
export interface BalanceCents {
  userId: string;
  username: string;
  balanceCents: number;
}

/**
 * A directed transfer that settles part of the ledger: `from` pays `to`.
 * Amount is always positive integer cents.
 */
export interface Settlement {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
}

/**
 * Greedy min-cash-flow debt simplification, entirely in INTEGER CENTS.
 *
 * Splits members into creditors (owed money) and debtors (owe money), then
 * repeatedly matches the largest creditor against the largest debtor, emitting
 * a transfer for the smaller of the two magnitudes. This yields at most N-1
 * transfers for N non-zero members and never invents a stray penny: every
 * transfer reduces both sides by the same amount, so the ledger stays zero-sum.
 *
 * Pure function — no DB, no floats. `balances` is expected to be (near) zero-sum
 * (getBalances guarantees this); any residual ≤ ±1 cent is ignored.
 */
export function simplifyDebts(balances: BalanceCents[]): Settlement[] {
  // Sort largest-magnitude first so we knock out the biggest imbalances early.
  const creditors = balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({ ...b, remaining: b.balanceCents }))
    .sort((a, b) => b.remaining - a.remaining);
  const debtors = balances
    .filter((b) => b.balanceCents < 0)
    .map((b) => ({ ...b, remaining: -b.balanceCents }))
    .sort((a, b) => b.remaining - a.remaining);

  const settlements: Settlement[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]!;
    const debtor = debtors[di]!;
    const amountCents = Math.min(creditor.remaining, debtor.remaining);

    // Only emit a transfer worth more than a rounding penny. A sub-2-cent
    // residual is a zero-sum rounding artifact, not a real debt.
    if (amountCents > 1) {
      settlements.push({
        fromUserId: debtor.userId,
        fromName: debtor.username,
        toUserId: creditor.userId,
        toName: creditor.username,
        amountCents,
      });
    }

    creditor.remaining -= amountCents;
    debtor.remaining -= amountCents;
    if (creditor.remaining <= 1) ci++;
    if (debtor.remaining <= 1) di++;
  }

  return settlements;
}

const EXPENSE_COLUMN_NAMES = [
  'id',
  'crew_id',
  'paid_by',
  'description',
  'amount',
  'split_with',
  'category',
  'planned',
  'created_at',
  'split_amounts',
  'created_by',
  'updated_by',
  'updated_at',
  'confirmed_at',
  'disputed_at',
];
const EXPENSE_COLUMNS = EXPENSE_COLUMN_NAMES.join(', ');

// JSONB arrives parsed from pg; a string (old rows, mocks) is parsed here.
function parseJson(value: any, fallback: any) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Equal split: base share to everyone, one extra cent to each of the first
// `remainder` ids in order, so the shares sum to the total.
function evenShares(amountCents: number, userIds: string[]): Array<[string, number]> {
  if (userIds.length === 0) return [];
  const baseShare = Math.floor(amountCents / userIds.length);
  let remainder = amountCents - baseShare * userIds.length;
  return userIds.map((uid) => {
    const owed = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return [uid, owed];
  });
}

/**
 * What each current member owes for one expense, in integer cents. An empty
 * result means the expense is skipped (nobody left to owe it).
 *
 * packages/shared/src/utils/expenseSplit.ts (expenseShareCents) mirrors these
 * rules; tests/stores-expenses.test.ts and expenseSplit.test.ts share fixtures.
 */
function owedShares(
  amountCents: number,
  splitWith: string[],
  splitAmounts: any,
  memberIds: string[],
  isMember: (id: string) => boolean,
): Array<[string, number]> {
  if (splitAmounts && typeof splitAmounts === 'object' && !Array.isArray(splitAmounts)) {
    const keys = Object.keys(splitAmounts);
    const values = keys.map((k) => splitAmounts[k]);
    const valid = values.every((v) => Number.isInteger(v)) && values.reduce((sum, v) => sum + v, 0) === amountCents;
    // A map that does not add up falls back to the equal split over its keys,
    // so bad data can never leave the ledger non-zero-sum.
    if (!valid) return evenShares(amountCents, keys.filter(isMember));
    const staying = keys.filter(isMember);
    if (staying.length === 0) return [];
    // Shares of removed members are pooled and spread evenly over the rest.
    const pool = keys.filter((k) => !isMember(k)).reduce((sum, k) => sum + splitAmounts[k], 0);
    const pooled = new Map(evenShares(pool, staying));
    return staying.map((uid) => [uid, splitAmounts[uid] + (pooled.get(uid) ?? 0)]);
  }
  // Split among the named members (empty = whole crew); drop any id that
  // is no longer a current member so removed members can't leave the
  // ledger non-zero-sum — their share redistributes across the rest.
  return evenShares(amountCents, (splitWith.length > 0 ? splitWith : memberIds).filter(isMember));
}

export function createExpensesStore(pool: Pool) {
  return {
    async create({
      crewId,
      paidBy,
      description,
      amount,
      splitWith,
      category = 'other',
      planned = false,
      createdBy = null,
      splitAmounts = null,
    }: any) {
      const id = randomUUID();
      const splitJson = JSON.stringify(splitWith || []);
      const { rows } = await pool.query(
        `INSERT INTO crew_expenses (id, crew_id, paid_by, description, amount, split_with, category, planned, created_at, created_by, split_amounts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
         RETURNING ${EXPENSE_COLUMNS}`,
        [
          id,
          crewId,
          paidBy,
          description,
          amount,
          splitJson,
          category,
          planned,
          createdBy,
          splitAmounts ? JSON.stringify(splitAmounts) : null,
        ],
      );
      return rows[0];
    },

    // Full replacement of an expense's editable fields (PUT). Records who edited.
    async update(
      id: string,
      { paidBy, description, amount, splitWith, splitAmounts = null, category, planned, updatedBy }: any,
    ) {
      const { rows } = await pool.query(
        `UPDATE crew_expenses
         SET paid_by = $2, description = $3, amount = $4, split_with = $5, split_amounts = $6,
             category = $7, planned = $8, updated_by = $9, updated_at = NOW()
         WHERE id = $1
         RETURNING ${EXPENSE_COLUMNS}`,
        [
          id,
          paidBy,
          description,
          amount,
          JSON.stringify(splitWith || []),
          splitAmounts ? JSON.stringify(splitAmounts) : null,
          category,
          planned,
          updatedBy,
        ],
      );
      return rows[0] || null;
    },

    // The payee's answer on a payment row. Setting one clears the other.
    async setConfirmation(id: string, received: boolean) {
      const { rows } = await pool.query(
        `UPDATE crew_expenses
         SET confirmed_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
             disputed_at = CASE WHEN $2::boolean THEN NULL ELSE NOW() END
         WHERE id = $1
         RETURNING ${EXPENSE_COLUMNS}`,
        [id, received],
      );
      return rows[0] || null;
    },

    async getCurrency(crewId: string): Promise<string> {
      const { rows } = await pool.query('SELECT currency FROM crews WHERE id = $1', [crewId]);
      return rows[0]?.currency || 'USD';
    },

    async setCurrency(crewId: string, currency: string) {
      await pool.query('UPDATE crews SET currency = $2 WHERE id = $1', [crewId, currency]);
    },

    // One settle-up reminder per (crew, creditor, debtor) per UTC day. True when
    // this call recorded it, false when one was already sent today.
    async recordReminder(crewId: string, fromUserId: string, toUserId: string): Promise<boolean> {
      const result = await pool.query(
        `INSERT INTO crew_expense_reminders (crew_id, from_user_id, to_user_id, sent_on)
         VALUES ($1, $2, $3, (NOW() AT TIME ZONE 'UTC')::date)
         ON CONFLICT DO NOTHING`,
        [crewId, fromUserId, toUserId],
      );
      return result.rowCount === 1;
    },

    async getByCrew(crewId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    ${EXPENSE_COLUMN_NAMES.map((c) => `e.${c}`).join(', ')},
    u.username as paid_by_name
  FROM
    crew_expenses e
    JOIN users u ON u.id = e.paid_by
    AND u.deleted_at IS NULL
  WHERE
    e.crew_id = $1
  ORDER BY
    e.created_at DESC
`,
        [crewId],
      );
      return rows.map((r: any) => {
        let splitWith = r.split_with || [];
        if (typeof r.split_with === 'string') {
          try {
            splitWith = JSON.parse(r.split_with);
          } catch {
            splitWith = [];
          }
        }
        return { ...r, split_with: splitWith, split_amounts: parseJson(r.split_amounts, null) };
      });
    },

    async getById(expenseId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    ${EXPENSE_COLUMNS}
  FROM
    crew_expenses
  WHERE
    id = $1
`,
        [expenseId],
      );
      return rows[0] || null;
    },

    async delete(expenseId: string) {
      await pool.query('DELETE FROM crew_expenses WHERE id = $1', [expenseId]);
    },

    // Compute each member's net position in INTEGER CENTS. This is the
    // single source of truth for the ledger; getBalances (dollars) and
    // getBalancesCents (raw cents, for simplifyDebts) both derive from it.
    async computeBalanceCents(crewId: string): Promise<BalanceCents[]> {
      // Get all ACTUAL expenses for the crew. CRITICAL: planned (forecast/budget)
      // rows are excluded — they are not real money owed and must never corrupt
      // the who-owes-whom ledger (and therefore settle-up, which derives from it).
      // `planned IS NOT TRUE` also catches legacy NULLs as actual.
      const { rows: expenses } = await pool.query(
        `
  SELECT
    ${EXPENSE_COLUMNS}
  FROM
    crew_expenses
  WHERE
    crew_id = $1
    AND planned IS NOT TRUE
`,
        [crewId],
      );
      // Get all crew members
      const { rows: members } = await pool.query(
        `
  SELECT
    cm.user_id,
    u.username
  FROM
    crew_members cm
    JOIN users u ON u.id = cm.user_id
    AND u.deleted_at IS NULL
  WHERE
    cm.crew_id = $1
`,
        [crewId],
      );

      const memberIds = members.map((m: any) => m.user_id);
      const nameMap: Record<string, string> = Object.fromEntries(members.map((m: any) => [m.user_id, m.username]));
      // Work in integer cents to avoid float drift and guarantee a zero-sum
      // ledger. node-postgres returns NUMERIC as a JS string, so amounts must be
      // coerced with Number() — `+=` on the raw value would string-concatenate.
      const cents: Record<string, number> = {};
      memberIds.forEach((id: string) => {
        cents[id] = 0;
      });

      const isMember = (uid: string) => cents[uid] !== undefined;
      for (const exp of expenses) {
        const amountCents = Math.round(Number(exp.amount) * 100);
        if (!Number.isFinite(amountCents)) continue;
        const owed = owedShares(
          amountCents,
          parseJson(exp.split_with, []),
          parseJson(exp.split_amounts, null),
          memberIds,
          isMember,
        );
        if (owed.length === 0) continue;
        // A payer who left has no balance row to credit. Skip the expense, as for a
        // departed split member's forgiven share, or the ledger stops summing to zero.
        if (!isMember(exp.paid_by)) continue;

        // Payer fronted the whole amount.
        cents[exp.paid_by] = (cents[exp.paid_by] ?? 0) + amountCents;

        for (const [uid, share] of owed) cents[uid] = (cents[uid] ?? 0) - share;
      }

      return memberIds.map((id: string) => ({
        userId: id,
        username: nameMap[id] ?? id,
        balanceCents: cents[id] ?? 0,
      }));
    },

    // Dollars projection — the existing public contract (balance: number).
    async getBalances(crewId: string) {
      const cents = await this.computeBalanceCents(crewId);
      return cents.map((b) => ({
        userId: b.userId,
        username: b.username,
        balance: b.balanceCents / 100,
      }));
    },

    // Raw cents projection — feeds simplifyDebts for the settlement plan.
    async getBalancesCents(crewId: string): Promise<BalanceCents[]> {
      return this.computeBalanceCents(crewId);
    },
  };
}
