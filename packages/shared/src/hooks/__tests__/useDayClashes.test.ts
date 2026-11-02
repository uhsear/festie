import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDayClashes } from '../useDayClashes';
import { useFestivalStore } from '../../stores/festivalStore';
import type { FestivalSet, Profile } from '../../types/domain';

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

const stamp = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const sets = [
  { id: 'a', festivalId: 'f', stageId: 's1', artist: 'Alpha', dayIndex: 0, startTime: '14:00', endTime: '15:00', ...stamp },
  { id: 'b', festivalId: 'f', stageId: 's2', artist: 'Beta', dayIndex: 0, startTime: '14:30', endTime: '15:30', ...stamp },
] as FestivalSet[];
const profile = {
  id: 'p1', userId: 'u1', festivalId: 'f', picks: { a: 'want-to-see', b: 'want-to-see' }, notes: {}, updatedAt: stamp.updatedAt,
} as Profile;

function seed(currentProfile: Profile | null) {
  useFestivalStore.setState({
    currentFestivalId: 'f',
    currentFestival: null,
    stages: [
      { id: 's1', name: 'Main Stage', festivalId: 'f', createdAt: stamp.createdAt },
      { id: 's2', name: 'Forest Stage', festivalId: 'f', createdAt: stamp.createdAt },
    ],
    sets,
    days: [{ id: 'd0', festivalId: 'f', date: '2026-06-15', ...stamp }],
    selectedDay: 0,
    currentProfile,
    allProfiles: [],
  });
}

describe('useDayClashes', () => {
  beforeEach(() => seed(null));

  it('counts a clash group and marks both sets', () => {
    seed(profile);
    const { result } = renderHook(() => useDayClashes());
    expect(result.current.count).toBe(1);
    expect([...result.current.marks.keys()].sort()).toEqual(['a', 'b']);
    expect(result.current.marks.get('a')!.text).toBe('Clashes with Beta · Forest Stage');
  });

  it('is empty without a profile', () => {
    const { result } = renderHook(() => useDayClashes());
    expect(result.current.count).toBe(0);
    expect(result.current.marks.size).toBe(0);
  });
});
