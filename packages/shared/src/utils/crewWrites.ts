/**
 * Crew write honesty and undo — shared by web and mobile so both platforms say
 * the same true thing about a write (PRODUCT.md: "Never lose a write, and never
 * lie about one").
 *
 * A crew write ends in one of three user-visible states (the offline campaign's
 * no-silent-drops contract): sent (the server acknowledged it), queued (saved
 * on this device, replays on reconnect) or failed (in uiStore.failedSync, shown
 * in the PendingSyncSheet).
 */
import type { CrewSettlement } from '../types';
import { cashAppLink, payPalLink, venmoLink, type PaymentLink } from './paymentLinks';

export type WriteOutcome = 'sent' | 'queued';

/** Copy for a write that is saved locally but not yet acknowledged by the server. */
export const QUEUED_WRITE_MESSAGE = 'Saved on this device — will send when online';
/** Row marker for an optimistic (queued) entity. */
export const PENDING_ROW_LABEL = 'Not sent yet';

/**
 * api.ts returns a synthetic `{ ..., _optimistic: true }` result when it queued
 * the write instead of sending it. Anything else came back from the server.
 */
export function writeOutcomeOf(result: unknown): WriteOutcome {
  return result != null && typeof result === 'object' && (result as { _optimistic?: unknown })._optimistic === true
    ? 'queued'
    : 'sent';
}

/** Success copy only after a server ack; the queued copy otherwise. */
export function writeOutcomeMessage(outcome: WriteOutcome, sentMessage: string): string {
  return outcome === 'queued' ? QUEUED_WRITE_MESSAGE : sentMessage;
}

/** Row marker for a queued write that permanently failed (it sits in uiStore.failedSync). */
export const FAILED_ROW_LABEL = "Couldn't send — open Pending sync to retry";

/** True while an entity is a local placeholder whose create has not reached the server. */
export function isPending(item: { _optimistic?: boolean } | null | undefined): boolean {
  return item?._optimistic === true;
}

/**
 * Sync marker for a list row. An optimistic row's id is the queue clientId, so
 * a failed replay is found by matching it against the failedSync clientIds.
 */
export function rowSyncState(
  item: { id: string; _optimistic?: boolean },
  failedClientIds: readonly string[],
): 'pending' | 'failed' | null {
  if (failedClientIds.includes(item.id)) return 'failed';
  return isPending(item) ? 'pending' : null;
}

// ── Destructive crew actions ────────────────────────────────────────────────

/** Confirm copy for deleting a crew. Matches the ON DELETE CASCADE set in migrations. */
export function deleteCrewConfirmMessage(crewName: string, memberCount: number): string {
  const who = memberCount === 1 ? 'you' : `all ${memberCount} members`;
  return `Delete "${crewName}" for ${who}? Its meeting points, polls, packing list, rides, expenses and activity are deleted too. This can't be undone.`;
}

/** Confirm copy for leaving a crew. */
export function leaveCrewConfirmMessage(crewName: string): string {
  return `Leave "${crewName}"? You lose access to its meeting points, polls and expenses. To rejoin you need a new invite code.`;
}

/** Confirm copy for an owner removing a member. */
export function removeMemberConfirmMessage(memberName: string, crewName: string): string {
  return `Remove ${memberName} from "${crewName}"? They lose access to the crew's plans and expenses until they rejoin with an invite code.`;
}

// ── Undoable delete ─────────────────────────────────────────────────────────

/** How long a delete stays undoable before the API call is made. */
export const UNDO_WINDOW_MS = 5000;

export interface UndoableAction {
  /** Cancel the pending commit. Returns false if it already ran. */
  undo: () => boolean;
  /** Run the commit now (e.g. on unmount) instead of waiting for the timer. */
  flush: () => void;
}

/**
 * Defer `commit` by `delayMs` so the user can undo. The API call is never made
 * when the user undoes in time, and is made exactly once otherwise.
 */
export function scheduleUndoable(commit: () => void, delayMs: number = UNDO_WINDOW_MS): UndoableAction {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    commit();
  };
  const timer = setTimeout(run, delayMs);
  return {
    undo: () => {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      return true;
    },
    flush: run,
  };
}

// ── Settle up: pay first, record second ─────────────────────────────────────

export interface PayOption {
  label: 'Venmo' | 'Cash App' | 'PayPal';
  link: PaymentLink;
}

/** The payee's payment links for a settlement, in display order. */
export function payOptionsFor(s: CrewSettlement): PayOption[] {
  const options: PayOption[] = [];
  const venmo = venmoLink({ handle: s.payeeHandles.venmo, amountCents: s.amountCents, note: 'Festie settle-up' });
  if (venmo) options.push({ label: 'Venmo', link: venmo });
  const cashapp = cashAppLink({ handle: s.payeeHandles.cashapp, amountCents: s.amountCents });
  if (cashapp) options.push({ label: 'Cash App', link: cashapp });
  const paypal = payPalLink({ handle: s.payeeHandles.paypal, amountCents: s.amountCents });
  if (paypal) options.push({ label: 'PayPal', link: paypal });
  return options;
}

/** Confirmation copy shown before a settlement is recorded. */
export function confirmPaidMessage(s: CrewSettlement, formattedAmount: string): string {
  return `Did you pay ${s.toName} ${formattedAmount}? This records the payment for the whole crew. Only confirm once the money has gone through.`;
}

export interface SettleUpFlow {
  options: PayOption[];
  /** Record the settlement. Call only after the user confirms they paid. */
  confirmPaid: () => Promise<WriteOutcome>;
}

/**
 * Settle-up is two steps: show the payee's payment links, then record the
 * settlement only when the user confirms they paid. Building the flow (and
 * opening any link) never records anything.
 */
export function createSettleUpFlow(
  s: CrewSettlement,
  record: (request: { toUserId: string; amount: number }) => Promise<WriteOutcome>,
): SettleUpFlow {
  return {
    options: payOptionsFor(s),
    confirmPaid: () => record({ toUserId: s.toUserId, amount: s.amount }),
  };
}
