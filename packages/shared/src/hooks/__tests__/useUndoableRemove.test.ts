import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoableRemove, type UndoNotifier } from '../useUndoableRemove';
import { QUEUED_WRITE_MESSAGE, UNDO_WINDOW_MS, type WriteOutcome } from '../../utils/crewWrites';

function makeNotify() {
  let lastUndo: (() => void) | null = null;
  const notify = {
    info: vi.fn(),
    error: vi.fn(),
    undo: vi.fn((_m: string, onUndo: () => void, _d: number) => {
      lastUndo = onUndo;
    }),
  };
  return { notify, tapUndo: () => lastUndo?.() };
}

function makeCommit(outcome: WriteOutcome | Error) {
  return vi.fn((_id: string): Promise<WriteOutcome> =>
    outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome),
  );
}

/** Run the undo window out and let the commit promise settle. */
async function expireWindow() {
  await act(async () => {
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useUndoableRemove', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hides the row at once and shows the undo toast', () => {
    const commit = makeCommit('sent');
    const { notify } = makeNotify();
    const { result } = renderHook(() => useUndoableRemove(commit, 'Fail', notify));
    act(() => result.current.remove('a', 'Tent'));
    expect(result.current.hiddenIds.has('a')).toBe(true);
    expect(notify.undo).toHaveBeenCalledWith('Removed Tent', expect.any(Function), UNDO_WINDOW_MS);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits once after the undo window', async () => {
    const commit = makeCommit('sent');
    const { notify } = makeNotify();
    const { result } = renderHook(() => useUndoableRemove(commit, 'Fail', notify));
    act(() => result.current.remove('a', 'Tent'));
    await expireWindow();
    await expireWindow();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('a');
    expect(notify.info).not.toHaveBeenCalled();
  });

  it('never commits when undone in time and unhides the row', async () => {
    const commit = makeCommit('sent');
    const { notify, tapUndo } = makeNotify();
    const { result } = renderHook(() => useUndoableRemove(commit, 'Fail', notify));
    act(() => result.current.remove('a', 'Tent'));
    act(() => tapUndo());
    expect(result.current.hiddenIds.has('a')).toBe(false);
    await expireWindow();
    expect(commit).not.toHaveBeenCalled();
  });

  it('unhides and shows the mapped error when the commit fails', async () => {
    const err = Object.assign(new Error('Too many requests'), {
      name: 'ApiClientError',
      status: 429,
      retryAfter: '30',
    });
    const commit = makeCommit(err);
    const { notify } = makeNotify();
    const { result } = renderHook(() => useUndoableRemove(commit, 'Fail', notify));
    act(() => result.current.remove('a', 'Tent'));
    await expireWindow();
    expect(result.current.hiddenIds.has('a')).toBe(false);
    expect(notify.error).toHaveBeenCalledWith('Too many tries. Wait 30 seconds and try again.');
  });

  it('shows the queued copy when the write was queued offline', async () => {
    const commit = makeCommit('queued');
    const { notify } = makeNotify();
    const { result } = renderHook(() => useUndoableRemove(commit, 'Fail', notify));
    act(() => result.current.remove('a', 'Tent'));
    await expireWindow();
    expect(notify.info).toHaveBeenCalledWith(QUEUED_WRITE_MESSAGE);
  });

  it('says it is too late when undo comes after the commit', async () => {
    const commit = makeCommit('sent');
    const { notify, tapUndo } = makeNotify();
    const { result } = renderHook(() => useUndoableRemove(commit, 'Fail', notify));
    act(() => result.current.remove('a', 'Tent'));
    await expireWindow();
    act(() => tapUndo());
    expect(notify.info).toHaveBeenCalledWith('Too late to undo: Tent was already removed.');
    expect(result.current.hiddenIds.has('a')).toBe(true);
  });

  it('uses the latest notifier without changing remove', async () => {
    const commit = makeCommit('queued');
    const first = makeNotify().notify;
    const second = makeNotify().notify;
    const { result, rerender } = renderHook(({ n }: { n: UndoNotifier }) => useUndoableRemove(commit, 'Fail', n), {
      initialProps: { n: first },
    });
    const removeBefore = result.current.remove;
    rerender({ n: second });
    expect(result.current.remove).toBe(removeBefore);
    act(() => result.current.remove('a', 'Tent'));
    await expireWindow();
    expect(second.info).toHaveBeenCalledWith(QUEUED_WRITE_MESSAGE);
    expect(first.info).not.toHaveBeenCalled();
  });
});
