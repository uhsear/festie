import { describe, it, expect } from 'vitest';
import { buildSetContext } from './setContext';
import type { FestivalDay, FestivalSet } from '../types/domain';

const day = (i: number, date: string): FestivalDay => ({ id: `d${i}`, festivalId: 'f1', date, createdAt: '', updatedAt: '' });
const DAYS = [day(0, '2026-06-12'), day(1, '2026-06-13')];

function mk(id: string, stageId: string, dayIndex: number | undefined, startTime?: string, endTime?: string): FestivalSet {
  return { id, festivalId: 'f1', stageId, dayIndex, startTime, endTime, artist: id, createdAt: '', updatedAt: '' } as FestivalSet;
}
const ctx = (set: FestivalSet, sets: FestivalSet[], timeZone?: string) =>
  buildSetContext(set, sets, { days: DAYS, timeZone: timeZone ?? 'UTC' });
const ids = (xs: { set: FestivalSet }[]) => xs.map((x) => x.set.id);

describe('buildSetContext', () => {
  const me = mk('me', 'A', 0, '20:00', '21:00');

  it('finds the nearest set before and after on the same stage, ignoring other stages', () => {
    const sets = [
      me,
      mk('early', 'A', 0, '16:00', '17:00'),
      mk('prev', 'A', 0, '18:00', '19:30'),
      mk('next', 'A', 0, '21:30', '23:00'),
      mk('late', 'A', 0, '23:30', '23:59'),
      mk('other', 'B', 0, '21:30', '22:30'),
    ];
    const r = ctx(me, sets);
    expect(r.before?.set.id).toBe('prev');
    expect(r.after?.set.id).toBe('next');
    expect(r.before?.time).toBe('6:00 PM - 7:30 PM');
  });

  it('has no before for the first set and no after for the last set of a stage', () => {
    const next = mk('next', 'A', 0, '21:30', '22:30');
    expect(ctx(me, [me, next]).before).toBeNull();
    expect(ctx(next, [me, next]).after).toBeNull();
    expect(ctx(me, [me])).toEqual({ before: null, after: null, overlaps: [] });
  });

  it('treats a past-midnight set as the end of the night, after 23:00 and before nothing on the next day', () => {
    const late = mk('late', 'A', 0, '23:00', '00:30');
    const after = mk('after', 'A', 0, '01:00', '02:30'); // starts 01:00 -> still day 0's night
    const nextDay = mk('nextDay', 'A', 1, '14:00', '15:00');
    const sets = [late, after, nextDay];
    expect(ctx(late, sets).after?.set.id).toBe('after');
    expect(ctx(after, sets).before?.set.id).toBe('late');
    expect(ctx(after, sets).after).toBeNull();
    expect(ctx(nextDay, sets).before).toBeNull();
  });

  it('overlaps a past-midnight set with a post-midnight set on another stage', () => {
    const late = mk('late', 'A', 0, '23:00', '01:00');
    const sets = [late, mk('o1', 'B', 0, '00:30', '02:00'), mk('o2', 'B', 0, '01:00', '02:00')];
    expect(ids(ctx(late, sets).overlaps)).toEqual(['o1']);
  });

  it('lists overlaps on other stages only, sorted by start, excluding back-to-back and the same stage', () => {
    const sets = [
      me,
      mk('c', 'C', 0, '20:30', '21:30'),
      mk('b', 'B', 0, '19:30', '20:15'),
      mk('touchEnd', 'B', 0, '21:00', '22:00'),
      mk('touchStart', 'B', 0, '19:00', '20:00'),
      mk('sameStage', 'A', 0, '20:30', '21:30'),
    ];
    const r = ctx(me, sets);
    expect(ids(r.overlaps)).toEqual(['b', 'c']);
    expect(r.overlaps[1]!.time).toBe('8:30 PM - 9:30 PM');
  });

  it('hides everything for a TBA set and skips TBA candidates', () => {
    const tba = mk('tba', 'A', 0);
    expect(ctx(tba, [tba, me])).toEqual({ before: null, after: null, overlaps: [] });
    const r = ctx(me, [me, mk('x', 'B', 0), mk('y', 'A', undefined, '21:00', '22:00')]);
    expect(r).toEqual({ before: null, after: null, overlaps: [] });
  });

  it('does not match the same clock time on a different day', () => {
    const sets = [me, mk('d1same', 'B', 1, '20:00', '21:00'), mk('d1stage', 'A', 1, '21:00', '22:00')];
    const r = ctx(me, sets);
    expect(r.overlaps).toEqual([]);
    expect(r.after).toBeNull();
  });

  it('ignores sets of another festival', () => {
    const other = { ...mk('o', 'B', 0, '20:00', '21:00'), festivalId: 'f2' };
    expect(ctx(me, [me, other]).overlaps).toEqual([]);
  });

  it('is independent of the device zone: the same result in two festival zones', () => {
    const sets = [me, mk('o', 'B', 0, '20:30', '21:30'), mk('n', 'A', 0, '22:00', '23:00')];
    for (const tz of ['America/New_York', 'Asia/Tokyo', 'UTC']) {
      const r = ctx(me, sets, tz);
      expect(ids(r.overlaps)).toEqual(['o']);
      expect(r.after?.set.id).toBe('n');
    }
  });

  it('shows only the start when the end is missing', () => {
    expect(ctx(me, [me, mk('n', 'A', 0, '22:00')]).after?.time).toBe('10:00 PM');
  });
});
