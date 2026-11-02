import { describe, it, expect } from 'vitest';
import { alsoPlaysSlots, artistKey, catchInsteadOption, planCatchInstead } from './alsoPlays';
import { buildPickConflicts } from './pickConflicts';
import { invertChange } from './clashPlan';
import type { FestivalDay, FestivalSet, Priority } from '../types/domain';

const day = (i: number, date: string): FestivalDay => ({ id: `d${i}`, festivalId: 'f1', date, createdAt: '', updatedAt: '' });
// 2026-06-12 Fri, 06-13 Sat, 06-14 Sun
const DAYS = [day(0, '2026-06-12'), day(1, '2026-06-13'), day(2, '2026-06-14')];

function mk(id: string, artist: string, dayIndex: number | undefined, startTime?: string, endTime?: string, extra: Partial<FestivalSet> = {}): FestivalSet {
  return { id, festivalId: 'f1', stageId: 'main', dayIndex, startTime, endTime, artist, createdAt: '', updatedAt: '', ...extra } as FestivalSet;
}

const NOW = Date.UTC(2026, 5, 1);
const o = { days: DAYS, timeZone: 'UTC', nowMs: NOW };

describe('artistKey', () => {
  it('normalises case and spaces', () => {
    expect(artistKey({ artist: '  Foo   Bar ' })).toBe('foo bar');
    expect(artistKey({ artist: '' })).toBe('');
  });
  it('splits a b2b string, in order', () => {
    expect(artistKey({ artist: 'A  B2B  B' })).toBe('a|b');
    expect(artistKey({ artist: 'A b2b B' })).not.toBe(artistKey({ artist: 'B b2b A' }));
    expect(artistKey({ artist: 'A' })).not.toBe(artistKey({ artist: 'A b2b B' }));
  });
  it('uses artists when present', () => {
    expect(artistKey({ artist: 'x', artists: [{ name: 'a' }, { name: 'b' }] } as never)).toBe('a|b');
    expect(artistKey({ artist: 'A  B2B  B' })).toBe(artistKey({ artist: 'x', artists: [{ name: 'a' }, { name: 'b' }] } as never));
  });
  it('honours a custom separator', () => {
    expect(artistKey({ artist: 'A x B' }, 'x')).toBe('a|b');
  });
});

describe('alsoPlaysSlots', () => {
  const base = mk('s1', 'Act', 0, '20:00', '21:00');

  it('returns only open slots, earliest first, with labels', () => {
    const sets = [
      base,
      mk('s3', 'Act', 2, '21:00', '22:00'),
      mk('s2', 'Act', 1, '21:00', '22:00'),
      mk('ended', 'Act', 0, '10:00', '11:00', { id: 'ended' }),
      mk('other', 'Other', 1, '21:00', '22:00'),
      mk('fest2', 'Act', 1, '21:00', '22:00', { festivalId: 'f2' }),
    ];
    const r = alsoPlaysSlots(base, sets, { ...o, nowMs: Date.UTC(2026, 5, 12, 15) });
    expect(r.map((s) => s.set.id)).toEqual(['s2', 's3']);
    expect(r[0]).toMatchObject({ when: 'Sat 9:00 PM', day: 'Sat' });
  });

  it('keeps a TBA slot, and drops an unscheduled one', () => {
    const sets = [base, mk('tba', 'Act', 1), mk('none', 'Act', undefined, '20:00', '21:00'), mk('timed', 'Act', 1, '20:00', '21:00')];
    const r = alsoPlaysSlots(base, sets, o);
    expect(r.map((s) => s.set.id)).toEqual(['timed', 'tba']);
    expect(r[1]!.when).toBe('Sat, time TBA');
  });

  it('keeps the festival day for an after-midnight set and judges "ended" in the festival zone', () => {
    const late = mk('late', 'Act', 1, '01:00', '02:00');
    // Sat night 01:00 LA = 2026-06-14 01:00 PDT = 08:00 UTC; ends 09:00 UTC.
    const la = { days: DAYS, timeZone: 'America/Los_Angeles' };
    const before = alsoPlaysSlots(base, [base, late], { ...la, nowMs: Date.UTC(2026, 5, 14, 8, 30) });
    expect(before[0]!.when).toBe('Sat 1:00 AM');
    expect(alsoPlaysSlots(base, [base, late], { ...la, nowMs: Date.UTC(2026, 5, 14, 9, 0) })).toEqual([]);
  });

  it('does not match solo against b2b', () => {
    const solo = mk('solo', 'A', 0, '20:00', '21:00');
    expect(alsoPlaysSlots(solo, [solo, mk('b', 'A b2b B', 1, '20:00', '21:00')], o)).toEqual([]);
  });

  it('returns [] for a blank key', () => {
    const blank = mk('x', '', 0, '20:00', '21:00');
    expect(alsoPlaysSlots(blank, [blank, mk('y', '', 1, '20:00', '21:00')], o)).toEqual([]);
  });
});

describe('catchInsteadOption', () => {
  // a (must) clashes with b (want); a also plays Sunday.
  const a = mk('a', 'A', 1, '21:00', '22:30');
  const b = mk('b', 'B', 1, '21:30', '23:00');
  const aSun = mk('a2', 'A', 2, '21:00', '22:30');
  const myPicks: Record<string, Priority> = { a: 'must', b: 'want-to-see' };
  const run = (sets: FestivalSet[], picks = myPicks, extra: object = {}) => {
    const group = buildPickConflicts({ sets, myPicks: picks, selectedDay: 1, days: DAYS, timeZone: 'UTC' })[0]!;
    return { group, option: catchInsteadOption(group, { sets, myPicks: picks, days: DAYS, timeZone: 'UTC', nowMs: NOW, ...extra }) };
  };

  it('moves the non-recommended pick when it has a free slot', () => {
    const bSun = mk('b2', 'B', 2, '20:00', '21:00');
    const { group, option } = run([a, b, aSun, bSun]);
    expect(group.recommendedKeepId).toBe('a');
    expect(option).toMatchObject({ fromSetId: 'b', priority: 'want-to-see', artist: 'B' });
    expect(option!.to.set.id).toBe('b2');
  });

  it('falls back to the recommended pick when only it has another slot', () => {
    const { option } = run([a, b, aSun]);
    expect(option).toMatchObject({ fromSetId: 'a', priority: 'must' });
    expect(option!.to.set.id).toBe('a2');
  });

  it('skips a slot that is already picked', () => {
    expect(run([a, b, aSun], { ...myPicks, a2: 'must' }).option).toBeNull();
  });

  it('skips a slot that would clash', () => {
    const c = mk('c', 'C', 2, '21:30', '23:00');
    expect(run([a, b, aSun, c], { ...myPicks, c: 'must' }).option).toBeNull();
  });

  it('skips a slot that is a tight change when stages are given', () => {
    const stages = [
      { id: 'main', latitude: 28.0, longitude: -81.0 },
      { id: 'far', latitude: 28.1, longitude: -81.0 },
    ];
    const c = mk('c', 'C', 2, '22:35', '23:30', { stageId: 'far' });
    const sets = [a, b, aSun, c];
    expect(run(sets, { ...myPicks, c: 'must' }).option).not.toBeNull();
    expect(run(sets, { ...myPicks, c: 'must' }, { stages }).option).toBeNull();
  });

  it('skips a start-less slot and returns null with no other slot', () => {
    expect(run([a, b, mk('a2', 'A', 2)]).option).toBeNull();
    expect(run([a, b]).option).toBeNull();
  });
});

describe('planCatchInstead', () => {
  it('removes the old pick, picks the new one, and inverts to the Undo', () => {
    const to = { set: mk('a2', 'A', 2, '21:00', '22:00'), when: 'Sun 9:00 PM', day: 'Sun' };
    const change = planCatchInstead({ fromSetId: 'a', priority: 'must', to, artist: 'A' });
    expect(change.picks).toEqual([
      { setId: 'a', from: 'must', to: null },
      { setId: 'a2', from: null, to: 'must' },
    ]);
    expect(change.message).toBe('Catching A Sun 9:00 PM instead.');
    expect(invertChange(change).picks).toEqual([
      { setId: 'a', from: null, to: 'must' },
      { setId: 'a2', from: 'must', to: null },
    ]);
  });
});
