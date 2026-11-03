import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAlsoPlays } from '../useAlsoPlays';
import { useFestivalStore } from '../../stores/festivalStore';
import type { FestivalDay, FestivalSet } from '../../types/domain';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));
vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

const DAYS: FestivalDay[] = [
  { id: 'd0', festivalId: 'f1', date: '2026-06-12', createdAt: '', updatedAt: '' },
  { id: 'd1', festivalId: 'f1', date: '2026-06-13', createdAt: '', updatedAt: '' },
  { id: 'd2', festivalId: 'f1', date: '2026-06-14', createdAt: '', updatedAt: '' },
];
const mk = (id: string, dayIndex: number): FestivalSet => ({
  id, festivalId: 'f1', stageId: 'main', dayIndex, startTime: '20:00', endTime: '21:00', artist: 'Act', createdAt: '', updatedAt: '',
});
const SETS = [mk('s0', 0), mk('s1', 1), mk('s2', 2)];

beforeEach(() => {
  useFestivalStore.setState({
    currentFestival: {
      id: 'f1', name: 'Fest', startDate: '2026-06-12', endDate: '2026-06-14', timeZone: 'UTC', createdAt: '', updatedAt: '',
    },
    sets: SETS,
    days: DAYS,
  } as never);
});

describe('useAlsoPlays', () => {
  it('lists the other open slots of the act', () => {
    const { result } = renderHook(() => useAlsoPlays(SETS[0]!, Date.UTC(2026, 5, 1)));
    expect(result.current.map((s) => s.set.id)).toEqual(['s1', 's2']);
  });

  it('returns [] for a null set', () => {
    const { result } = renderHook(() => useAlsoPlays(null, Date.UTC(2026, 5, 1)));
    expect(result.current).toEqual([]);
  });

  it('drops an ended slot when the clock moves on', () => {
    let now = Date.UTC(2026, 5, 1);
    const { result, rerender } = renderHook(() => useAlsoPlays(SETS[0]!, now));
    expect(result.current).toHaveLength(2);
    now = Date.UTC(2026, 5, 13, 22);
    rerender();
    expect(result.current.map((s) => s.set.id)).toEqual(['s2']);
  });
});
