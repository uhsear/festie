import { describe, it, expect } from 'vitest';
import { clashBadgeBySetId, detectConflicts, getConflictingSetIds, hasConflict, isHardConflict } from './conflicts';
import type { FestivalSet, Priority } from '../types/domain';

function makeSet(overrides: Partial<FestivalSet> & { id: string }): FestivalSet {
  return {
    festivalId: 'fest-1',
    stageId: 'stage-1',
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('detectConflicts', () => {
  it('returns empty array when no sets are picked', () => {
    const sets = [makeSet({ id: 's1' }), makeSet({ id: 's2' })];
    const getMyPick = () => undefined;
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
  });

  it('returns empty array for non-overlapping picked sets', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
  });

  it('detects overlapping picked sets', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'want-to-see' };
    const getMyPick = (id: string) => picks[id];
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.overlapMinutes).toBe(30);
  });

  it('does not duplicate conflicts (same pair)', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '16:00' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '17:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(1);
  });

  it('handles sets that wrap past midnight', () => {
    // A 23:00-01:00 set spans 1380-1500 minutes of its logical day.
    const sets = [
      makeSet({ id: 's1', startTime: '23:00', endTime: '01:00' }),
      makeSet({ id: 's2', startTime: '23:30', endTime: '00:30' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'maybe' };
    const getMyPick = (id: string) => picks[id];
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.overlapMinutes).toBe(60);
  });

  it('detects a clash with a set that starts after midnight on the same day', () => {
    // 00:30 belongs to the same night as 23:30 (06:00 rule), so it sits at 1470.
    const sets = [
      makeSet({ id: 's1', startTime: '23:30', endTime: '01:00', dayIndex: 0 }),
      makeSet({ id: 's2', startTime: '00:30', endTime: '01:30', dayIndex: 0 }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const conflicts = detectConflicts(sets, (id) => picks[id]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.overlapMinutes).toBe(30);
  });

  it('ignores sets without start/end time', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '', endTime: '' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
  });

  it('detects multiple conflicts among three sets', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:30' }),
      makeSet({ id: 's3', startTime: '16:00', endTime: '17:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must', s3: 'must' };
    const getMyPick = (id: string) => picks[id];
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(2);
  });
});

describe('hard conflicts (two must picks)', () => {
  const overlap: FestivalSet[] = [
    makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
    makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
  ];

  it('flags hard=true and carries priorities when both sides are must', () => {
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const [c] = detectConflicts(overlap, (id) => picks[id]);
    expect(c!.hard).toBe(true);
    expect(c!.priorityA && c!.priorityB).toBeTruthy();
    expect(isHardConflict(c!)).toBe(true);
  });

  it('flags hard=false when only one side is must', () => {
    const picks: Record<string, Priority> = { s1: 'must', s2: 'want-to-see' };
    const [c] = detectConflicts(overlap, (id) => picks[id]);
    expect(c!.hard).toBe(false);
    expect(isHardConflict(c!)).toBe(false);
  });

  it('flags hard=false for want/maybe overlaps', () => {
    const picks: Record<string, Priority> = { s1: 'want-to-see', s2: 'maybe' };
    const [c] = detectConflicts(overlap, (id) => picks[id]);
    expect(c!.hard).toBe(false);
  });
});

describe('getConflictingSetIds', () => {
  it('returns empty set when no conflicts', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '16:00', endTime: '17:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    const ids = getConflictingSetIds(sets, getMyPick);
    expect(ids.size).toBe(0);
  });

  it('returns both set IDs from a conflict', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    const ids = getConflictingSetIds(sets, getMyPick);
    expect(ids.has('s1')).toBe(true);
    expect(ids.has('s2')).toBe(true);
  });
});

describe('hasConflict', () => {
  it('returns false for a set with no conflicts', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '16:00', endTime: '17:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    expect(hasConflict('s1', sets, getMyPick)).toBe(false);
  });

  it('returns true for a set with a conflict', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:30' }),
      makeSet({ id: 's2', startTime: '15:00', endTime: '16:00' }),
    ];
    const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
    const getMyPick = (id: string) => picks[id];
    expect(hasConflict('s1', sets, getMyPick)).toBe(true);
  });
});

describe('multi-day conflict handling (S-3)', () => {
  const picks: Record<string, Priority> = { s1: 'must', s2: 'must' };
  const getMyPick = (id: string) => picks[id];

  it('does NOT flag the same clock time on different festival days', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }),
      makeSet({ id: 's2', startTime: '14:00', endTime: '15:00', dayIndex: 1 }),
    ];
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
    expect(getConflictingSetIds(sets, getMyPick).size).toBe(0);
  });

  it('still flags overlapping sets on the SAME day', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }),
      makeSet({ id: 's2', startTime: '14:30', endTime: '15:30', dayIndex: 0 }),
    ];
    expect(detectConflicts(sets, getMyPick)).toHaveLength(1);
  });

  it('falls back to time-only when dayIndex is absent (single-day festivals)', () => {
    const sets = [
      makeSet({ id: 's1', startTime: '14:00', endTime: '15:00' }),
      makeSet({ id: 's2', startTime: '14:30', endTime: '15:30' }),
    ];
    expect(detectConflicts(sets, getMyPick)).toHaveLength(1);
  });
});

describe('all-TBA festival (S-8) — no set has start/end times', () => {
  it('reports zero conflicts when every picked set is TBA', () => {
    const sets = [
      makeSet({ id: 's1', startTime: undefined, endTime: undefined }),
      makeSet({ id: 's2', startTime: undefined, endTime: undefined }),
      makeSet({ id: 's3', startTime: undefined, endTime: undefined }),
    ];
    const getMyPick = () => 'must' as Priority;
    expect(detectConflicts(sets, getMyPick)).toEqual([]);
    expect(getConflictingSetIds(sets, getMyPick).size).toBe(0);
  });

  it('reports only the timed overlaps in a mixed timed + TBA lineup', () => {
    const sets = [
      makeSet({ id: 'timed-a', startTime: '14:00', endTime: '15:00', dayIndex: 0 }),
      makeSet({ id: 'timed-b', startTime: '14:30', endTime: '15:30', dayIndex: 0 }),
      makeSet({ id: 'tba', startTime: undefined, endTime: undefined }),
    ];
    const getMyPick = () => 'must' as Priority;
    const conflicts = detectConflicts(sets, getMyPick);
    expect(conflicts).toHaveLength(1);
    const ids = [conflicts[0]!.setA.id, conflicts[0]!.setB.id].sort();
    expect(ids).toEqual(['timed-a', 'timed-b']);
  });
});

describe('clashBadgeBySetId', () => {
  const a = makeSet({ id: 'a', artist: 'A', startTime: '20:00', endTime: '21:00' });
  const b = makeSet({ id: 'b', artist: 'B', startTime: '20:30', endTime: '21:30' });
  const c = makeSet({ id: 'c', artist: 'C', startTime: '20:45', endTime: '22:00' });
  const d = makeSet({ id: 'd', artist: 'D', startTime: '21:05', endTime: '22:00' });

  it('names the other set and the overlap', () => {
    const badges = clashBadgeBySetId([{ setA: a, setB: b, overlapMinutes: 30 }]);
    expect(badges.get('a')!.label).toBe('Clashes with B (30 min)');
    expect(badges.get('b')!.label).toBe('Clashes with A (30 min)');
    expect(badges.get('a')).toMatchObject({
      otherSetId: 'b',
      otherName: 'B',
      overlapMinutes: 30,
      more: 0,
      tight: false,
    });
  });

  it('counts the other clashing sets and picks the largest overlap', () => {
    const badges = clashBadgeBySetId([
      { setA: a, setB: b, overlapMinutes: 30 },
      { setA: a, setB: c, overlapMinutes: 15 },
    ]);
    expect(badges.get('a')!.label).toBe('Clashes with B (30 min) +1');
  });

  it('breaks an overlap tie on the earlier-starting other set', () => {
    const badges = clashBadgeBySetId([
      { setA: a, setB: c, overlapMinutes: 15 },
      { setA: a, setB: b, overlapMinutes: 15 },
    ]);
    expect(badges.get('a')!.otherSetId).toBe('b');
  });

  it('labels a tight-only pair as a tight change', () => {
    const badges = clashBadgeBySetId([{ setA: a, setB: d, overlapMinutes: 0, tight: true }]);
    expect(badges.get('a')!.label).toBe('Tight change with D');
    expect(badges.get('a')!.tight).toBe(true);
  });

  it('ranks an overlap above a tight pair', () => {
    const badges = clashBadgeBySetId([
      { setA: a, setB: d, overlapMinutes: 0, tight: true },
      { setA: a, setB: b, overlapMinutes: 5 },
    ]);
    expect(badges.get('a')).toMatchObject({ otherSetId: 'b', tight: false, label: 'Clashes with B (5 min) +1' });
    expect(badges.get('d')!.label).toBe('Tight change with A');
  });
});
