import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClashResolver } from '../useClashResolver';
import { useFestivalStore } from '../../stores/festivalStore';
import { COPY } from '../../constants/copy';
import { buildPickConflicts } from '../../utils/pickConflicts';
import type { FestivalDay, FestivalSet, Priority } from '../../types/domain';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({
  resetAllStores: vi.fn(),
}));

const DAYS: FestivalDay[] = [{ id: 'd0', festivalId: 'f1', date: '2026-06-13', createdAt: '', updatedAt: '' }];

function makeSet(id: string, startTime: string, endTime: string): FestivalSet {
  return {
    id,
    festivalId: 'f1',
    stageId: 'main',
    dayIndex: 0,
    startTime,
    endTime,
    artist: id.toUpperCase(),
    createdAt: '',
    updatedAt: '',
  };
}

const SETS = [makeSet('a', '21:00', '22:30'), makeSet('b', '21:30', '23:00')];
const PICKS: Record<string, Priority> = { a: 'want-to-see', b: 'must' };
const GROUP = buildPickConflicts({ sets: SETS, myPicks: PICKS, selectedDay: 0, days: DAYS, timeZone: 'UTC' })[0]!;

let savePick: ReturnType<typeof vi.fn>;
let removePick: ReturnType<typeof vi.fn>;
let saveNote: ReturnType<typeof vi.fn>;

beforeEach(() => {
  savePick = vi.fn().mockResolvedValue(undefined);
  removePick = vi.fn().mockResolvedValue(undefined);
  saveNote = vi.fn().mockResolvedValue(undefined);
  useFestivalStore.setState({
    currentFestivalId: 'f1',
    currentFestival: {
      id: 'f1',
      name: 'Fest',
      startDate: '2026-06-13',
      endDate: '2026-06-13',
      timeZone: 'UTC',
      createdAt: '',
      updatedAt: '',
    },
    stages: [{ id: 'main', name: 'Main Stage', festivalId: 'f1', createdAt: '', updatedAt: '' }],
    sets: SETS,
    days: DAYS,
    currentProfile: {
      id: 'p1',
      userId: 'u1',
      festivalId: 'f1',
      picks: PICKS,
      notes: { a: 'Bring earplugs' },
      updatedAt: '',
    },
    allProfiles: [],
    savePick,
    removePick,
    saveNote,
  } as never);
});

describe('useClashResolver', () => {
  it('keep removes the other pick, and undo restores its priority', async () => {
    const { result } = renderHook(() => useClashResolver());
    let resolution!: Awaited<ReturnType<typeof result.current.keep>>;
    await act(async () => {
      resolution = await result.current.keep(GROUP, 'b');
    });
    expect(removePick).toHaveBeenCalledWith('f1', 'a');
    expect(resolution.message).toBe('Kept B. A is off your picks.');

    await act(() => resolution.undo());
    expect(savePick).toHaveBeenCalledWith({ festivalId: 'f1', setId: 'a', priority: 'want-to-see' });
  });

  it('split writes the plan line, and undo restores the old note', async () => {
    const { result } = renderHook(() => useClashResolver());
    expect(result.current.splitPlan(GROUP)?.sentence).toBe(
      'See the first 30 min of A, then leave at 9:30 PM for B at Main Stage.',
    );
    let resolution!: Awaited<ReturnType<typeof result.current.split>>;
    await act(async () => {
      resolution = await result.current.split(GROUP);
    });
    expect(saveNote).toHaveBeenLastCalledWith({
      festivalId: 'f1',
      setId: 'a',
      note: 'Bring earplugs\nSplit plan: See the first 30 min of A, then leave at 9:30 PM for B at Main Stage.',
    });
    expect(resolution.message).toBe('Split plan saved in your note on A.');

    await act(() => resolution.undo());
    expect(saveNote).toHaveBeenLastCalledWith({ festivalId: 'f1', setId: 'a', note: 'Bring earplugs' });
  });

  it('reads and clears a saved plan', async () => {
    useFestivalStore.setState({
      currentProfile: {
        id: 'p1',
        userId: 'u1',
        festivalId: 'f1',
        picks: PICKS,
        notes: { a: 'Split plan: Go to B.\nBring earplugs' },
        updatedAt: '',
      },
    });
    const { result } = renderHook(() => useClashResolver());
    expect(result.current.plannedSplit(GROUP)).toBe('Go to B.');
    await act(async () => {
      await result.current.clearSplit(GROUP);
    });
    expect(saveNote).toHaveBeenLastCalledWith({ festivalId: 'f1', setId: 'a', note: 'Bring earplugs' });
  });

  describe('catch instead', () => {
    // Far-future days, so no slot has ended by the real clock.
    const FUTURE: FestivalDay[] = [
      { ...DAYS[0]!, date: '2099-06-13' },
      { ...DAYS[0]!, id: 'd1', date: '2099-06-14' },
    ];
    const OTHER_SLOT = { ...makeSet('a2', '21:00', '22:30'), artist: 'A', dayIndex: 1 };
    const FUTURE_SETS = [SETS[0]!, SETS[1]!, OTHER_SLOT];

    beforeEach(() => {
      useFestivalStore.setState({ days: FUTURE, sets: FUTURE_SETS } as never);
    });

    const group = () =>
      buildPickConflicts({ sets: FUTURE_SETS, myPicks: PICKS, selectedDay: 0, days: FUTURE, timeZone: 'UTC' })[0]!;

    it('removes the clashing pick, picks the other slot, and undoes both', async () => {
      const { result } = renderHook(() => useClashResolver());
      expect(result.current.catchOption(group())).toMatchObject({ fromSetId: 'a', priority: 'want-to-see' });
      let resolution!: Awaited<ReturnType<typeof result.current.catchInstead>>;
      await act(async () => {
        resolution = await result.current.catchInstead(group());
      });
      expect(removePick).toHaveBeenCalledWith('f1', 'a');
      expect(savePick).toHaveBeenCalledWith({ festivalId: 'f1', setId: 'a2', priority: 'want-to-see' });
      expect(removePick.mock.invocationCallOrder[0]).toBeLessThan(savePick.mock.invocationCallOrder[0]!);

      removePick.mockClear();
      savePick.mockClear();
      await act(() => resolution.undo());
      expect(savePick).toHaveBeenCalledWith({ festivalId: 'f1', setId: 'a', priority: 'want-to-see' });
      expect(removePick).toHaveBeenCalledWith('f1', 'a2');
      expect(savePick.mock.invocationCallOrder[0]).toBeLessThan(removePick.mock.invocationCallOrder[0]!);
    });

    it('throws when there is no option', async () => {
      useFestivalStore.setState({ sets: [FUTURE_SETS[0]!, FUTURE_SETS[1]!] } as never);
      const { result } = renderHook(() => useClashResolver());
      await expect(result.current.catchInstead(group())).rejects.toThrow(COPY.alsoPlays.gone);
    });

    it('reads guest picks when there is no profile', () => {
      useFestivalStore.setState({ currentProfile: null, guestPicks: { f1: PICKS } } as never);
      const { result } = renderHook(() => useClashResolver());
      expect(result.current.catchOption(group())).not.toBeNull();
    });
  });

  it('rejects when the store write fails', async () => {
    removePick.mockRejectedValueOnce(new Error('offline queue full'));
    const { result } = renderHook(() => useClashResolver());
    await expect(result.current.keep(GROUP, 'b')).rejects.toThrow('offline queue full');
  });
});
