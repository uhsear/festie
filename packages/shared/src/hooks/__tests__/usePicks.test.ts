import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePicks, usePickSync, useCanPick, useMyPick, useMyNote, useMyReminder, usePickActions } from '../usePicks';
import { useFestivalStore } from '../../stores/festivalStore';
import { useAuthStore } from '../../stores/authStore';

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

function resetStore() {
  useFestivalStore.setState({
    currentFestivalId: null,
    currentFestival: null,
    festivals: [],
    stages: [],
    sets: [],
    days: [],
    currentProfile: null,
    allProfiles: [],
    pickCounts: {},
    isLoading: false,
    error: null,
  });
}

describe('usePicks hook', () => {
  beforeEach(() => {
    resetStore();
    useAuthStore.setState({ user: null });
  });

  describe('useCanPick', () => {
    it('is true with a profile', () => {
      useFestivalStore.setState({
        currentFestivalId: 'f1',
        currentProfile: { id: 'p1', userId: 'u1', festivalId: 'f1', picks: {}, notes: {}, updatedAt: '2026-01-01T00:00:00Z' },
      });
      useAuthStore.setState({ user: { id: 'u1' } as never });
      expect(renderHook(() => useCanPick()).result.current).toBe(true);
    });

    it('is true for a signed-in user with no profile on the chosen festival (first pick joins)', () => {
      useFestivalStore.setState({ currentFestivalId: 'f1', currentProfile: null });
      useAuthStore.setState({ user: { id: 'u1' } as never });
      expect(renderHook(() => useCanPick()).result.current).toBe(true);
    });

    it('is true for a guest who has chosen a festival, and false before that', () => {
      useAuthStore.setState({ user: null });
      expect(renderHook(() => useCanPick()).result.current).toBe(false);
      useFestivalStore.setState({ currentFestivalId: 'f1' });
      expect(renderHook(() => useCanPick()).result.current).toBe(true);
    });
  });

  describe('getMyPick', () => {
    it('returns undefined when no current profile', () => {
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyPick('set-1')).toBeUndefined();
    });

    it('returns the priority for a picked set', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: { 'set-1': 'must' },
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyPick('set-1')).toBe('must');
    });

    it('returns null for a set with no pick', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: {},
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyPick('set-1')).toBeNull();
    });

    it('handles null picks gracefully', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: null as unknown as Record<string, string>,
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      // Should not throw — the defensive `|| {}` guard covers this
      expect(result.current.getMyPick('set-1')).toBeNull();
    });
  });

  describe('getMyNote', () => {
    it('returns undefined when no current profile', () => {
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyNote('set-1')).toBeUndefined();
    });

    it('returns the note for a set', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: {},
          notes: { 'set-1': 'Front row!' },
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyNote('set-1')).toBe('Front row!');
    });

    it('handles null notes gracefully', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: {},
          notes: null as unknown as Record<string, string>,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getMyNote('set-1')).toBeUndefined();
    });
  });

  describe('getPickCount', () => {
    it('reads the anonymous server count and is 0 for an unknown set', () => {
      useFestivalStore.setState({ pickCounts: { 'set-1': 4 } });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getPickCount('set-1')).toBe(4);
      expect(result.current.getPickCount('set-2')).toBe(0);
    });

    it('is 0 when a rehydrated client has no pickCounts', () => {
      useFestivalStore.setState({ pickCounts: undefined as unknown as Record<string, number> });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getPickCount('set-1')).toBe(0);
    });
  });

  describe('getOtherPicks', () => {
    it('returns empty array when no current profile', () => {
      const { result } = renderHook(() => usePicks());
      expect(result.current.getOtherPicks('set-1')).toEqual([]);
    });

    it('returns other profiles picks for a set', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: { 'set-1': 'must' },
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
        allProfiles: [
          {
            id: 'p1',
            userId: 'u1',
            festivalId: 'f1',
            picks: { 'set-1': 'must' },
            notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p2',
            userId: 'u2',
            festivalId: 'f1',
            name: 'Bob',
            picks: { 'set-1': 'want-to-see' },
            notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p3',
            userId: 'u3',
            festivalId: 'f1',
            name: 'Carol',
            picks: {},
            notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { result } = renderHook(() => usePicks());
      const others = result.current.getOtherPicks('set-1');
      expect(others).toHaveLength(1);
      expect(others[0]).toEqual({
        profileId: 'p2',
        priority: 'want-to-see',
        name: 'Bob',
      });
    });

    it('excludes the current user from other picks', () => {
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1',
          userId: 'u1',
          festivalId: 'f1',
          picks: { 'set-1': 'must' },
          notes: {},
          updatedAt: '2026-01-01T00:00:00Z',
        },
        allProfiles: [
          {
            id: 'p1',
            userId: 'u1',
            festivalId: 'f1',
            picks: { 'set-1': 'must' },
            notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { result } = renderHook(() => usePicks());
      expect(result.current.getOtherPicks('set-1')).toEqual([]);
    });
  });

  describe('savePick', () => {
    it('calls store savePick with correct request', async () => {
      const mockSavePick = vi.fn().mockResolvedValue(undefined);
      useFestivalStore.setState({ savePick: mockSavePick } as never);
      const { result } = renderHook(() => usePicks());
      await act(async () => {
        await result.current.savePick('fest-1', 'set-1', 'must');
      });
      expect(mockSavePick).toHaveBeenCalledWith({
        festivalId: 'fest-1',
        setId: 'set-1',
        priority: 'must',
      });
    });
  });

  describe('removePick', () => {
    it('calls store removePick with correct args', async () => {
      const mockRemovePick = vi.fn().mockResolvedValue(undefined);
      useFestivalStore.setState({ removePick: mockRemovePick } as never);
      const { result } = renderHook(() => usePicks());
      await act(async () => {
        await result.current.removePick('fest-1', 'set-1');
      });
      expect(mockRemovePick).toHaveBeenCalledWith('fest-1', 'set-1');
    });
  });

  describe('saveNote', () => {
    it('calls store saveNote with correct request', async () => {
      const mockSaveNote = vi.fn().mockResolvedValue(undefined);
      useFestivalStore.setState({ saveNote: mockSaveNote } as never);
      const { result } = renderHook(() => usePicks());
      await act(async () => {
        await result.current.saveNote('fest-1', 'set-1', 'Great set!');
      });
      expect(mockSaveNote).toHaveBeenCalledWith({
        festivalId: 'fest-1',
        setId: 'set-1',
        note: 'Great set!',
      });
    });
  });

  describe('usePickSync', () => {
    it('returns only this set entry, and retry calls retryPick with the set id', async () => {
      const retryPick = vi.fn().mockResolvedValue(undefined);
      useFestivalStore.setState({
        pickSync: { 'set-1': { state: 'failed', priority: 'must' }, 'set-2': { state: 'saving', priority: null } },
        retryPick,
      } as never);
      const { result } = renderHook(() => usePickSync('set-1'));
      expect(result.current.sync).toEqual({ state: 'failed', priority: 'must' });
      await act(async () => {
        await result.current.retry();
      });
      expect(retryPick).toHaveBeenCalledWith('set-1');
    });

    it('returns undefined for a set with no write in progress', () => {
      useFestivalStore.setState({ pickSync: {} } as never);
      const { result } = renderHook(() => usePickSync('set-9'));
      expect(result.current.sync).toBeUndefined();
    });
  });

  describe('per-set hooks', () => {
    const profile = (picks: Record<string, string>, notes: Record<string, string> = {}) =>
      ({ id: 'p1', userId: 'u1', festivalId: 'f1', picks, notes, reminders: { a: 15 }, updatedAt: '2026-01-01T00:00:00Z' }) as never;

    it('useMyPick: undefined when canPick is false, null for no pick, the priority for a pick', () => {
      expect(renderHook(() => useMyPick('a')).result.current).toBeUndefined();
      useFestivalStore.setState({ currentFestivalId: 'f1', currentProfile: profile({ a: 'must' }) });
      expect(renderHook(() => useMyPick('a')).result.current).toBe('must');
      expect(renderHook(() => useMyPick('b')).result.current).toBeNull();
    });

    it('useMyPick: a guest sees the guest pick for the chosen festival', () => {
      useFestivalStore.setState({ currentFestivalId: 'f1', currentProfile: null, guestPicks: { f1: { a: 'maybe' } } } as never);
      expect(renderHook(() => useMyPick('a')).result.current).toBe('maybe');
    });

    it('useMyNote and useMyReminder read this set, undefined without a profile', () => {
      expect(renderHook(() => useMyNote('a')).result.current).toBeUndefined();
      expect(renderHook(() => useMyReminder('a')).result.current).toBeUndefined();
      useFestivalStore.setState({ currentFestivalId: 'f1', currentProfile: profile({}, { a: 'hi' }) });
      expect(renderHook(() => useMyNote('a')).result.current).toBe('hi');
      expect(renderHook(() => useMyReminder('a')).result.current).toBe(15);
    });

    it('a write to another set does not re-render useMyPick', () => {
      useFestivalStore.setState({ currentFestivalId: 'f1', currentProfile: profile({ a: 'must' }) });
      let renders = 0;
      const { result } = renderHook(() => {
        renders++;
        return useMyPick('a');
      });
      const before = renders;
      act(() => useFestivalStore.setState({ currentProfile: profile({ a: 'must', b: 'maybe' }) }));
      expect(renders).toBe(before);
      act(() => useFestivalStore.setState({ currentProfile: profile({ a: 'maybe', b: 'maybe' }) }));
      expect(result.current).toBe('maybe');
    });

    it('usePickActions keeps stable references across data writes and forwards requests', async () => {
      const savePick = vi.fn().mockResolvedValue(undefined);
      useFestivalStore.setState({ currentFestivalId: 'f1', currentProfile: profile({}), savePick } as never);
      const { result } = renderHook(() => usePickActions());
      const first = result.current;
      act(() => useFestivalStore.setState({ currentProfile: profile({ a: 'must' }) }));
      expect(result.current).toBe(first);
      await result.current.savePick('f1', 'a', 'must');
      expect(savePick).toHaveBeenCalledWith({ festivalId: 'f1', setId: 'a', priority: 'must' });
    });
  });
});
