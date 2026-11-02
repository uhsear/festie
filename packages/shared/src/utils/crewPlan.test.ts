import { describe, it, expect } from 'vitest';
import {
  pickActiveMeetingPoint,
  buildSlots,
  CREW_PLAN_SLOTS,
  crewScreenStatus,
  crewProfilesFor,
  groupSlotPicks,
  buildCrewMix,
  findFreeTogether,
  assignCrewColors,
  formatGapLength,
  crewOwnerInfo,
  crewFestivalName,
  memberSummary,
} from './crewPlan';
import { createDateInLocalFrame, getSetTimeBounds } from './setStatus';
import type { Crew, CrewMeetingPoint, Festival, FestivalDay, FestivalSet, Profile } from '../types/domain';

// ── Fixture helpers ────────────────────────────────────────────────────────
const mp = (over: Partial<CrewMeetingPoint>): CrewMeetingPoint =>
  ({
    id: 'mp',
    crew_id: 'c1',
    created_by: 'u1',
    label: 'Big tree',
    location: 'North field',
    type: 'custom',
    meet_at: null,
    stage_reference: null,
    ...over,
  }) as CrewMeetingPoint;

const day: FestivalDay = { date: '2026-09-04' } as FestivalDay;
// Device-local epoch-ms for a wall-clock time on the fixture day.
const at = (hh: number, mm = 0) => createDateInLocalFrame(day.date, hh, mm).getTime();

const set = (id: string, startTime: string, endTime: string): FestivalSet =>
  ({ id, stageId: 's1', dayIndex: 0, startTime, endTime } as unknown as FestivalSet);

const profile = (id: string, name: string, picks: Record<string, string>): Profile =>
  ({ id, userId: id, festivalId: 'f1', name, picks, notes: {}, updatedAt: '' } as unknown as Profile);

describe('pickActiveMeetingPoint', () => {
  const nowMs = at(12, 0);

  it('returns null for no points', () => {
    expect(pickActiveMeetingPoint([], nowMs)).toBeNull();
  });

  it('ignores inactive points', () => {
    const p = mp({ id: 'a', active: false, meet_at: new Date(at(15)).toISOString() } as Partial<CrewMeetingPoint>);
    expect(pickActiveMeetingPoint([p], nowMs)).toBeNull();
  });

  it('picks the soonest future-or-now timed point', () => {
    const later = mp({ id: 'later', active: true, meet_at: new Date(at(18)).toISOString() } as Partial<CrewMeetingPoint>);
    const soon = mp({ id: 'soon', active: true, meet_at: new Date(at(13)).toISOString() } as Partial<CrewMeetingPoint>);
    const past = mp({ id: 'past', active: true, meet_at: new Date(at(9)).toISOString() } as Partial<CrewMeetingPoint>);
    expect(pickActiveMeetingPoint([later, soon, past], nowMs)?.id).toBe('soon');
  });

  it('falls back to an active untimed point when no future timed point exists', () => {
    const past = mp({ id: 'past', active: true, meet_at: new Date(at(9)).toISOString() } as Partial<CrewMeetingPoint>);
    const standing = mp({ id: 'standing', active: true, meet_at: null });
    expect(pickActiveMeetingPoint([past, standing], nowMs)?.id).toBe('standing');
  });
});

describe('buildSlots', () => {
  const days = [day];
  const nowMs = at(12, 0);

  it('keeps only not-yet-ended sets and caps to the slot limit', () => {
    const sets = [
      set('past', '09:00', '10:00'), // ended before now → dropped
      set('a', '13:00', '14:00'),
      set('b', '15:00', '16:00'),
      set('c', '17:00', '18:00'),
      set('d', '19:00', '20:00'), // 4th distinct start → capped out (limit 3)
    ];
    const profiles = [
      profile('m1', 'Ann', { a: 'must', b: 'want-to-see', c: 'maybe', d: 'must' }),
    ];
    const slots = buildSlots(sets, days, profiles, nowMs);
    expect(slots).toHaveLength(CREW_PLAN_SLOTS);
    expect(slots.map((s) => s.startTime)).toEqual(['13:00', '15:00', '17:00']);
  });

  it('surfaces each member highest-priority pick, strongest first', () => {
    const sets = [set('a', '13:00', '14:00'), set('a2', '13:00', '14:00')];
    const profiles = [
      profile('m1', 'Ann', { a: 'maybe', a2: 'must' }), // best = must (a2)
      profile('m2', 'Bo', { a: 'want-to-see' }),
    ];
    const [slot] = buildSlots(sets, days, profiles, nowMs);
    expect(slot!.picks.map((p) => [p.memberName, p.priority])).toEqual([
      ['Ann', 'must'],
      ['Bo', 'want-to-see'],
    ]);
    expect(slot!.picks[0]!.set.id).toBe('a2');
  });

  it('honors a custom slot limit', () => {
    const sets = [set('a', '13:00', '14:00'), set('b', '15:00', '16:00')];
    const profiles = [profile('m1', 'Ann', { a: 'must', b: 'must' })];
    expect(buildSlots(sets, days, profiles, nowMs, 1)).toHaveLength(1);
  });

  it('anchors slot starts in the festival zone when one is passed', () => {
    const sets = [set('a', '13:00', '14:00')];
    const profiles = [profile('m1', 'Ann', { a: 'must' })];
    const [slot] = buildSlots(sets, days, profiles, Date.UTC(2026, 8, 4, 12, 0), CREW_PLAN_SLOTS, 'America/New_York');
    expect(slot!.startMs).toBe(getSetTimeBounds(sets[0]!, days, 'America/New_York')!.startMs);
    expect(slot!.startMs).toBe(Date.UTC(2026, 8, 4, 17, 0)); // 13:00 EDT
  });
});

describe('crewScreenStatus', () => {
  const base = { hasActiveCrew: false, crewCount: 0, loading: false, error: null as string | null };
  it('covers every branch', () => {
    expect(crewScreenStatus({ ...base, hasActiveCrew: true, crewCount: 1 })).toBe('ready');
    expect(crewScreenStatus({ ...base, loading: true })).toBe('loading');
    expect(crewScreenStatus({ ...base, error: 'x' })).toBe('error');
    expect(crewScreenStatus(base)).toBe('none');
    expect(crewScreenStatus({ ...base, crewCount: 2, error: 'x' })).toBe('error');
    expect(crewScreenStatus({ ...base, crewCount: 2 })).toBe('loading');
  });
});

describe('crewProfilesFor', () => {
  it('dedupes by userId and lets myProfile win', () => {
    const a1 = profile('p1', 'Ann', {});
    const a2 = { ...profile('p1b', 'Ann dup', {}), userId: 'p1' } as Profile;
    const b = profile('p2', 'Bo', {});
    const mine = { ...profile('p2', 'Bo mine', {}), picks: { z: 'must' } } as unknown as Profile;
    const out = crewProfilesFor([a1, a2, b, profile('p3', 'Out', {})], ['p1', 'p2'], mine);
    expect(out.map((p) => p.name)).toEqual(['Ann', 'Bo mine']);
  });
});

describe('groupSlotPicks and memberSummary', () => {
  it('merges two members on one set and keeps the strongest priority', () => {
    const s = set('a', '13:00', '14:00');
    const g = groupSlotPicks([
      { memberId: 'm1', memberName: 'Ann', set: s, priority: 'maybe' },
      { memberId: 'm2', memberName: 'Bo', set: s, priority: 'must' },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ priority: 'must', names: ['Ann', 'Bo'], memberIds: ['m1', 'm2'] });
  });
  it('summarises names', () => {
    expect(memberSummary(['Ana', 'Ben', 'C', 'D', 'E'])).toBe('Ana, Ben +3');
    expect(memberSummary(['Ana'])).toBe('Ana');
  });
});

describe('buildCrewMix', () => {
  const days = [day];
  const sets = [set('a', '13:00', '14:00'), set('b', '15:00', '16:00'), set('c', '17:00', '18:00'), set('d', '09:00', '10:00')];
  it('ranks by count, then weight, drops ended sets and honours minCount', () => {
    const profiles = [
      profile('m1', 'Ann', { a: 'must', b: 'must', c: 'maybe', d: 'must' }),
      profile('m2', 'Bo', { a: 'maybe', b: 'must', c: 'maybe', d: 'must' }),
      profile('m3', 'Cy', { a: 'maybe' }),
    ];
    const all = buildCrewMix({ sets, days, profiles });
    // a has 3 pickers; d and b tie on weight 6 so start time orders d first; c has weight 2.
    expect(all.map((e) => e.set.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(all[0]).toMatchObject({ count: 3, total: 3, topPriority: 'must' });
    expect(buildCrewMix({ sets, days, profiles, nowMs: at(12) }).map((e) => e.set.id)).toEqual(['a', 'b', 'c']);
    expect(buildCrewMix({ sets, days, profiles, minCount: 3 }).map((e) => e.set.id)).toEqual(['a']);
  });
});

describe('findFreeTogether', () => {
  const days = [day];
  const sets = [set('a', '13:00', '14:00'), set('b', '15:00', '16:00'), set('c', '16:20', '17:00'), set('x', '20:00', '21:00')];
  const profiles = [profile('m1', 'Ann', { a: 'must', b: 'must' }), profile('m2', 'Bo', { c: 'maybe', x: 'must' })];
  it('finds a 60-minute gap and ignores a 20-minute gap', () => {
    const gaps = findFreeTogether({ sets, days, profiles, dayIndex: 0 });
    expect(gaps.map((g) => g.minutes)).toEqual([60, 180]);
    expect(gaps[0]!.startMs).toBe(at(14));
  });
  it('returns [] with no picks', () => {
    expect(findFreeTogether({ sets, days, profiles: [profile('m1', 'Ann', {})], dayIndex: 0 })).toEqual([]);
  });
  it('clips a gap at nowMs', () => {
    const gaps = findFreeTogether({ sets, days, profiles, dayIndex: 0, nowMs: at(14, 20) });
    expect(gaps[0]!.minutes).toBe(40);
    expect(gaps[0]!.startMs).toBe(at(14, 20));
    expect(findFreeTogether({ sets, days, profiles, dayIndex: 0, nowMs: at(14, 40) }).map((g) => g.minutes)).toEqual([180]);
  });
  it('handles a set after midnight in the festival zone', () => {
    const night = [set('n1', '22:00', '23:00'), set('n2', '01:00', '02:00')];
    const ps = [profile('m1', 'Ann', { n1: 'must', n2: 'must' })];
    const [gap] = findFreeTogether({ sets: night, days, profiles: ps, dayIndex: 0, timeZone: 'America/New_York' });
    expect(gap!.minutes).toBe(120);
    expect(gap!.startMs).toBe(Date.UTC(2026, 8, 5, 3, 0)); // 23:00 EDT
  });
});

describe('formatGapLength and assignCrewColors', () => {
  it('formats gaps', () => {
    expect(formatGapLength(45)).toBe('45 min');
    expect(formatGapLength(60)).toBe('1 h');
    expect(formatGapLength(75)).toBe('1 h 15 min');
  });
  it('gives distinct, stable colours', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `id${i}`);
    const c = assignCrewColors(ids);
    expect(new Set(Object.values(c)).size).toBe(9);
    expect(assignCrewColors(ids)).toEqual(c);
  });
});

describe('crewOwnerInfo and crewFestivalName', () => {
  const crew = { id: 'c1', owner: 'u1', festivalId: 'f2', members: [] } as unknown as Crew;
  it('reads the owner', () => {
    const members = [{ userId: 'u1', username: 'sam', role: 'owner' }, { userId: 'u2', name: 'Bo' }];
    expect(crewOwnerInfo(crew, members as never, 'u2')).toEqual({ isOwner: false, ownerName: 'sam' });
    expect(crewOwnerInfo(crew, members as never, 'u1').isOwner).toBe(true);
    expect(crewOwnerInfo(crew, [], 'u2')).toEqual({ isOwner: false, ownerName: null });
  });
  it('falls back for the festival name', () => {
    const f = (id: string, name: string) => ({ id, name }) as Festival;
    expect(crewFestivalName(crew, [f('f2', 'Two')], f('f1', 'One'))).toBe('Two');
    expect(crewFestivalName(crew, [], f('f2', 'Cur'))).toBe('Cur');
    expect(crewFestivalName(crew, [], f('f1', 'One'))).toBeNull();
    expect(crewFestivalName({ festivalId: undefined }, [], f('f1', 'One'))).toBe('One');
    expect(crewFestivalName(null, [], null)).toBeNull();
  });
});
