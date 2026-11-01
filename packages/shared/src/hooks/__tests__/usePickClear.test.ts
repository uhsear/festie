import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePickClear } from '../usePickClear';
import { useFestivalStore } from '../../stores/festivalStore';
import { api } from '../../services/api';
import { UNDO_WINDOW_MS } from '../../utils/crewWrites';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

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

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function seed(picks: Record<string, 'must'>, reminders: Record<string, number>) {
  useFestivalStore.setState({
    currentFestivalId: 'f1',
    currentProfile: { id: 'p1', userId: 'u1', festivalId: 'f1', picks, notes: {}, reminders, updatedAt: '2026-01-01T00:00:00Z' },
  });
}

/** [url-body-key, clientId] for each api.put call, in call order. */
const puts = () =>
  vi.mocked(api.put).mock.calls.map(([, body, opts]) => [Object.keys(body as object)[0], (opts as { clientId: string }).clientId]);

describe('usePickClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.put).mockResolvedValue(undefined);
  });

  it('clears at once, offers Undo, and Undo writes the pick then the reminder after the clear', async () => {
    seed({ s1: 'must' }, { s1: 15 });
    const { notify, tapUndo } = makeNotify();
    const { result } = renderHook(() => usePickClear(notify));

    act(() => result.current('s1', 'X'));
    expect(notify.undo).toHaveBeenCalledTimes(1);
    expect(notify.undo).toHaveBeenCalledWith('Removed X', expect.any(Function), UNDO_WINDOW_MS);

    tapUndo();
    await flush();

    expect(puts()).toEqual([
      ['picks', 'pick-p1-s1'],
      ['reminders', 'reminder-p1-s1'],
      ['picks', 'pick-p1-s1'],
      ['reminders', 'reminder-p1-s1'],
    ]);
    const calls = vi.mocked(api.put).mock.calls;
    expect(calls[2]![1]).toEqual({ picks: { s1: 'must' } });
    expect(calls[3]![1]).toEqual({ reminders: { s1: 15 } });
    expect(useFestivalStore.getState().currentProfile!.picks).toEqual({ s1: 'must' });
  });

  it('reports a failed clear and Undo then sends nothing', async () => {
    seed({ s1: 'must' }, {});
    // A non-Error rejection maps to the fallback text.
    vi.mocked(api.put).mockRejectedValueOnce('boom');
    const { notify, tapUndo } = makeNotify();
    const { result } = renderHook(() => usePickClear(notify));

    act(() => result.current('s1', 'X'));
    await flush();
    expect(notify.error).toHaveBeenCalledWith("Couldn't clear your pick. Try again.");
    const before = vi.mocked(api.put).mock.calls.length;

    tapUndo();
    await flush();
    expect(vi.mocked(api.put).mock.calls.length).toBe(before);
  });

  it('does nothing for a set with no pick', async () => {
    seed({}, {});
    const { notify } = makeNotify();
    const { result } = renderHook(() => usePickClear(notify));
    act(() => result.current('s1', 'X'));
    await flush();
    expect(notify.undo).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });
});
