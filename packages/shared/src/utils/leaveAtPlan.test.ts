import { describe, it, expect } from 'vitest';
import { buildLeaveAtPlan, DEFAULT_WALK_MIN } from './leaveAtPlan';
import { leaveAtCopy, leaveAtHardCopy } from '../constants/copy';
import type { FestivalDay, FestivalSet } from '../types/domain';

const days = [
  { id: 'd0', festivalId: 'f', date: '2026-05-01' },
  { id: 'd1', festivalId: 'f', date: '2026-05-02' },
] as unknown as FestivalDay[];
const CHI = 'America/Chicago'; // CDT, UTC-5 in May
const set = (o: Partial<FestivalSet> & { id: string }): FestivalSet =>
  ({ festivalId: 'f', stageId: 'sa', dayIndex: 0, startTime: '21:00', endTime: '22:00', ...o }) as FestivalSet;
// 0.0047 deg of latitude is ~523 m, a 7 min walk
const stages = [
  { id: 'sa', latitude: 41.0, longitude: -87.0 },
  { id: 'sb', latitude: 41.0047, longitude: -87.0 },
];
const longA = set({ id: 'a', startTime: '21:00', endTime: '22:30' });
const longB = set({ id: 'b', stageId: 'sb', startTime: '21:30', endTime: '23:00' });

describe('buildLeaveAtPlan', () => {
  it('splits a long overlap evenly and uses the real walk time', () => {
    const r = buildLeaveAtPlan({ a: longA, b: longB, days, timeZone: CHI, stages });
    // overlap 60, walk 7, avail 53, first share 26 => leave 21:56 CDT
    expect(r).toMatchObject({
      kind: 'plan', walkMin: 7, walkEstimated: false, leaveAtLabel: '9:56 PM', catchMin: 57,
      leaveAtMs: Date.UTC(2026, 4, 2, 2, 56),
    });
    if (r?.kind !== 'plan') return;
    expect(r.stayAt.id).toBe('a');
    expect(r.thenSet.id).toBe('b');
  });

  it('gives the same plan whichever order the pair is passed in', () => {
    expect(buildLeaveAtPlan({ a: longB, b: longA, days, timeZone: CHI, stages })).toEqual(
      buildLeaveAtPlan({ a: longA, b: longB, days, timeZone: CHI, stages }),
    );
  });

  it('gives the stronger priority two thirds of the time', () => {
    const base = { a: longA, b: longB, days, timeZone: CHI, stages };
    // avail 53: strong first set stays 36 min (22:06); strong second set leaves first after 17 (21:47)
    expect(buildLeaveAtPlan({ ...base, priorityA: 'must', priorityB: 'maybe' }))
      .toMatchObject({ kind: 'plan', leaveAtLabel: '10:06 PM' });
    expect(buildLeaveAtPlan({ ...base, priorityA: 'maybe', priorityB: 'must' }))
      .toMatchObject({ kind: 'plan', leaveAtLabel: '9:47 PM' });
  });

  it('falls back to a default walk when a stage has no pin', () => {
    const r = buildLeaveAtPlan({ a: longA, b: set({ ...longB, stageId: 'sz' }), days, timeZone: CHI, stages });
    expect(r).toMatchObject({ kind: 'plan', walkMin: DEFAULT_WALK_MIN, walkEstimated: true });
  });

  it('uses zero walk on the same stage', () => {
    const r = buildLeaveAtPlan({ a: longA, b: set({ ...longB, stageId: 'sa' }), days, timeZone: CHI, stages });
    expect(r).toMatchObject({ kind: 'plan', walkMin: 0, walkEstimated: false });
  });

  it('is a hard choice when the overlap is too short after walking', () => {
    const b = set({ id: 'b', stageId: 'sz', startTime: '21:30', endTime: '23:00' });
    // overlap 25 - walk 5 = 20: exactly 10 each, still a plan
    expect(buildLeaveAtPlan({ a: set({ id: 'a', endTime: '21:55' }), b, days, timeZone: CHI })?.kind).toBe('plan');
    expect(buildLeaveAtPlan({ a: set({ id: 'a', endTime: '21:54' }), b, days, timeZone: CHI }))
      .toEqual({ kind: 'hard', overlapMin: 24 });
  });

  it('is a hard choice when one set is nested in the other', () => {
    const r = buildLeaveAtPlan({
      a: set({ id: 'a', startTime: '20:00', endTime: '23:00' }),
      b: set({ id: 'b', startTime: '21:00', endTime: '22:00' }),
      days, timeZone: CHI,
    });
    expect(r).toEqual({ kind: 'hard', overlapMin: 60 });
  });

  it('returns null for back-to-back sets, other days, or unresolvable times', () => {
    const a = set({ id: 'a' });
    expect(buildLeaveAtPlan({ a, b: set({ id: 'b', startTime: '22:00', endTime: '23:00' }), days, timeZone: CHI })).toBeNull();
    expect(buildLeaveAtPlan({ a, b: set({ id: 'b', dayIndex: 1 }), days, timeZone: CHI })).toBeNull();
    expect(buildLeaveAtPlan({ a, b: set({ id: 'b' }), days: [] })).toBeNull();
  });

  it('handles sets that run past midnight', () => {
    const r = buildLeaveAtPlan({
      a: set({ id: 'a', startTime: '23:00', endTime: '01:00' }),
      b: set({ id: 'b', stageId: 'sz', startTime: '23:30', endTime: '01:30' }),
      days, timeZone: CHI,
    });
    // overlap 90, walk 5, avail 85, first share 42 => 00:12 on the next calendar day
    expect(r).toMatchObject({ kind: 'plan', leaveAtLabel: '12:12 AM', leaveAtMs: Date.UTC(2026, 4, 2, 5, 12) });
    // a 00:30 start belongs to the previous logical day (getSetTimeBounds 06:00 rule)
    const early = buildLeaveAtPlan({
      a: set({ id: 'a', startTime: '23:00', endTime: '02:00' }),
      b: set({ id: 'b', stageId: 'sz', startTime: '00:30', endTime: '03:00' }),
      days, timeZone: CHI,
    });
    expect(early?.kind).toBe('plan');
  });

  it('labels the time in the festival zone, not the device zone', () => {
    const a = set({ id: 'a', endTime: '22:30' });
    const b = set({ id: 'b', startTime: '21:30', endTime: '23:00' });
    const chi = buildLeaveAtPlan({ a, b, days, timeZone: CHI });
    const la = buildLeaveAtPlan({ a, b, days, timeZone: 'America/Los_Angeles' });
    if (chi?.kind !== 'plan' || la?.kind !== 'plan') throw new Error('expected plans');
    // overlap 60, same stage, first share 30 => 22:00 wall time in each zone
    expect(chi.leaveAtLabel).toBe('10:00 PM');
    expect(la.leaveAtLabel).toBe('10:00 PM');
    expect(la.leaveAtMs - chi.leaveAtMs).toBe(2 * 3600_000);
  });
});

describe('leave-at copy', () => {
  it('reads as a plan and never says conflict', () => {
    const o = { stayName: 'A', thenName: 'B', leaveAt: '10:14 PM', walk: '6 min', catchFor: '40 min' };
    expect(leaveAtCopy(o)).toBe('Stay at A until 10:14 PM, walk about 6 min, catch the last 40 min of B.');
    expect(leaveAtCopy({ ...o, walk: 'now' })).toContain('head over');
    expect(leaveAtHardCopy(20).toLowerCase()).not.toContain('conflict');
  });
});
