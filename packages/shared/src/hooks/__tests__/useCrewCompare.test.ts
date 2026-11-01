import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCrewCompare } from '../useCrewCompare';
import { useCrewStore } from '../../stores/crewStore';
import { useFestivalDataStore } from '../../stores/festivalDataStore';
import { useFestivalUIStore } from '../../stores/festivalUIStore';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({ resetAllStores: vi.fn() }));

const set = (id: string, dayIndex: number, startTime: string, endTime: string) => ({
  id,
  stageId: 'st',
  dayIndex,
  date: dayIndex === 0 ? '2026-09-04' : '2026-09-05',
  startTime,
  endTime,
});
const profile = (id: string, picks: Record<string, string>) => ({ id, userId: id, name: id, picks });

beforeEach(() => {
  const me = profile('me', { early: 'maybe', late: 'must', solo: 'must' });
  useCrewStore.setState({
    activeCrew: null,
    crewMembers: [{ userId: 'bo' }, { userId: 'cy' }, { userId: 'me' }],
  } as never);
  useFestivalDataStore.setState({
    currentFestival: { id: 'f1', name: 'F' } as never,
    days: [{ date: '2026-09-04' }, { date: '2026-09-05' }] as never,
    sets: [
      set('early', 0, '13:00', '14:00'),
      set('late', 0, '16:00', '17:00'),
      set('solo', 0, '20:00', '21:00'),
      set('other-day', 1, '13:00', '14:00'),
    ] as never,
    allProfiles: [
      profile('bo', { late: 'must', early: 'maybe', 'other-day': 'must' }),
      profile('cy', { late: 'want-to-see' }),
      me,
    ] as never,
    currentProfile: me as never,
  } as never);
  useFestivalUIStore.setState({ selectedDay: 0 });
});

describe('useCrewCompare', () => {
  it('puts me first and skips other days', () => {
    const { result } = renderHook(() => useCrewCompare('time'));
    expect(result.current.columns.map((c) => [c.profileId, c.isMe])).toEqual([
      ['me', true],
      ['bo', false],
      ['cy', false],
    ]);
    expect(result.current.rows.map((r) => r.set.id)).toEqual(['early', 'late', 'solo']);
  });

  it("sort 'mix' puts 3 pickers before 1", () => {
    const { result } = renderHook(() => useCrewCompare('mix'));
    expect(result.current.rows.map((r) => r.set.id)).toEqual(['late', 'early', 'solo']);
    expect(result.current.rows[0]).toMatchObject({ pickers: 3, topPriority: 'must', mine: 'must' });
  });

  it('keeps colours across re-renders', () => {
    const { result, rerender } = renderHook(() => useCrewCompare('time'));
    const first = result.current.columns.map((c) => c.color);
    rerender();
    expect(result.current.columns.map((c) => c.color)).toEqual(first);
    expect(new Set(first).size).toBe(3);
  });
});
