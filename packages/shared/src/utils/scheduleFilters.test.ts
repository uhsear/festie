import { describe, it, expect } from 'vitest';
import {
  defaultScheduleView,
  EMPTY_SCHEDULE_PREFS,
  filterScheduleSets,
  groupScheduleSets,
  hasAnyPick,
  sanitizeSchedulePrefs,
  scheduleEmptyCopy,
  scheduleEmptyReason,
  scheduleResultsSummary,
  searchEmptyCopy,
  searchHiddenByFilters,
  toggleGenreFilter,
  toggleHiddenDay,
  toggleStageFilter,
  viewAsButtonLabel,
  viewAsPicksLabel,
  viewAsTarget,
  visibleDayIndexes,
} from './scheduleFilters';
import type { FestivalSet, Stage } from '../types/domain';

const stage = (id: string, name: string) => ({ id, name }) as Stage;
const stages = [stage('A', 'Main'), stage('B', 'Mystic Garden'), stage('C', 'Bass')];
const set = (id: string, stageId: string, artist: string, extra: Partial<FestivalSet> = {}) =>
  ({ id, stageId, artist, ...extra }) as FestivalSet;
const sets = [
  set('1', 'A', 'Daft Punk'),
  set('2', 'B', 'Bonobo'),
  set('3', 'B', 'Four Tet', { artists: [{ name: 'Caribou' }] as FestivalSet['artists'] }),
  set('4', 'C', 'Skrillex'),
];
const base = { activeStages: [], stages, onlyMine: false, picks: {}, query: '' };
const ids = (xs: FestivalSet[]) => xs.map((s) => s.id);
const all = ['A', 'B', 'C'];

describe('toggleStageFilter', () => {
  it('shows only the first tapped stage', () => expect(toggleStageFilter([], all, 'A')).toEqual(['A']));
  it('adds in festival order', () => expect(toggleStageFilter(['C'], all, 'A')).toEqual(['A', 'C']));
  it('removes the last one back to all', () => expect(toggleStageFilter(['A'], all, 'A')).toEqual([]));
  it('collapses to [] when every stage is selected', () =>
    expect(toggleStageFilter(['A', 'B'], all, 'C')).toEqual([]));
});

describe('filterScheduleSets', () => {
  it('filters by stage', () =>
    expect(ids(filterScheduleSets(sets, { ...base, activeStages: ['B'] }))).toEqual(['2', '3']));
  it('filters by picks', () =>
    expect(ids(filterScheduleSets(sets, { ...base, onlyMine: true, picks: { '4': 'must' } }))).toEqual(['4']));
  it('searches artist, B2B artist and stage name', () => {
    expect(ids(filterScheduleSets(sets, { ...base, query: 'daft' }))).toEqual(['1']);
    expect(ids(filterScheduleSets(sets, { ...base, query: 'cariboU' }))).toEqual(['3']);
    expect(ids(filterScheduleSets(sets, { ...base, query: 'garden' }))).toEqual(['2', '3']);
  });
  it('ignores My picks when there are no picks', () => {
    expect(filterScheduleSets(sets, { ...base, onlyMine: true, picks: {} })).toHaveLength(4);
    expect(filterScheduleSets(sets, { ...base, onlyMine: true, picks: undefined })).toHaveLength(4);
  });
  it('hasAnyPick ignores falsy values', () => expect(hasAnyPick({ x: null })).toBe(false));
  it('View as keeps only the viewed picks and ignores My picks', () => {
    const viewAsPicks = { '2': 'must' as const };
    expect(ids(filterScheduleSets(sets, { ...base, viewAsPicks }))).toEqual(['2']);
    expect(ids(filterScheduleSets(sets, { ...base, onlyMine: true, picks: { '4': 'must' }, viewAsPicks }))).toEqual([
      '2',
    ]);
  });
  it('View as with no picks shows nothing, not the whole day', () => {
    expect(filterScheduleSets(sets, { ...base, viewAsPicks: {} })).toEqual([]);
  });
  it('View as still applies stage and search', () => {
    const viewAsPicks = { '1': 'must' as const, '2': 'must' as const };
    expect(ids(filterScheduleSets(sets, { ...base, activeStages: ['B'], viewAsPicks }))).toEqual(['2']);
    expect(ids(filterScheduleSets(sets, { ...base, query: 'daft', viewAsPicks }))).toEqual(['1']);
  });
});

describe('viewAsTarget', () => {
  const profiles = [
    { id: 'p1', userId: 'u1', name: ' Ana ', picks: { '1': 'must' as const } },
    { id: 'p2', userId: 'u2', name: '  ', picks: undefined as unknown as Record<string, 'must'> },
    { id: 'p3', userId: 'u3', name: 'Stranger', picks: {} },
  ];
  const crew = new Set(['u1', 'u2']);
  it('returns the crew member with a trimmed name and picks', () =>
    expect(viewAsTarget(profiles, 'p1', crew)).toEqual({ profileId: 'p1', name: 'Ana', picks: { '1': 'must' } }));
  it('falls back to "Crew member" and empty picks', () =>
    expect(viewAsTarget(profiles, 'p2', crew)).toEqual({ profileId: 'p2', name: 'Crew member', picks: {} }));
  it('is null for no id, an unknown id, or someone outside the crew', () => {
    expect(viewAsTarget(profiles, null, crew)).toBeNull();
    expect(viewAsTarget(profiles, 'gone', crew)).toBeNull();
    expect(viewAsTarget(profiles, 'p3', crew)).toBeNull();
  });
  it('labels', () => {
    expect(viewAsButtonLabel('Ana')).toBe('View as Ana');
    expect(viewAsPicksLabel('Ana')).toBe("Ana's picks");
  });
});

describe('scheduleEmptyReason', () => {
  const f = { query: '', onlyMine: false, hasAnyPick: false, stageFilterActive: false, genreFilterActive: false };
  it('orders search, picks, stages, day', () => {
    expect(scheduleEmptyReason({ ...f, query: 'x', onlyMine: true, hasAnyPick: true, stageFilterActive: true })).toBe(
      'search',
    );
    expect(scheduleEmptyReason({ ...f, onlyMine: true, hasAnyPick: true, stageFilterActive: true })).toBe('picks');
    expect(scheduleEmptyReason({ ...f, stageFilterActive: true })).toBe('stages');
    expect(scheduleEmptyReason({ ...f, onlyMine: true })).toBe('day');
    expect(scheduleEmptyReason({ ...f, query: '  ' })).toBe('day');
  });
  it('puts View as right after search', () => {
    const g = { ...f, stageFilterActive: true, viewAsName: 'Ana' };
    expect(scheduleEmptyReason(g)).toBe('viewAs');
    expect(scheduleEmptyReason({ ...g, onlyMine: true, hasAnyPick: true })).toBe('viewAs');
    expect(scheduleEmptyReason({ ...g, query: 'x' })).toBe('search');
  });
  it('has View as copy', () => {
    expect(scheduleEmptyCopy('viewAs', 'Saturday', 'Ana')).toEqual({
      title: 'Ana has no picks on Saturday',
      message: "Show everyone's sets, or pick another day.",
      actionLabel: 'Show everyone',
    });
    expect(scheduleEmptyCopy('viewAs', 'Saturday').title).toBe('Crew member has no picks on Saturday');
    expect(scheduleEmptyCopy('stages', 'Sunday', 'Ana').title).toBe('Nothing on these stages on Sunday');
  });
  it('has copy for each reason', () => {
    expect(scheduleEmptyCopy('stages', 'Sunday').title).toBe('Nothing on these stages on Sunday');
    expect(scheduleEmptyCopy('picks', 'Sunday').actionLabel).toBe('Show all sets');
    expect(scheduleEmptyCopy('day', 'Sunday').actionLabel).toBeUndefined();
    expect(searchEmptyCopy('zed', 'Sunday', true).message).toBe('Found on other days:');
    expect(searchEmptyCopy(' zed ', 'Sunday', false)).toEqual({
      title: 'No artist called “zed” in this lineup',
      message: 'Check the spelling, or clear the search to see everyone.',
      actionLabel: 'Clear search',
    });
  });
  it('blames the filters, not the search, when a day match is hidden', () => {
    const copy = searchEmptyCopy('justice', 'Friday', true, true);
    expect(copy.title).toBe('“justice” is hidden by your filters');
    expect(copy.actionLabel).toBe('Clear filters');
  });
  it('detects a day match the filters hide', () => {
    expect(searchHiddenByFilters(sets, 'garden', stages)).toBe(true);
    expect(searchHiddenByFilters(sets, 'nobody', stages)).toBe(false);
    expect(searchHiddenByFilters(sets, '  ', stages)).toBe(false);
  });
});

describe('scheduleResultsSummary', () => {
  it('formats counts', () => {
    expect(scheduleResultsSummary({ count: 1, onlyMine: false, activeStageCount: 0 })).toBe('1 set');
    expect(scheduleResultsSummary({ count: 12, onlyMine: true, activeStageCount: 2, tbaCount: 3 })).toBe(
      '12 sets · my picks · 2 stages · 3 TBA',
    );
    expect(scheduleResultsSummary({ count: 2, onlyMine: false, activeStageCount: 1 })).toBe('2 sets · 1 stage');
    expect(scheduleResultsSummary({ count: 3, onlyMine: false, activeStageCount: 0, activeGenreCount: 2 })).toBe(
      '3 sets · 2 genres',
    );
  });
  it('names the viewed crew mate instead of my picks', () => {
    expect(scheduleResultsSummary({ count: 3, onlyMine: true, activeStageCount: 0, viewAsName: 'Ana' })).toBe(
      "3 sets · Ana's picks",
    );
  });
});

describe('hidden days', () => {
  it('keeps a hidden selected day visible', () => {
    expect(visibleDayIndexes(3, [0, 1], 1)).toEqual([1, 2]);
    expect(visibleDayIndexes(3, [0, 1], 2)).toEqual([2]);
  });
  it('refuses to hide the last visible day', () => {
    expect(toggleHiddenDay([0, 1], 3, 2)).toEqual([0, 1]);
    expect(toggleHiddenDay([1], 3, 0)).toEqual([0, 1]);
    expect(toggleHiddenDay([0, 1], 3, 0)).toEqual([1]);
  });
});

describe('groupScheduleSets', () => {
  const labels = (g: { label: string; sets: FestivalSet[] }[]) => g.map((x) => `${x.label}:${ids(x.sets).join(',')}`);
  const night = [
    set('late', 'A', 'Zedd', { startTime: '01:30' }),
    set('eve', 'C', 'Aphex Twin', { startTime: '23:00' }),
    set('tba', 'B', 'Moby'),
    set('eve2', 'B', 'bicep', { startTime: '23:45' }),
  ];

  it('time: hour sections in festival-day order, after-midnight last, TBA at the end', () => {
    expect(labels(groupScheduleSets(night, 'time', stages))).toEqual([
      '11:00 PM:eve,eve2',
      '1:00 AM:late',
      'TBA:tba',
    ]);
  });

  it('stage: festival stage order', () => {
    expect(labels(groupScheduleSets(night, 'stage', stages))).toEqual(['Main:late', 'Mystic Garden:eve2,tba', 'Bass:eve']);
  });

  it('az: first letter, B2B under the first artist, digits and symbols under # last', () => {
    const b2b = set('b2b', 'A', 'Custom Name', {
      artists: [{ name: 'Énigma' }, { name: 'Zed' }] as FestivalSet['artists'],
    });
    const xs = [...night, b2b, set('num', 'A', '22Bullets'), set('sym', 'A', '!!!')];
    expect(labels(groupScheduleSets(xs, 'az', stages))).toEqual([
      'A:eve',
      'B:eve2',
      'E:b2b',
      'M:tba',
      'Z:late',
      '#:sym,num',
    ]);
  });
});

describe('sanitizeSchedulePrefs', () => {
  const scope = { stageIds: all, dayCount: 3 };
  it('returns empty prefs for non-objects', () => {
    expect(sanitizeSchedulePrefs(null, scope)).toEqual(EMPTY_SCHEDULE_PREFS);
    expect(sanitizeSchedulePrefs('x', scope)).toEqual(EMPTY_SCHEDULE_PREFS);
  });
  it('drops unknown stages and every-stage selections', () => {
    expect(sanitizeSchedulePrefs({ activeStages: ['C', 'zz', 'A'] }, scope).activeStages).toEqual(['A', 'C']);
    expect(sanitizeSchedulePrefs({ activeStages: ['A', 'B', 'C'] }, scope).activeStages).toEqual([]);
    expect(sanitizeSchedulePrefs({ activeStages: ['zz'] }, scope).activeStages).toEqual([]);
  });
  it('keeps only in-range integer days and never hides all', () => {
    expect(sanitizeSchedulePrefs({ hiddenDays: [2, 2, 9, -1, 1.5, 0] }, scope).hiddenDays).toEqual([0, 2]);
    expect(sanitizeSchedulePrefs({ hiddenDays: [0, 1, 2] }, scope).hiddenDays).toEqual([]);
  });
  it('drops a bad view or phase and cuts a long query', () => {
    const p = sanitizeSchedulePrefs({ view: 'map', dismissedPhase: 'later', searchQuery: 'x'.repeat(300) }, scope);
    expect(p.view).toBeNull();
    expect(p.dismissedPhase).toBeNull();
    expect(p.searchQuery).toHaveLength(100);
  });
  it('keeps valid values', () => {
    const p = sanitizeSchedulePrefs({ view: 'grid', dismissedPhase: 'post', onlyMine: true }, scope);
    expect(p).toMatchObject({ view: 'grid', dismissedPhase: 'post', onlyMine: true });
  });
});

describe('defaultScheduleView', () => {
  it('uses timeline only when live with timed sets', () => {
    expect(defaultScheduleView({ hasTimedSets: true, phase: 'live' })).toBe('timeline');
    expect(defaultScheduleView({ hasTimedSets: false, phase: 'live' })).toBe('cards');
    expect(defaultScheduleView({ hasTimedSets: true, phase: 'pre' })).toBe('cards');
    expect(defaultScheduleView({ hasTimedSets: true, phase: 'post' })).toBe('cards');
    expect(defaultScheduleView({ hasTimedSets: true, phase: null })).toBe('cards');
  });
});

describe('genre filter', () => {
  const g = (id: string, genres: string[]) =>
    set(id, 'A', id, { artists: [{ name: id, genres }] as FestivalSet['artists'] });
  const gs = [g('h', ['House']), g('t', ['Techno']), g('d', ['Deep House']), set('n', 'A', 'none')];
  it('keeps sets that share a genre, case-insensitively, never by substring', () => {
    expect(filterScheduleSets(gs, { ...base, genres: ['house'] }).map((s) => s.id)).toEqual(['h']);
    expect(filterScheduleSets(gs, { ...base, genres: ['house', 'techno'] }).map((s) => s.id)).toEqual(['h', 't']);
  });
  it('treats empty or missing as off', () => {
    expect(filterScheduleSets(gs, { ...base, genres: [] })).toHaveLength(4);
    expect(filterScheduleSets(gs, base)).toHaveLength(4);
  });
  it('toggles a genre on and off', () => {
    expect(toggleGenreFilter([], 'house')).toEqual(['house']);
    expect(toggleGenreFilter(['house', 'techno'], 'House')).toEqual(['techno']);
  });
  it('has an empty reason after stages, and its copy', () => {
    const f = { query: '', onlyMine: false, hasAnyPick: false, stageFilterActive: false };
    expect(scheduleEmptyReason({ ...f, genreFilterActive: true })).toBe('genres');
    expect(scheduleEmptyReason({ ...f, stageFilterActive: true, genreFilterActive: true })).toBe('stages');
    expect(scheduleEmptyCopy('genres', 'Sunday')).toEqual({
      title: 'Nothing in these genres on Sunday',
      message: 'Your genre filter hides every set on this day.',
      actionLabel: 'All genres',
    });
  });
});
