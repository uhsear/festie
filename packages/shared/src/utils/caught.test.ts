import { describe, expect, it } from 'vitest';
import type { FestivalDay, FestivalSet, Stage } from '../types/domain';
import type { WrapCaughtSet, WrapFestival, WrapPlannedSet, WrapResponse } from '../types/wrap';
import {
  applyCaughtMark,
  buildCaughtChecklist,
  catchableMeta,
  caughtFor,
  caughtSetFromLineup,
  checklistCountLine,
  findSetsToAdd,
  lineupFromDays,
  selectCatchable,
} from './caught';

const TZ = 'America/Los_Angeles';
const days = [{ date: '2026-04-24' }, { date: '2026-04-25' }] as FestivalDay[];
// 2026-04-24 20:30 in Los Angeles (PDT, UTC-7)
const NOW = Date.UTC(2026, 3, 25, 3, 30);
const MIN = 60_000;

const mk = (id: string, startTime: string, endTime: string, dayIndex = 0, extra: Partial<FestivalSet> = {}) =>
  ({ id, startTime, endTime, dayIndex, stageId: 'st1', artist: id.toUpperCase(), ...extra }) as FestivalSet;
const picks = (...ids: string[]) => Object.fromEntries(ids.map((i) => [i, 'want-to-see' as const]));
const sel = (sets: FestivalSet[], p: ReturnType<typeof picks> | undefined = picks(...sets.map((s) => s.id)), nowMs = NOW, limit?: number) =>
  selectCatchable({ sets, days, picks: p, nowMs, timeZone: TZ, limit });

describe('selectCatchable', () => {
  it('includes live sets', () => {
    const r = sel([mk('a', '20:00', '21:00')]);
    expect(r).toHaveLength(1);
    expect(r[0]!.live).toBe(true);
  });
  it('includes a set that ended 1 h 59 min ago and drops one that ended 2 h 1 min ago', () => {
    expect(sel([mk('a', '17:00', '18:31')])).toHaveLength(1);
    expect(sel([mk('a', '17:00', '18:29')])).toHaveLength(0);
  });
  it('drops sets that have not started and sets that are not picks', () => {
    expect(sel([mk('a', '21:00', '22:00')])).toEqual([]);
    expect(sel([mk('a', '20:00', '21:00')], picks('zzz'))).toEqual([]);
  });
  it('returns [] for a guest', () => {
    expect(selectCatchable({ sets: [mk('a', '20:00', '21:00')], days, picks: undefined, nowMs: NOW, timeZone: TZ })).toEqual([]);
  });
  it('orders live first by earliest end, then ended by latest end', () => {
    const r = sel([
      mk('old', '17:30', '18:45'),
      mk('liveLate', '20:00', '22:00'),
      mk('recent', '18:30', '19:30'),
      mk('liveSoon', '20:00', '21:00'),
    ]);
    expect(r.map((x) => x.set.id)).toEqual(['liveSoon', 'liveLate', 'recent', 'old'].slice(0, 3));
  });
  it('limits to 3 by default and honours limit', () => {
    const sets = ['a', 'b', 'c', 'd'].map((i) => mk(i, '20:00', '21:00'));
    expect(sel(sets)).toHaveLength(3);
    expect(sel(sets, undefined, NOW, 2)).toHaveLength(2);
  });
  it('handles a past-midnight set at 00:45 festival time', () => {
    const now = Date.UTC(2026, 3, 25, 7, 45); // 00:45 PDT on 04-25
    expect(sel([mk('a', '00:30', '02:00')], picks('a'), now)).toHaveLength(1);
    expect(sel([mk('a', '23:30', '01:00')], picks('a'), now)[0]!.live).toBe(true);
  });
  it('uses the festival zone, not the machine zone', () => {
    // 20:30 in LA is 03:30Z; a UTC reading would see this set as not started
    expect(sel([mk('a', '20:00', '21:00')])).toHaveLength(1);
  });
  it('uses a one-hour default when there is no end time', () => {
    expect(sel([mk('a', '20:00', '')])[0]!.live).toBe(true);
  });
});

describe('catchableMeta', () => {
  const item = (endMs: number, live: boolean) => ({ set: mk('a', '20:00', '21:00'), startMs: 0, endMs, live });
  it('formats live, minutes and hours', () => {
    expect(catchableMeta(item(NOW + MIN, true), NOW, 'Main')).toBe('Playing now · Main');
    expect(catchableMeta(item(NOW, false), NOW, 'Main')).toBe('Ended just now · Main');
    expect(catchableMeta(item(NOW - 59 * MIN, false), NOW, 'Main')).toBe('Ended 59 min ago · Main');
    expect(catchableMeta(item(NOW - 60 * MIN, false), NOW)).toBe('Ended 1 h ago');
    expect(catchableMeta(item(NOW - 125 * MIN, false), NOW)).toBe('Ended 2 h ago');
  });
});

const festival: WrapFestival = {
  id: 'f1',
  name: 'Fest',
  timeZone: TZ,
  days: [
    { date: '2026-04-24', label: 'Friday' },
    { date: '2026-04-25', label: null },
  ],
};
const pl = (over: Partial<WrapPlannedSet> & { setId: string }): WrapPlannedSet => ({
  artist: over.setId.toUpperCase(),
  stageId: 'st1',
  stageName: 'Main',
  dayIndex: 0,
  startTime: '12:00',
  endTime: '13:00',
  priority: 'want-to-see',
  rating: null,
  note: null,
  crewAlso: null,
  caught: null,
  ...over,
});
const ex = (over: Partial<WrapCaughtSet> & { setId: string }): WrapCaughtSet => ({
  artist: over.setId.toUpperCase(),
  stageId: 'st2',
  stageName: 'Forest',
  dayIndex: 0,
  startTime: '14:00',
  endTime: '15:00',
  rating: null,
  note: null,
  caught: true,
  ...over,
});
const wr = (over: Partial<WrapResponse> = {}): WrapResponse => ({
  stats: { totalRated: 0, avgRating: null, stagesVisited: 0, daysAttended: 0, totalHours: 0 },
  topSets: [],
  allRatings: [],
  festival,
  planned: [],
  crew: null,
  ...over,
});
const afterAll = Date.UTC(2026, 3, 27, 12);

describe('buildCaughtChecklist', () => {
  it('groups by day with labels, TBA last', () => {
    const { days: d } = buildCaughtChecklist(
      wr({
        planned: [
          pl({ setId: 'tba', dayIndex: null, startTime: null, endTime: null }),
          pl({ setId: 'b', dayIndex: 1 }),
          pl({ setId: 'a', dayIndex: 0 }),
          pl({ setId: 'far', dayIndex: 5 }),
        ],
      }),
      afterAll,
    );
    expect(d.map((x) => x.label)).toEqual(['Friday', 'Day 2', 'Day 6', 'TBA']);
  });
  it('sorts 23:00 before 01:00 and puts TBA times last in a day', () => {
    const { days: d } = buildCaughtChecklist(
      wr({
        planned: [
          pl({ setId: 'late', startTime: '01:00', endTime: '02:00' }),
          pl({ setId: 'none', startTime: null, endTime: null }),
          pl({ setId: 'night', startTime: '23:00', endTime: '00:30' }),
        ],
      }),
      afterAll,
    );
    expect(d[0]!.rows.map((r) => r.setId)).toEqual(['night', 'late', 'none']);
  });
  it('counts marks and rows to mark, includes added rows, drops cleared ones', () => {
    const r = buildCaughtChecklist(
      wr({
        planned: [pl({ setId: 'a', caught: true }), pl({ setId: 'b', caught: false }), pl({ setId: 'c' })],
        caughtExtra: [ex({ setId: 'x' }), ex({ setId: 'gone', caught: null })],
      }),
      afterAll,
    );
    expect(r.counts).toEqual({ saw: 2, skipped: 1, toMark: 1 });
    const ids = r.days.flatMap((d) => d.rows.map((x) => x.setId));
    expect(ids).toContain('x');
    expect(ids).not.toContain('gone');
    expect(r.days[0]!.rows.find((x) => x.setId === 'x')!.added).toBe(true);
  });
  it('marks a future set as not started', () => {
    const r = buildCaughtChecklist(wr({ planned: [pl({ setId: 'a', dayIndex: 1 })] }), NOW);
    expect(r.days[0]!.rows[0]!.started).toBe(false);
    expect(r.counts.toMark).toBe(0);
  });
  it('treats a TBA row as started only once the festival is over', () => {
    const w = wr({ planned: [pl({ setId: 't', dayIndex: null, startTime: null, endTime: null })] });
    expect(buildCaughtChecklist(w, NOW).days[0]!.rows[0]!.started).toBe(false);
    expect(buildCaughtChecklist(w, afterAll).days[0]!.rows[0]!.started).toBe(true);
  });
});

describe('checklistCountLine', () => {
  it('leaves out zero parts', () => {
    expect(checklistCountLine({ saw: 3, skipped: 1, toMark: 2 })).toBe('3 seen · 1 skipped · 2 to mark');
    expect(checklistCountLine({ saw: 0, skipped: 1, toMark: 0 })).toBe('1 skipped');
    expect(checklistCountLine({ saw: 0, skipped: 0, toMark: 0 })).toBe('');
  });
});

describe('findSetsToAdd', () => {
  const stages = [{ id: 'st1', name: 'Main' }] as Stage[];
  const lineup = [
    mk('alpha', '12:00', '13:00'),
    mk('beta', '13:00', '14:00'),
    mk('future', '22:00', '23:00', 1, { artist: 'Alpha Future' }),
    mk('duo', '11:00', '12:00', 0, { artist: 'Duo', artists: [{ name: 'Zed' }, { name: 'Quin' }] as never }),
  ];
  const find = (query: string, exclude: string[] = [], extra: object = {}) =>
    findSetsToAdd({
      lineup,
      days,
      excludeIds: new Set(exclude),
      query,
      stages,
      nowMs: NOW,
      timeZone: TZ,
      festivalOver: false,
      ...extra,
    });
  it('returns [] for a blank query', () => {
    expect(find('   ')).toEqual([]);
  });
  it('excludes picks and added sets, and future sets', () => {
    expect(find('alpha', ['alpha'])).toEqual([]);
    expect(find('alpha').map((s) => s.id)).toEqual(['alpha']);
  });
  it('matches a B2B member and a stage name', () => {
    expect(find('quin').map((s) => s.id)).toEqual(['duo']);
    expect(find('main').map((s) => s.id)).toEqual(['duo', 'alpha', 'beta']);
  });
  it('respects limit', () => {
    expect(find('main', [], { limit: 1 })).toHaveLength(1);
  });
  it('keeps TBA sets only once the festival is over', () => {
    const tba = mk('tba', '', '', 0, { artist: 'Tba Act' });
    const run = (over: boolean) =>
      findSetsToAdd({ lineup: [tba], days, excludeIds: new Set(), query: 'tba', stages, nowMs: NOW, festivalOver: over });
    expect(run(false)).toEqual([]);
    expect(run(true)).toHaveLength(1);
  });
});

describe('lineupFromDays', () => {
  it('sets dayIndex and date', () => {
    const r = lineupFromDays([{ date: '2026-04-24', sets: [mk('a', '1:00', '2:00')] }, { date: '2026-04-25' }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'a', dayIndex: 0, date: '2026-04-24' });
  });
});

describe('caughtSetFromLineup', () => {
  it('builds a caught row', () => {
    expect(caughtSetFromLineup(mk('a', '12:00', '13:00', 1), 'Main')).toMatchObject({
      setId: 'a',
      stageName: 'Main',
      dayIndex: 1,
      caught: true,
    });
  });
});

describe('applyCaughtMark', () => {
  it('updates a planned row without mutating the input', () => {
    const w = wr({ planned: [pl({ setId: 'a' })] });
    const next = applyCaughtMark(w, 'a', true);
    expect(next.planned[0]!.caught).toBe(true);
    expect(w.planned[0]!.caught).toBeNull();
  });
  it('updates an added row and removes it on null', () => {
    const w = wr({ caughtExtra: [ex({ setId: 'x' })] });
    expect(applyCaughtMark(w, 'x', false).caughtExtra![0]!.caught).toBe(false);
    expect(applyCaughtMark(w, 'x', null).caughtExtra).toEqual([]);
    expect(w.caughtExtra).toHaveLength(1);
  });
  it('adds a new extra when given one, and ignores an unknown set otherwise', () => {
    const w = wr();
    expect(applyCaughtMark(w, 'n', true, ex({ setId: 'n' })).caughtExtra).toHaveLength(1);
    expect(applyCaughtMark(w, 'n', true)).toBe(w);
  });
});

describe('caughtFor', () => {
  const w = wr({ planned: [pl({ setId: 'a', caught: true })], caughtExtra: [ex({ setId: 'x', caught: false })] });
  it('prefers the overlay, then planned and extra, then null', () => {
    expect(caughtFor(w, new Map(), 'a')).toBe(true);
    expect(caughtFor(w, new Map(), 'x')).toBe(false);
    expect(caughtFor(w, new Map([['a', null]]), 'a')).toBeNull();
    expect(caughtFor(w, new Map([['a', false]]), 'a')).toBe(false);
    expect(caughtFor(undefined, new Map(), 'q')).toBeNull();
    expect(caughtFor(undefined, new Map([['q', true]]), 'q')).toBe(true);
  });
});
