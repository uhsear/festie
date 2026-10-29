import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  QUEUED_WRITE_MESSAGE,
  UNDO_WINDOW_MS,
  createSettleUpFlow,
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

  it('rowSyncState points a failed replay at Pending sync and marks queued rows pending', () => {
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
