import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCrewCompare } from '../useCrewCompare';
import { useCrewStore } from '../../stores/crewStore';
import { useFestivalDataStore } from '../../stores/festivalDataStore';
import { useFestivalUIStore } from '../../stores/festivalUIStore';
import { findFreeTogether } from '../../utils/crewPlan';
import { buildCrewSplits } from '../../utils/pickConflicts';

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
  useCrewStore.setState({ crewDays: [] });
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

  it('with no crew days has an empty notThere and every member', () => {
    const { result } = renderHook(() => useCrewCompare('time'));
    expect(result.current.notThere).toEqual([]);
    expect(result.current.columns).toHaveLength(3);
  });

  it('hides a member who said no on that day only, and names them in notThere', () => {
    useCrewStore.setState({ crewDays: [{ userId: 'bo', dayIndex: 1, answer: 'no' }] });
    useFestivalUIStore.setState({ selectedDay: 1 });
    const day1 = renderHook(() => useCrewCompare('time')).result.current;
    expect(day1.columns.map((c) => c.profileId)).toEqual(['me', 'cy']);
    expect(day1.notThere.map((c) => c.profileId)).toEqual(['bo']);
    expect(day1.rows).toEqual([]);

    useFestivalUIStore.setState({ selectedDay: 0 });
    const day0 = renderHook(() => useCrewCompare('time')).result.current;
    expect(day0.columns.map((c) => c.profileId)).toEqual(['me', 'bo', 'cy']);
    expect(day0.notThere).toEqual([]);
  });

  it('keeps maybe members and always keeps my own column', () => {
    useCrewStore.setState({
      crewDays: [
        { userId: 'bo', dayIndex: 0, answer: 'maybe' },
        { userId: 'me', dayIndex: 0, answer: 'no' },
      ],
    });
    const { result } = renderHook(() => useCrewCompare('time'));
    expect(result.current.columns.map((c) => c.profileId)).toEqual(['me', 'bo', 'cy']);
    expect(result.current.notThere).toEqual([]);
  });

  it('drops an absent member from rows and the mix rank', () => {
    useCrewStore.setState({ crewDays: [{ userId: 'bo', dayIndex: 0, answer: 'no' }] });
    const { result } = renderHook(() => useCrewCompare('mix'));
    expect(result.current.rows.find((r) => r.set.id === 'late')?.pickers).toBe(2);
    expect(result.current.rows.find((r) => r.set.id === 'early')?.pickers).toBe(1);
  });

  describe('split, together and free slots', () => {
    // Day 0: bo's "clash" overlaps "late", so bo splits from the crew. Day 1: bo's "other-day" fills 13:00-14:00.
    const daySets = [
      set('early', 0, '13:00', '14:00'),
      set('late', 0, '16:00', '17:00'),
      set('clash', 0, '16:30', '17:30'),
      set('solo', 0, '20:00', '21:00'),
      set('other-day', 1, '13:00', '14:00'),
      set('d1-end', 1, '16:00', '17:00'),
    ];
    const me = profile('me', { early: 'maybe', late: 'must', solo: 'must', 'd1-end': 'must' });
    const bo = profile('bo', { early: 'maybe', late: 'must', clash: 'must', 'other-day': 'must' });
    const cy = profile('cy', { late: 'want-to-see', 'd1-end': 'want-to-see' });
    const days = [{ date: '2026-09-04' }, { date: '2026-09-05' }];
    const memberIdsOf = (c: ReturnType<typeof useCrewCompare>) => [
      ...c.split.flatMap((s) => s.sides.flatMap((side) => side.memberIds)),
      ...c.together.flatMap((t) => t.memberIds),
    ];
    const run = (day: number) => {
      useFestivalUIStore.setState({ selectedDay: day });
      return renderHook(() => useCrewCompare('time')).result.current;
    };

    beforeEach(() => {
      // Free slots never start before now, so pin now before the festival.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
      useFestivalDataStore.setState({
        days: days as never,
        sets: daySets as never,
        allProfiles: [bo, cy, me] as never,
        currentProfile: me as never,
      } as never);
    });
    afterEach(() => vi.useRealTimers());

    it('with no crew days matches the full crew, as before crew days existed', () => {
      const baseline = run(0);
      const full = { sets: daySets as never, days: days as never, profiles: [me, bo, cy] as never, dayIndex: 0 };
      expect(baseline.notThere).toEqual([]);
      expect({ split: baseline.split, together: baseline.together }).toEqual(buildCrewSplits(full));
      expect(baseline.freeTogether).toEqual(findFreeTogether({ ...full, nowMs: Date.now() }));
      expect(baseline.split).toHaveLength(1);
      expect(memberIdsOf(baseline)).toContain('bo');

      // Answers that keep everyone there change nothing at all.
      useCrewStore.setState({
        crewDays: [
          { userId: 'bo', dayIndex: 0, answer: 'going' },
          { userId: 'cy', dayIndex: 0, answer: 'maybe' },
          { userId: 'bo', dayIndex: 1, answer: 'no' },
        ],
      });
      expect(run(0)).toEqual(baseline);
    });

    it('leaves a member who said no out of split, together and free slots on that day only', () => {
      const before0 = run(0);
      const before1 = run(1);
      expect(before0.freeTogether.map((f) => f.minutes)).toEqual([120, 150]);
      expect(before1.freeTogether.map((f) => f.minutes)).toEqual([120]);

      useCrewStore.setState({ crewDays: [{ userId: 'bo', dayIndex: 0, answer: 'no' }] });
      const day0 = run(0);
      expect(day0.split).toEqual([]);
      expect(day0.together.map((t) => [t.set.id, t.memberIds])).toEqual([['late', ['me', 'cy']]]);
      expect(memberIdsOf(day0)).not.toContain('bo');
      // Without bo's "clash", the evening gap starts when "late" ends.
      expect(day0.freeTogether.map((f) => f.minutes)).toEqual([120, 180]);

      // Day 1 is unchanged: bo still fills 13:00-14:00.
      expect(run(1)).toEqual(before1);
    });
  });

  it('keeps colours across re-renders', () => {
    const { result, rerender } = renderHook(() => useCrewCompare('time'));
    const first = result.current.columns.map((c) => c.color);
    rerender();
    expect(result.current.columns.map((c) => c.color)).toEqual(first);
    expect(new Set(first).size).toBe(3);
  });
});
