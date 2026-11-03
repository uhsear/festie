import { describe, it, expect } from 'vitest';
import {
  buildBulkPickGroups,
  buildPicksRows,
  bulkAddMessage,
  comparePicksByTime,
  effectivePicksFilter,
  picksStats,
  reminderLeadA11y,
  reminderLeadLabel,
  type PicksRow,
} from './picksPlan';
import type { Artist, FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';

function makeSet(overrides: Partial<FestivalSet> & { id: string }): FestivalSet {
  return {
    festivalId: 'fest-1',
    stageId: 'main',
    dayIndex: 0,
    startTime: '14:00',
    endTime: '15:00',
    artist: overrides.id,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDay(i: number, date: string, label?: string): FestivalDay {
  return { id: `day-${i}`, festivalId: 'fest-1', date, label, createdAt: '', updatedAt: '' };
}

const artists = (...a: Array<{ name: string; genres?: string[] }>) =>
  a.map((x, i) => ({ id: `a${i}`, ...x })) as unknown as Artist[];

const DAYS = [makeDay(0, '2026-06-15', 'Fri'), makeDay(1, '2026-06-16', 'Sat')];
const STAGES = [
  { id: 'main', name: 'Main Stage' },
  { id: 'tent', name: 'Tent' },
] as Stage[];
const NONE: ReadonlySet<string> = new Set();
const byId = (a: FestivalSet, b: FestivalSet) => a.id.localeCompare(b.id);

const SETS = [
  makeSet({ id: 'a', dayIndex: 0 }),
  makeSet({ id: 'b', dayIndex: 0 }),
  makeSet({ id: 'c', dayIndex: 1, stageId: 'tent' }),
  makeSet({ id: 'd', dayIndex: undefined }),
];
const PICKS: Record<string, Priority> = { a: 'maybe', b: 'must', c: 'want-to-see', d: 'must' };

function rows(over: Partial<Parameters<typeof buildPicksRows>[0]> = {}): PicksRow[] {
  return buildPicksRows({
    sets: SETS,
    picks: PICKS,
    days: DAYS,
    stages: STAGES,
    groupMode: 'day',
    filter: 'all',
    search: '',
    collapsed: NONE,
    clashIds: NONE,
    compare: byId,
    ...over,
  });
}
const shape = (r: PicksRow[]) => r.map((x) => (x.kind === 'set' ? `set:${x.set.id}` : `${x.kind}:${x.label}`));
const setIds = (r: PicksRow[]) => shape(r).filter((s) => s.startsWith('set:'));

describe('buildPicksRows', () => {
  it('day mode: days in order, priority subgroups must/want/maybe, TBA in Unscheduled', () => {
    expect(shape(rows())).toEqual([
      'group:Fri',
      'subgroup:Must See',
      'set:b',
      'subgroup:Maybe',
      'set:a',
      'group:Sat',
      'subgroup:Want to See',
      'set:c',
      'group:Unscheduled',
      'subgroup:Must See',
      'set:d',
    ]);
  });

  it('collapsed group emits only its header', () => {
    const out = rows({ collapsed: new Set(['day-0']) });
    expect(shape(out).slice(0, 2)).toEqual(['group:Fri', 'group:Sat']);
    expect(out[0]).toMatchObject({ kind: 'group', collapsed: true, count: 2 });
  });

  it('priority mode inverts the nesting', () => {
    expect(shape(rows({ groupMode: 'priority' }))).toEqual([
      'group:Must See',
      'subgroup:Fri',
      'set:b',
      'subgroup:Unscheduled',
      'set:d',
      'group:Want to See',
      'subgroup:Sat',
      'set:c',
      'group:Maybe',
      'subgroup:Fri',
      'set:a',
    ]);
  });

  it('clashes filter keeps only clash ids; priority filter keeps that priority', () => {
    expect(setIds(rows({ filter: 'clashes', clashIds: new Set(['a', 'c']) }))).toEqual(['set:a', 'set:c']);
    expect(setIds(rows({ filter: 'must' }))).toEqual(['set:b', 'set:d']);
  });

  it('search matches a B2B artist name and a stage name', () => {
    const b2b = makeSet({ id: 'e', artist: undefined, artists: artists({ name: 'Duo One' }, { name: 'Duo Two' }) });
    const extra = { sets: [...SETS, b2b], picks: { ...PICKS, e: 'must' as Priority } };
    expect(setIds(rows({ ...extra, search: 'duo two' }))).toEqual(['set:e']);
    expect(setIds(rows({ ...extra, search: 'tent' }))).toEqual(['set:c']);
  });

  it('sorts a 01:00 set after a 23:00 set on the same day', () => {
    const late = makeSet({ id: 'late', startTime: '01:00', endTime: '02:00' });
    const early = makeSet({ id: 'early', startTime: '23:00', endTime: '23:59' });
    const out = rows({
      sets: [late, early],
      picks: { late: 'must', early: 'must' },
      compare: comparePicksByTime(DAYS),
    });
    expect(setIds(out)).toEqual(['set:early', 'set:late']);
  });

  it('orders 22:00, 23:30 and 01:00 both ways in festival time', () => {
    const sets = [
      makeSet({ id: 's2200', startTime: '22:00', endTime: '23:00' }),
      makeSet({ id: 's0100', startTime: '01:00', endTime: '02:00' }),
      makeSet({ id: 's2330', startTime: '23:30', endTime: '00:30' }),
    ];
    const picks: Record<string, Priority> = { s2200: 'must', s2330: 'must', s0100: 'must' };
    const ordered = (order?: 'openers' | 'headliners') =>
      setIds(rows({ sets, picks, compare: comparePicksByTime(DAYS, undefined, undefined, order) }));
    expect(ordered()).toEqual(['set:s2200', 'set:s2330', 'set:s0100']);
    expect(ordered('headliners')).toEqual(['set:s0100', 'set:s2330', 'set:s2200']);
  });

  it('set rows carry their priority', () => {
    const set = rows().find((r) => r.kind === 'set' && r.set.id === 'c');
    expect(set).toMatchObject({ priority: 'want-to-see' });
  });
});

describe('picksStats / effectivePicksFilter', () => {
  it('counts each priority and clash ids', () => {
    expect(picksStats(SETS, PICKS, new Set(['a']))).toEqual({ must: 2, want: 1, maybe: 1, total: 4, clashes: 1 });
  });

  it('falls back from clashes to all when none remain', () => {
    const stats = { must: 0, want: 0, maybe: 0, total: 0, clashes: 0 };
    expect(effectivePicksFilter('clashes', stats)).toBe('all');
    expect(effectivePicksFilter('clashes', { ...stats, clashes: 1 })).toBe('clashes');
    expect(effectivePicksFilter('must', stats)).toBe('must');
  });
});

describe('buildBulkPickGroups', () => {
  it('spans every day, keeps stage order and first-seen genre casing', () => {
    const sets = [
      makeSet({ id: 't1', stageId: 'tent', dayIndex: 1, artists: artists({ name: 'X', genres: ['UK garage'] }) }),
      makeSet({ id: 'm1', stageId: 'main', dayIndex: 0, artists: artists({ name: 'Y', genres: ['uk Garage', 'House'] }) }),
    ];
    const name = (id: string) => STAGES.find((s) => s.id === id)?.name;
    const g = buildBulkPickGroups(sets, STAGES, name);
    expect(g.stages.map((s) => [s.label, s.setIds])).toEqual([
      ['Main Stage', ['m1']],
      ['Tent', ['t1']],
    ]);
    expect(g.genres.map((s) => [s.label, s.setIds])).toEqual([
      ['House', ['m1']],
      ['UK garage', ['t1', 'm1']],
    ]);
  });
});

describe('bulkAddMessage', () => {
  it('reports nothing new', () => {
    expect(bulkAddMessage({ changed: 0, total: 4, label: 'Main Stage', priority: 'must' })).toBe(
      'Nothing new to add from Main Stage.',
    );
  });

  it('uses the singular with nothing skipped', () => {
    expect(bulkAddMessage({ changed: 1, total: 1, label: 'X', priority: 'maybe' })).toBe('Added 1 set from X to Maybe.');
  });

  it('plural with skipped', () => {
    expect(bulkAddMessage({ changed: 3, total: 12, label: 'Main Stage', priority: 'must' })).toBe(
      'Added 3 sets from Main Stage to Must See (9 already picked).',
    );
  });
});

describe('reminder labels', () => {
  it('formats lead time', () => {
    expect(reminderLeadLabel(60)).toBe('1h');
    expect(reminderLeadLabel(15)).toBe('15m');
    expect(reminderLeadA11y(1)).toBe('1 minute');
    expect(reminderLeadA11y(60)).toBe('1 hour');
    expect(reminderLeadA11y(15)).toBe('15 minutes');
  });
});
