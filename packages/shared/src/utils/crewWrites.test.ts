import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  QUEUED_WRITE_MESSAGE,
  UNDO_WINDOW_MS,
  exitBalanceNotice,
  createSettleUpFlow,
  payOptionsFor,
  isPending,
  rowSyncState,
  scheduleUndoable,
  writeOutcomeMessage,
  writeOutcomeOf,
} from './crewWrites';
import type { CrewSettlement } from '../types';

describe('write outcome copy', () => {
  it('treats the synthetic queued result as queued and anything else as sent', () => {
    expect(writeOutcomeOf({ id: 'POST:/x:1', _optimistic: true })).toBe('queued');
    expect(writeOutcomeOf({ ok: true, _optimistic: true })).toBe('queued');
    expect(writeOutcomeOf({ id: 'e1' })).toBe('sent');
    expect(writeOutcomeOf(undefined)).toBe('sent');
  });

  it('never shows the sent copy for a queued write', () => {
    expect(writeOutcomeMessage('queued', 'Expense added')).toBe(QUEUED_WRITE_MESSAGE);
    expect(writeOutcomeMessage('sent', 'Expense added')).toBe('Expense added');
  });

  it('isPending marks only optimistic placeholders', () => {
    expect(isPending({ _optimistic: true })).toBe(true);
    expect(isPending({ _optimistic: false })).toBe(false);
    expect(isPending({})).toBe(false);
    expect(isPending(null)).toBe(false);
  });

  it('rowSyncState flags a failed replay and marks queued rows pending', () => {
    expect(rowSyncState({ id: 'POST:/a:1', _optimistic: true }, ['POST:/a:1'])).toBe('failed');
    expect(rowSyncState({ id: 'POST:/a:2', _optimistic: true }, ['POST:/a:1'])).toBe('pending');
    expect(rowSyncState({ id: 'e1' }, [])).toBeNull();
  });
});

describe('scheduleUndoable', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits once after the undo window, not before', () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    scheduleUndoable(commit);
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('never commits when undone inside the window', () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const action = scheduleUndoable(commit);
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 100);
    expect(action.undo()).toBe(true);
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    expect(commit).not.toHaveBeenCalled();
  });

  it('undo after the commit ran reports false; flush commits early exactly once', () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const action = scheduleUndoable(commit);
    action.flush();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(action.undo()).toBe(false);
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('createSettleUpFlow', () => {
  const settlement: CrewSettlement = {
    fromUserId: 'me',
    fromName: 'Me',
    toUserId: 'sam',
    toName: 'Sam',
    amountCents: 1250,
    amount: 12.5,
    payeeHandles: { venmo: '@sam', cashapp: '$sam', paypal: null },
  };

  it('shows the payment links without recording a settlement', () => {
    const record = vi.fn().mockResolvedValue('sent');
    const flow = createSettleUpFlow(settlement, record);
    expect(flow.options.map((o) => o.label)).toEqual(['Venmo', 'Cash App']);
    expect(flow.options[0]!.link.app).toContain('amount=12.50');
    expect(record).not.toHaveBeenCalled();
  });

  it('records the exact planned amount only when the user confirms they paid', async () => {
    const record = vi.fn().mockResolvedValue('queued');
    const flow = createSettleUpFlow(settlement, record);
    await expect(flow.confirmPaid()).resolves.toBe('queued');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ toUserId: 'sam', amount: 12.5 });
  });
});

describe('payOptionsFor currency', () => {
  const settlement: CrewSettlement = {
    fromUserId: 'me',
    fromName: 'Me',
    toUserId: 'sam',
    toName: 'Sam',
    amountCents: 1240,
    amount: 12.4,
    payeeHandles: { venmo: '@sam', cashapp: '$sam', paypal: 'sam' },
  };

  it('offers only PayPal, with the currency code, outside USD', () => {
    const options = payOptionsFor(settlement, 'EUR');
    expect(options.map((o) => o.label)).toEqual(['PayPal']);
    expect(options[0]!.link.web.endsWith('12.40EUR')).toBe(true);
    expect(payOptionsFor(settlement).map((o) => o.label)).toEqual(['Venmo', 'Cash App', 'PayPal']);
  });

  it('createSettleUpFlow passes the currency through', () => {
    const flow = createSettleUpFlow(settlement, vi.fn(), 'EUR');
    expect(flow.options.map((o) => o.label)).toEqual(['PayPal']);
  });
});

describe('exitBalanceNotice', () => {
  const bal = (userId: string, balance: number) => ({ userId, balance });
  const pick = (balances: ReturnType<typeof bal>[], over = {}) =>
    exitBalanceNotice({ balances, userId: 's', name: 'Sam', action: 'leave', ...over });

  it('says nothing when the net balance is zero (a settled-up member owes nothing)', () => {
    // Alex paid 30 split 3 ways; Sam paid Alex 10 back: the server nets Sam to 0.
    expect(pick([bal('a', 0), bal('s', 0), bal('z', 0)])).toBe('');
    expect(pick([bal('a', 0.004)])).toBe('');
    expect(pick([])).toBe('');
  });

  it('names the net amount owed, once, not the gross', () => {
    expect(pick([bal('s', -12.4)])).toBe("Sam still owes $12.40. Leaving forgives this, and the crew's balances change.");
  });

  it('names the net amount the member is owed', () => {
    expect(pick([bal('s', 10)], { action: 'remove' })).toBe(
      "Sam is still owed $10.00. Removing forgives this, and the crew's balances change.",
    );
  });

  it('speaks to the user when the leaver is you, in the crew currency', () => {
    expect(pick([bal('s', -5)], { name: null, currency: 'EUR' })).toBe(
      "You still owe €5.00. Leaving forgives this, and the crew's balances change.",
    );
    expect(pick([bal('s', 2.5)], { name: null })).toBe(
      "You are still owed $2.50. Leaving forgives this, and the crew's balances change.",
    );
  });

  it('delete states the crew-wide outstanding total and that every balance is cleared', () => {
    expect(pick([bal('a', 20), bal('s', -10), bal('z', -10)], { action: 'delete', name: null })).toBe(
      "The crew has $20.00 unsettled. Deleting the crew clears every member's balance.",
    );
    expect(pick([bal('a', 0), bal('s', 0)], { action: 'delete', name: null })).toBe('');
  });
});
