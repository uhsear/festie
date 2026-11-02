import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePicksPlan, picksOrderStorageKey } from '../usePicksPlan';
import { useFestivalStore } from '../../stores/festivalStore';
import type { FestivalSet, Priority } from '../../types/domain';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

const set = (id: string): FestivalSet => ({
  id,
  festivalId: 'f1',
  stageId: 'main',
  dayIndex: 0,
  startTime: '14:00',
  endTime: '15:00',
  artist: id,
  createdAt: '',
  updatedAt: '',
});

function seed(picks: Record<string, Priority>) {
  useFestivalStore.setState({
    currentFestival: null,
    stages: [{ id: 'main', name: 'Main Stage' }] as never,
    sets: [set('a'), set('b')],
    days: [{ id: 'd0', festivalId: 'f1', date: '2026-06-15', label: 'Fri', createdAt: '', updatedAt: '' }],
    currentProfile: { id: 'p1', userId: 'u1', festivalId: 'f1', picks, notes: {}, updatedAt: '' },
  });
}

describe('usePicksPlan', () => {
  beforeEach(() => seed({ a: 'must' }));

  it('toggleFilter twice returns to all', () => {
    const { result } = renderHook(() => usePicksPlan());
    act(() => result.current.toggleFilter('must'));
    expect(result.current.filter).toBe('must');
    expect(result.current.filtersActive).toBe(true);
    act(() => result.current.toggleFilter('must'));
    expect(result.current.filter).toBe('all');
  });

  it('clearFilters resets the filter and the search', () => {
    const { result } = renderHook(() => usePicksPlan());
    act(() => {
      result.current.toggleFilter('maybe');
      result.current.setSearch('zzz');
    });
    act(() => result.current.clearFilters());
    expect(result.current.filter).toBe('all');
    expect(result.current.search).toBe('');
    expect(result.current.filtersActive).toBe(false);
  });

  it('rows update when the store picks change', () => {
    const { result } = renderHook(() => usePicksPlan());
    expect(result.current.rows.filter((r) => r.kind === 'set')).toHaveLength(1);
    act(() => seed({ a: 'must', b: 'maybe' }));
    expect(result.current.rows.filter((r) => r.kind === 'set')).toHaveLength(2);
    expect(result.current.stats.total).toBe(2);
  });

  it('folds a group via toggleCollapsed', () => {
    const { result } = renderHook(() => usePicksPlan());
    act(() => result.current.toggleCollapsed('day-0'));
    expect(result.current.rows.map((r) => r.kind)).toEqual(['group']);
    act(() => result.current.toggleCollapsed('day-0'));
    expect(result.current.rows.length).toBeGreaterThan(1);
  });

  it('remembers the set order per festival on this device', async () => {
    localStorage.clear();
    useFestivalStore.setState({ currentFestival: { id: 'f1' } as never });
    const { result, unmount } = renderHook(() => usePicksPlan());
    expect(result.current.order).toBe('openers');
    act(() => result.current.setOrder('headliners'));
    await waitFor(() => expect(localStorage.getItem(picksOrderStorageKey('f1'))).toBe('headliners'));
    unmount();

    const again = renderHook(() => usePicksPlan());
    await waitFor(() => expect(again.result.current.order).toBe('headliners'));
    act(() => useFestivalStore.setState({ currentFestival: { id: 'f2' } as never }));
    await waitFor(() => expect(again.result.current.order).toBe('openers'));
  });
});
