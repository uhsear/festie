import type { FestivalSet, Stage, Priority } from '../types/domain';
import type { FestivalPhase } from './festivalTime';
import { setMatchesSearch } from './setSearch';
import { byStartTime } from './scheduleFormat';
import { artistDisplayName, formatTime } from './format';

export type ScheduleView = 'cards' | 'timeline' | 'grid';

/** One view order and one set of names for web and mobile. */
export const SCHEDULE_VIEWS: readonly { key: ScheduleView; label: string }[] = [
  { key: 'cards', label: 'Cards' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'grid', label: 'Grid' },
];

export function isScheduleView(v: unknown): v is ScheduleView {
  return v === 'cards' || v === 'timeline' || v === 'grid';
}

/** Timeline only while the festival is live and has timed sets; Cards otherwise. */
export function defaultScheduleView(o: { hasTimedSets: boolean; phase: FestivalPhase | null }): 'cards' | 'timeline' {
  return o.hasTimedSets && o.phase === 'live' ? 'timeline' : 'cards';
}

export type ScheduleGroupBy = 'time' | 'stage' | 'az';

/** Cards "Group by" options, in display order. Time is the default. */
export const SCHEDULE_GROUP_BYS: readonly { key: ScheduleGroupBy; label: string }[] = [
  { key: 'time', label: 'Time' },
  { key: 'stage', label: 'Stage' },
  { key: 'az', label: 'A-Z' },
];

export function isScheduleGroupBy(v: unknown): v is ScheduleGroupBy {
  return v === 'time' || v === 'stage' || v === 'az';
}

export interface ScheduleSetGroup {
  key: string;
  label: string;
  sets: FestivalSet[];
}

/** The name a set files under in A-Z: a B2B set goes under its first artist. */
function azName(set: FestivalSet, b2bSeparator?: string): string {
  return (set.artists && set.artists.length > 1 ? set.artists[0]!.name : artistDisplayName(set, b2bSeparator)).trim();
}

/** First letter (accents folded) of the A-Z name, or "#" for a digit or symbol. */
export function azGroupKey(set: FestivalSet, b2bSeparator?: string): string {
  const ch = azName(set, b2bSeparator).normalize('NFD').charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(ch) ? ch : '#';
}

const byName = (b2bSeparator?: string) => (a: FestivalSet, b: FestivalSet) =>
  azName(a, b2bSeparator).localeCompare(azName(b, b2bSeparator), undefined, { sensitivity: 'base' });

function groupRuns(
  sorted: FestivalSet[],
  keyOf: (s: FestivalSet) => string,
  labelOf: (key: string) => string,
): ScheduleSetGroup[] {
  const groups: ScheduleSetGroup[] = [];
  for (const set of sorted) {
    const key = keyOf(set);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.sets.push(set);
    else groups.push({ key, label: labelOf(key), sets: [set] });
  }
  return groups;
}

/**
 * Cards sections. Time: by start hour in festival-day order, so after-midnight
 * sets stay at the end of their festival day (T1); TBA sets last. Stage: festival
 * stage order. A-Z: first letter of the first artist, "#" last.
 */
export function groupScheduleSets(
  sets: readonly FestivalSet[],
  groupBy: ScheduleGroupBy,
  stages: readonly Stage[],
  b2bSeparator?: string,
): ScheduleSetGroup[] {
  const name = byName(b2bSeparator);
  if (groupBy === 'stage') {
    const order = new Map(stages.map((st, i) => [st.id, i]));
    const rank = (s: FestivalSet) => order.get(s.stageId) ?? stages.length;
    const sorted = [...sets].sort((a, b) => rank(a) - rank(b) || byStartTime(a, b) || name(a, b));
    return groupRuns(
      sorted,
      (s) => (order.has(s.stageId) ? s.stageId : ''),
      (key) => stages.find((st) => st.id === key)?.name ?? 'Other stages',
    );
  }
  if (groupBy === 'az') {
    const keyOf = (s: FestivalSet) => azGroupKey(s, b2bSeparator);
    const sorted = [...sets].sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka !== kb) return ka === '#' ? 1 : kb === '#' ? -1 : ka.localeCompare(kb);
      return name(a, b);
    });
    return groupRuns(sorted, keyOf, (key) => key);
  }
  const sorted = [...sets].sort((a, b) => byStartTime(a, b) || name(a, b));
  return groupRuns(
    sorted,
    (s) => (s.startTime ? s.startTime.slice(0, 2) : 'tba'),
    (key) => (key === 'tba' ? 'TBA' : formatTime(`${key}:00`)),
  );
}

type Picks = Record<string, Priority | null | undefined> | null | undefined;

export function hasAnyPick(picks: Picks): boolean {
  return !!picks && Object.values(picks).some(Boolean);
}

export function isStageFilterActive(activeStages: readonly string[], stageCount: number): boolean {
  return activeStages.length > 0 && activeStages.length < stageCount;
}

/**
 * Tap-to-show-only stage chips. An empty selection means "all stages". The
 * result keeps festival stage order and never hides everything: an empty or
 * all-stages result collapses to [].
 */
export function toggleStageFilter(
  activeStages: readonly string[],
  allStageIds: readonly string[],
  id: string,
): string[] {
  if (activeStages.length === 0) return [id];
  const next = new Set(activeStages);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  const ordered = allStageIds.filter((s) => next.has(s));
  if (ordered.length === 0 || ordered.length >= allStageIds.length) return [];
  return ordered;
}

/** Stage, then "My picks" (only when a pick exists), then search. Does not filter by day. */
export function filterScheduleSets(
  sets: readonly FestivalSet[],
  o: {
    activeStages: readonly string[];
    stages: readonly Stage[];
    onlyMine: boolean;
    picks: Picks;
    query: string;
  },
): FestivalSet[] {
  const stageOn = isStageFilterActive(o.activeStages, o.stages.length);
  const mineOn = o.onlyMine && hasAnyPick(o.picks);
  return sets.filter((set) => {
    if (stageOn && !o.activeStages.includes(set.stageId)) return false;
    if (mineOn && !o.picks?.[set.id]) return false;
    return setMatchesSearch(set, o.query, o.stages as Stage[]);
  });
}

export type ScheduleEmptyReason = 'search' | 'picks' | 'stages' | 'day';

export function scheduleEmptyReason(o: {
  query: string;
  onlyMine: boolean;
  hasAnyPick: boolean;
  stageFilterActive: boolean;
}): ScheduleEmptyReason {
  if (o.query.trim() !== '') return 'search';
  if (o.onlyMine && o.hasAnyPick) return 'picks';
  if (o.stageFilterActive) return 'stages';
  return 'day';
}

export function scheduleEmptyCopy(
  reason: Exclude<ScheduleEmptyReason, 'search'>,
  dayLabel: string,
): { title: string; message: string; actionLabel?: string } {
  switch (reason) {
    case 'picks':
      return {
        title: 'No picks for this day yet',
        message: 'Tap a priority on any set to add it here, or browse the full lineup.',
        actionLabel: 'Show all sets',
      };
    case 'stages':
      return {
        title: `Nothing on these stages on ${dayLabel}`,
        message: 'Your stage filter hides every set on this day.',
        actionLabel: 'All stages',
      };
    default:
      return {
        title: 'No sets for this day',
        message: 'Pick another day from the day selector to browse the schedule.',
      };
  }
}

/**
 * Search empty-state copy for both apps. A selected-day match that the stage or
 * My picks filter hides blames the filter, never the search.
 */
export function searchEmptyCopy(
  query: string,
  dayLabel: string,
  hasOtherDayMatches: boolean,
  hiddenByFilters = false,
): { title: string; message: string; actionLabel: 'Clear filters' | 'Clear search' } {
  const q = query.trim();
  if (hiddenByFilters) {
    return {
      title: `“${q}” is hidden by your filters`,
      message: 'Your stage or My picks filters hide it. Clear them to see it.',
      actionLabel: 'Clear filters',
    };
  }
  if (hasOtherDayMatches) return { title: `No “${q}” on ${dayLabel}`, message: 'Found on other days:', actionLabel: 'Clear search' };
  return {
    title: `No artist called “${q}” in this lineup`,
    message: 'Check the spelling, or clear the search to see everyone.',
    actionLabel: 'Clear search',
  };
}

/** True when a set on this day matches the search but the stage or My picks filter hides it. */
export function searchHiddenByFilters(
  daySets: readonly FestivalSet[],
  query: string,
  stages: readonly Stage[],
): boolean {
  return query.trim() !== '' && daySets.some((s) => setMatchesSearch(s, query, stages as Stage[]));
}

export function scheduleResultsSummary(o: {
  count: number;
  onlyMine: boolean;
  activeStageCount: number;
  tbaCount?: number;
}): string {
  let text = `${o.count} ${o.count === 1 ? 'set' : 'sets'}`;
  if (o.onlyMine) text += ' · my picks';
  if (o.activeStageCount > 0) text += ` · ${o.activeStageCount} ${o.activeStageCount === 1 ? 'stage' : 'stages'}`;
  if (o.tbaCount && o.tbaCount > 0) text += ` · ${o.tbaCount} TBA`;
  return text;
}

/** Day indexes not hidden, plus the selected day so the open day never vanishes. */
export function visibleDayIndexes(dayCount: number, hiddenDays: readonly number[], selectedDay: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < dayCount; i++) {
    if (!hiddenDays.includes(i) || i === selectedDay) out.push(i);
  }
  return out;
}

/** Adds or removes `index`. Refuses (returns the input) when every day would be hidden. */
export function toggleHiddenDay(hiddenDays: readonly number[], dayCount: number, index: number): number[] {
  const next = new Set(hiddenDays);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  const sorted = [...next].sort((a, b) => a - b);
  const hiddenInRange = sorted.filter((d) => d >= 0 && d < dayCount).length;
  if (dayCount > 0 && hiddenInRange >= dayCount) return hiddenDays as number[];
  return sorted;
}

export interface ScheduleFilterPrefs {
  view: ScheduleView | null;
  activeStages: string[];
  onlyMine: boolean;
  searchQuery: string;
  hiddenDays: number[];
  dismissedPhase: FestivalPhase | null;
  /** Cards "Group by"; null = Time. */
  groupBy: ScheduleGroupBy | null;
}

export const EMPTY_SCHEDULE_PREFS: ScheduleFilterPrefs = {
  view: null,
  activeStages: [],
  onlyMine: false,
  searchQuery: '',
  hiddenDays: [],
  dismissedPhase: null,
  groupBy: null,
};

const SEARCH_QUERY_MAX = 100;

/** Never throws. Clamps stored prefs to the festival's current stages and days. */
export function sanitizeSchedulePrefs(
  raw: unknown,
  scope: { stageIds: readonly string[]; dayCount: number },
): ScheduleFilterPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_SCHEDULE_PREFS };
  const r = raw as Record<string, unknown>;

  const wanted = new Set(Array.isArray(r.activeStages) ? r.activeStages : []);
  const stages = scope.stageIds.filter((id) => wanted.has(id));
  const activeStages = stages.length >= scope.stageIds.length ? [] : stages;

  const days = Array.isArray(r.hiddenDays)
    ? [...new Set(r.hiddenDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d < scope.dayCount))]
    : [];
  const hiddenDays = days.length >= scope.dayCount ? [] : days.sort((a, b) => a - b);

  const phase = r.dismissedPhase;
  return {
    view: isScheduleView(r.view) ? r.view : null,
    activeStages,
    onlyMine: r.onlyMine === true,
    searchQuery: typeof r.searchQuery === 'string' ? r.searchQuery.slice(0, SEARCH_QUERY_MAX) : '',
    hiddenDays,
    dismissedPhase: phase === 'pre' || phase === 'live' || phase === 'post' ? phase : null,
    groupBy: isScheduleGroupBy(r.groupBy) ? r.groupBy : null,
  };
}
