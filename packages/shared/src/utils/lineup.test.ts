import { describe, expect, it } from 'vitest';
import type { FestivalDay, FestivalSet, LineupEntry, Stage } from '../types/domain';
import { coverLineup } from './lineupCover';
import {
  groupLineupAlphabetically,
  groupLineupByTier,
  lineupCoveringSets,
  lineupDays,
  lineupEntryBadge,
  lineupEntryMatchesSearch,
  lineupEntryName,
  lineupSetWhen,
  lineupSummary,
  searchLineupEntries,
  selectLineupEntries,
} from './lineup';

const entry = (id: string, names: string[], extra: Partial<LineupEntry> = {}): LineupEntry => ({
  id,
  artists: names.map((name) => ({ name })),
  displayName: null,
  tier: null,
  dayDate: null,
  status: 'announced',
  announcedAt: '2026-11-01',
  linkedSetIds: [],
  ...extra,
});
const day = (date: string, label: string): FestivalDay => ({
  id: label,
  festivalId: 'f',
  date,
  label,
  createdAt: '',
  updatedAt: '',
});
const set = (id: string, artist: string, dayIndex: number, startTime = '', stageId = 'main'): FestivalSet => ({
  id,
  festivalId: 'f',
  stageId,
  artist,
  dayIndex,
  startTime,
  endTime: '',
  createdAt: '',
  updatedAt: '',
});
const stages = [{ id: 'main', name: 'Main Stage' }] as Stage[];
const DAYS = [day('2026-11-06', 'Fri'), day('2026-11-07', 'Sat')];
const NOW = Date.UTC(2026, 10, 20, 12);
const PUBLISHED = '2026-11-10T00:00:00.000Z';

function build(lineup: LineupEntry[], sets: FestivalSet[]) {
  const days = lineupDays(DAYS, sets);
  return { days, cover: coverLineup(lineup, days, 'b2b') };
}

describe('lineupEntryName', () => {
  it('prefers the poster name and joins B2B artists with the festival separator', () => {
    expect(lineupEntryName(entry('1', ['A', 'B']))).toBe('A b2b B');
    expect(lineupEntryName(entry('1', ['A', 'B']), 'x')).toBe('A x B');
    expect(lineupEntryName(entry('1', ['A', 'B'], { displayName: 'Port Zero presents: A B2B B' }))).toBe(
      'Port Zero presents: A B2B B',
    );
  });
});

describe('lineupEntryBadge', () => {
  const badge = (e: LineupEntry, lineup: LineupEntry[], sets: FestivalSet[] = [], published: string | null = PUBLISHED) => {
    const { days, cover } = build(lineup, sets);
    return lineupEntryBadge(e, cover[e.id]!, days, published, NOW).map((b) => b.text);
  };

  it('says "Day TBA" for an act with no day while some day has no sets', () => {
    const a = entry('1', ['A']);
    expect(badge(a, [a])).toEqual(['Day TBA']);
    expect(badge(a, [a], [set('s', 'Other', 0)])).toEqual(['Day TBA']);
  });

  it('says "<Day> · Stage and time TBA" for an act on a day with no sets', () => {
    const a = entry('1', ['A'], { dayDate: '2026-11-07' });
    expect(badge(a, [a], [set('s', 'Other', 0)])).toEqual(['Sat · Stage and time TBA']);
  });

  it('says "Not on the timetable yet" when its day, or every day for a Day TBA act, already has sets', () => {
    const dated = entry('1', ['A'], { dayDate: '2026-11-06' });
    expect(badge(dated, [dated], [set('s', 'Other', 0)])).toEqual(['Not on the timetable yet']);
    const undated = entry('2', ['B']);
    expect(badge(undated, [undated], [set('s1', 'X', 0), set('s2', 'Y', 1)])).toEqual(['Not on the timetable yet']);
  });

  it('treats a day that was removed as Day TBA', () => {
    const a = entry('1', ['A'], { dayDate: '2030-01-01' });
    expect(badge(a, [a])).toEqual(['Day TBA']);
  });

  it('gives a scheduled act no status badge, and a cancelled act only "Cancelled"', () => {
    const scheduled = entry('1', ['A']);
    expect(badge(scheduled, [scheduled], [set('s', 'A', 0, '20:00')])).toEqual([]);
    const gone = entry('2', ['B'], { status: 'cancelled', announcedAt: '2026-11-15' });
    expect(badge(gone, [gone])).toEqual(['Cancelled']);
  });

  it('adds "New" only for an act announced after publish and within 14 days', () => {
    const fresh = entry('1', ['A'], { announcedAt: '2026-11-15' });
    expect(badge(fresh, [fresh])).toEqual(['Day TBA', 'New']);
    const loadedAsDraft = entry('2', ['B'], { announcedAt: '2026-11-10' });
    expect(badge(loadedAsDraft, [loadedAsDraft])).toEqual(['Day TBA']);
    const old = entry('3', ['C'], { announcedAt: '2026-11-04' });
    expect(badge(old, [old], [], '2026-11-01T00:00:00.000Z')).toEqual(['Day TBA']);
    expect(badge(fresh, [fresh], [], null)).toEqual(['Day TBA']);
  });
});

describe('lineupSummary', () => {
  it('reads "N acts announced" with no sets and counts cancelled acts out', () => {
    const lineup = [entry('1', ['A']), entry('2', ['B']), entry('3', ['C'], { status: 'cancelled' })];
    const { cover } = build(lineup, []);
    expect(lineupSummary(lineup, cover)).toEqual({
      total: 2,
      scheduled: 0,
      cancelled: 1,
      header: '2 acts announced · Set times TBA',
    });
  });

  it('counts an act covered by an untimed set as on the timetable', () => {
    const lineup = [entry('1', ['A']), entry('2', ['B']), entry('3', ['C'])];
    const { cover } = build(lineup, [set('s1', 'A', 0), set('s2', 'B', 1, '20:00')]);
    expect(lineupSummary(lineup, cover).header).toBe('2 of 3 acts are on the timetable');
    expect(lineupSummary([lineup[0]!], cover).header).toBe('1 of 1 act are on the timetable');
  });
});

describe('lineupEntryMatchesSearch and searchLineupEntries', () => {
  const a = entry('1', ['Bacardí', 'Kai'], { displayName: 'Poster Name' });
  it('matches artist names and the poster name, ignoring case and accents', () => {
    expect(lineupEntryMatchesSearch(a, 'bacardi')).toBe(true);
    expect(lineupEntryMatchesSearch(a, 'KAI')).toBe(true);
    expect(lineupEntryMatchesSearch(a, 'poster')).toBe(true);
    expect(lineupEntryMatchesSearch(a, 'nope')).toBe(false);
    expect(lineupEntryMatchesSearch(a, '  ')).toBe(true);
  });
  it('lists only matching acts that still have no set and are not cancelled', () => {
    const lineup = [entry('1', ['Alpha']), entry('2', ['Alpine'], { status: 'cancelled' }), entry('3', ['Alps']), entry('4', ['Beta'])];
    const { cover } = build(lineup, [set('s', 'Alps', 0)]);
    expect(searchLineupEntries(lineup, cover, 'al').map((e) => e.id)).toEqual(['1']);
    expect(searchLineupEntries(lineup, cover, '')).toEqual([]);
  });
});

describe('selectLineupEntries', () => {
  const lineup = [
    entry('tba', ['Day TBA Act']),
    entry('fri', ['Friday Act'], { dayDate: '2026-11-06' }),
    entry('sat', ['Saturday Act'], { dayDate: '2026-11-07' }),
    entry('sched', ['Scheduled Act'], { dayDate: '2026-11-06' }),
    entry('gone', ['Gone Act'], { dayDate: '2026-11-07', status: 'cancelled' }),
  ];
  const sets = [set('s1', 'Scheduled Act', 1, '22:00')];
  const { cover } = build(lineup, sets);
  const ids = (list: LineupEntry[]) => list.map((e) => e.id);

  it("shows the selected day's acts first, then the Day TBA acts, and hides scheduled acts", () => {
    const fri = selectLineupEntries(lineup, cover, sets, { dayIndex: 0, fullLineup: false });
    expect(ids(fri.active)).toEqual(['fri', 'tba']);
    expect(ids(fri.cancelled)).toEqual([]);
    const sat = selectLineupEntries(lineup, cover, sets, { dayIndex: 1, fullLineup: false });
    expect(ids(sat.active)).toEqual(['sat', 'tba']);
    expect(ids(sat.cancelled)).toEqual(['gone']);
  });

  it('adds scheduled acts in the full lineup, on the day of their set rather than their own date', () => {
    const fri = selectLineupEntries(lineup, cover, sets, { dayIndex: 0, fullLineup: true });
    expect(ids(fri.active)).toEqual(['fri', 'tba']);
    const sat = selectLineupEntries(lineup, cover, sets, { dayIndex: 1, fullLineup: true });
    expect(ids(sat.active)).toEqual(['sat', 'sched', 'tba']);
  });
});

describe('grouping', () => {
  it('groups by tier, 1 first and no tier last, keeping billing order inside a tier', () => {
    const list = [entry('a', ['A']), entry('b', ['B'], { tier: 2 }), entry('c', ['C'], { tier: 1 }), entry('d', ['D'], { tier: 2 })];
    expect(groupLineupByTier(list).map((g) => [g.tier, g.entries.map((e) => e.id)])).toEqual([
      [1, ['c']],
      [2, ['b', 'd']],
      [null, ['a']],
    ]);
    expect(groupLineupByTier([entry('a', ['A'])])).toHaveLength(1);
  });

  it('groups A-Z by name key: "The X" sorts under X and digits under #', () => {
    const list = [entry('1', ['Zeds Dead']), entry('2', ['The Alpha']), entry('3', ['999999999']), entry('4', ['Bacardí'])];
    expect(groupLineupAlphabetically(list).map((g) => [g.letter, g.entries.map((e) => e.id)])).toEqual([
      ['#', ['3']],
      ['A', ['2']],
      ['B', ['4']],
      ['Z', ['1']],
    ]);
  });
});

describe('lineupCoveringSets and lineupSetWhen', () => {
  it('orders covering sets by day then time, untimed last, and describes each', () => {
    const sets = [set('late', 'A', 1, '23:00'), set('tba', 'A', 0), set('early', 'A', 0, '20:00')];
    const a = entry('1', ['A']);
    const { cover } = build([a], sets);
    const covering = lineupCoveringSets(cover['1']!, sets);
    expect(covering.map((s) => s.id)).toEqual(['early', 'tba', 'late']);
    expect(lineupSetWhen(covering[0]!, DAYS, stages)).toBe('Fri · 8:00 PM · Main Stage');
    expect(lineupSetWhen(covering[1]!, DAYS, stages)).toBe('Fri · Main Stage · Time TBA');
  });
});
