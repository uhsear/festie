import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSetMove } from '../useSetMove';
import { useFestivalDataStore } from '../../stores/festivalDataStore';
import { useFestivalUIStore } from '../../stores/festivalUIStore';
import type { FestivalSet } from '../../types';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));
vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

const base = {
  id: 'set-1', festivalId: 'f1', stageId: 's1', startTime: '22:30', endTime: '23:30',
  artist: 'A', dayIndex: 1, createdAt: '', updatedAt: '',
} as FestivalSet;
const moved: FestivalSet = {
  ...base,
  movedAt: new Date().toISOString(),
  movedFrom: { dayIndex: 1, stageId: 's1', start: '22:00', end: '23:00' },
};

beforeEach(() => {
  useFestivalDataStore.setState({
    days: [
      { id: 'd1', festivalId: 'f1', date: '2026-09-04', label: 'Fri', createdAt: '', updatedAt: '' },
      { id: 'd2', festivalId: 'f1', date: '2026-09-05', label: 'Sat', createdAt: '', updatedAt: '' },
    ],
    stages: [{ id: 's1', name: 'Sahara', color: '#f00', festivalId: 'f1', createdAt: '', updatedAt: '' }],
  } as never);
  useFestivalUIStore.setState({ searchQuery: '' } as never);
});

describe('useSetMove', () => {
  it('returns the line for a fresh mark', () => {
    const { result } = renderHook(() => useSetMove(moved));
    expect(result.current?.line).toBe('Moved from Sat 10:00 PM, Sahara');
  });

  it('returns null with no mark, or no set', () => {
    expect(renderHook(() => useSetMove(base)).result.current).toBeNull();
    expect(renderHook(() => useSetMove(null)).result.current).toBeNull();
  });

  it('does not re-render on a searchQuery change', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useSetMove(moved);
    });
    const before = renders;
    act(() => useFestivalUIStore.setState({ searchQuery: 'x' }));
    expect(renders).toBe(before);
  });
});
