import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBulkAddPicks } from '../useBulkAddPicks';
import { useFestivalStore } from '../../stores/festivalStore';
import { api } from '../../services/api';
import { UNDO_WINDOW_MS } from '../../utils/crewWrites';
import type { Priority } from '../../types/domain';

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

function seed(picks: Record<string, Priority>) {
  useFestivalStore.setState({
    currentFestivalId: 'f1',
    currentProfile: { id: 'p1', userId: 'u1', festivalId: 'f1', picks, notes: {}, updatedAt: '2026-01-01T00:00:00Z' },
  });
}

const GROUP = { key: 'stage-main', label: 'Main Stage', setIds: ['s1', 's2', 's3'] };

describe('useBulkAddPicks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.put).mockResolvedValue(undefined);
  });

  it('reports the true count with Undo, and Undo restores only the changed keys', async () => {
    seed({ s1: 'must' });
    const { notify, tapUndo } = makeNotify();
    const { result } = renderHook(() => useBulkAddPicks(notify));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.add(GROUP, 'must');
    });
    expect(outcome).toBe('added');
    expect(notify.undo).toHaveBeenCalledWith(
      'Added 2 sets from Main Stage to Must See (1 already picked).',
      expect.any(Function),
      UNDO_WINDOW_MS,
    );
    expect(useFestivalStore.getState().currentProfile!.picks).toEqual({ s1: 'must', s2: 'must', s3: 'must' });

    tapUndo();
    await flush();
    expect(useFestivalStore.getState().currentProfile!.picks).toEqual({ s1: 'must' });
    expect(notify.info).toHaveBeenCalledWith('Undone. Your plan is back to how it was.');
    expect(result.current.busyKey).toBeNull();
  });

  it('says nothing new when every set is already picked, and sends no PUT', async () => {
    seed({ s1: 'must', s2: 'must', s3: 'must' });
    const { notify } = makeNotify();
    const { result } = renderHook(() => useBulkAddPicks(notify));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.add(GROUP, 'must');
    });
    expect(outcome).toBe('none');
    expect(notify.info).toHaveBeenCalledWith('Nothing new to add from Main Stage.');
    expect(notify.undo).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('returns failed and reports the error when the PUT rejects', async () => {
    seed({});
    vi.mocked(api.put).mockRejectedValueOnce(new Error('boom'));
    const { notify } = makeNotify();
    const { result } = renderHook(() => useBulkAddPicks(notify));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.add(GROUP, 'must');
    });
    expect(outcome).toBe('failed');
    expect(notify.error).toHaveBeenCalledWith(expect.any(String));
    expect(result.current.busyKey).toBeNull();
  });
});
