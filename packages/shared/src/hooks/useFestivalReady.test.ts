// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { configureStorage, type StorageAdapter } from '../platform/storage';
import { useAuthStore } from '../stores/authStore';
import { useCrewStore } from '../stores/crewStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useNotificationPrefsStore } from '../stores/notificationPrefsStore';
import { useOfflineReadinessStore } from '../stores/offlineReadinessStore';
import { useFestivalReady } from './useFestivalReady';

const NOW = new Date('2026-06-15T12:00:00Z');
const upcoming = { id: 'f1', name: 'Soon', startDate: '2026-06-22', endDate: '2026-06-24' };
const live = { id: 'f2', name: 'Now', startDate: '2026-06-14', endDate: '2026-06-16' };

const loadPrefs = vi.fn().mockResolvedValue(undefined);
let mem: Map<string, string>;

function setup(festival: typeof upcoming | null, { user = true, loaded = true } = {}) {
  useAuthStore.setState({ user: user ? ({ id: 'u1' } as never) : null });
  useFestivalDataStore.setState({ currentFestival: festival as never, currentProfile: null, days: [] });
  useCrewStore.setState({ crews: [] } as never);
  useOfflineReadinessStore.setState({ byFestival: {} });
  useNotificationPrefsStore.setState({ loaded, loadPrefs } as never);
}

describe('useFestivalReady', () => {
  beforeEach(() => {
    mem = new Map();
    const adapter: StorageAdapter = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        mem.set(k, v);
      },
      removeItem: (k) => {
        mem.delete(k);
      },
    };
    configureStorage(adapter);
    loadPrefs.mockClear();
  });

  it('is not visible to a signed-out user', async () => {
    setup(upcoming, { user: false });
    const { result } = renderHook(() => useFestivalReady(false, NOW));
    await act(async () => {});
    expect(result.current.visible).toBe(false);
  });

  it('is visible before the festival once the hidden flag resolves', async () => {
    setup(upcoming);
    const { result } = renderHook(() => useFestivalReady(false, NOW));
    expect(result.current.visible).toBe(false);
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.progressLabel).toBe('0 of 4 done');
  });

  it('is not visible while the festival is in progress', async () => {
    setup(live);
    const { result } = renderHook(() => useFestivalReady(false, NOW));
    await act(async () => {});
    expect(result.current.visible).toBe(false);
  });

  it('hide() hides, persists, and stays hidden on a new render', async () => {
    setup(upcoming);
    const { result } = renderHook(() => useFestivalReady(false, NOW));
    await waitFor(() => expect(result.current.visible).toBe(true));
    act(() => result.current.hide());
    expect(result.current.visible).toBe(false);
    await waitFor(() => expect(mem.get('festie_ready_hidden:f1')).toBe('1'));
    const again = renderHook(() => useFestivalReady(false, NOW));
    await act(async () => {});
    expect(again.result.current.visible).toBe(false);
  });

  it('is not visible when all four items are done', async () => {
    setup(upcoming);
    useFestivalDataStore.setState({ currentProfile: { picks: { s1: 'must' } } as never });
    useCrewStore.setState({ crews: [{ id: 'c1' }] } as never);
    const ok = { status: 'ready' as const, syncedAt: 1 };
    useOfflineReadinessStore.setState({
      byFestival: { f1: { schedule: ok, picks: ok, crew: ok, weather: ok, art: ok } },
    });
    const { result } = renderHook(() => useFestivalReady(true, NOW));
    await act(async () => {});
    expect(result.current.doneCount).toBe(4);
    expect(result.current.visible).toBe(false);
  });

  it('loads prefs once when they are not loaded', async () => {
    setup(upcoming, { loaded: false });
    const { rerender } = renderHook(() => useFestivalReady(false, NOW));
    rerender();
    await act(async () => {});
    expect(loadPrefs).toHaveBeenCalledTimes(1);
  });
});
