import type { FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import { PRIORITY_OPTIONS } from '../constants/config';
import { artistDisplayName } from './format';
import { getSetTimeBounds, isSetScheduled } from './setStatus';
import { setMatchesSearch } from './setSearch';

// ── My Picks plan: stats, filters, grouping and bulk-add helpers ──────────────
// Pure (RN + web safe). One source of truth so web and mobile Picks show the
// same counts, groups and messages. Rows carry a `priority`, never a colour:
// each platform maps it to its own token.

export type PicksGroupMode = 'day' | 'priority';
/** 'openers' = earliest set first (the default); 'headliners' = latest set first. */
export type PicksOrder = 'openers' | 'headliners';
export type PicksFilter = 'all' | Priority | 'clashes';
export interface PicksStats {
  must: number;
  want: number;
  maybe: number;
  total: number;
  clashes: number;
}

export type PicksRow =
  | { kind: 'group'; key: string; groupId: string; label: string; count: number; priority?: Priority; collapsed: boolean }
  | { kind: 'subgroup'; key: string; label: string; count: number; priority?: Priority }
  | { kind: 'set'; key: string; set: FestivalSet; priority: Priority };

export const BULK_SCOPE_LABEL = 'all days';

const UNSCHEDULED_LABEL = 'Unscheduled';

/** Counts each set in `sets` that has a pick. `clashes` is the clash id count. */
export function picksStats(
  sets: FestivalSet[],
  picks: Record<string, Priority> | undefined,
  clashIds: ReadonlySet<string>,
): PicksStats {
  let must = 0;
  let want = 0;
  let maybe = 0;
  for (const s of sets) {
    const p = picks?.[s.id];
    if (p === 'must') must += 1;
    else if (p === 'want-to-see') want += 1;
    else if (p === 'maybe') maybe += 1;
  }
  return { must, want, maybe, total: must + want + maybe, clashes: clashIds.size };
}

/** A "clashes" focus falls back to "all" once the last clash is resolved. */
export function effectivePicksFilter(filter: PicksFilter, stats: Pick<PicksStats, 'clashes'>): PicksFilter {
  return filter === 'clashes' && stats.clashes === 0 ? 'all' : filter;
}

/**
 * Start-time-then-name comparator. Sorts by the resolved absolute start (TZ- and
 * post-midnight-aware), not the raw 'HH:mm' string, so a 01:00 set follows 23:00.
 * Sets whose time cannot be resolved sink below timed ones, then tiebreak by name.
 * 'headliners' reverses only the time order, so a 01:00 set comes before 23:00.
 */
export function comparePicksByTime(
  days: FestivalDay[],
  timeZone?: string,
  b2bSeparator?: string,
  order: PicksOrder = 'openers',
): (a: FestivalSet, b: FestivalSet) => number {
  const dir = order === 'headliners' ? -1 : 1;
  return (a, b) => {
    const boundsA = getSetTimeBounds(a, days, timeZone);
    const boundsB = getSetTimeBounds(b, days, timeZone);
    if (boundsA && boundsB) {
      if (boundsA.startMs !== boundsB.startMs) return dir * (boundsA.startMs - boundsB.startMs);
    } else if (boundsA && !boundsB) return -1;
    else if (!boundsA && boundsB) return 1;
    return artistDisplayName(a, b2bSeparator).localeCompare(artistDisplayName(b, b2bSeparator), undefined, {
      sensitivity: 'base',
    });
  };
}

/**
 * Flattened row list. In `day` mode the outer header is the festival day and the
 * inner sub-group is the priority tier (must, want, maybe); `priority` mode
 * inverts that nesting. Search + the focus filter prune sets first; a collapsed
 * group emits only its header; empty groups are skipped. Picks on no real day
 * land in "Unscheduled" so the plan is complete.
 */
export function buildPicksRows(input: {
  sets: FestivalSet[];
  picks: Record<string, Priority> | undefined;
  days: FestivalDay[];
  stages: Stage[];
  groupMode: PicksGroupMode;
  filter: PicksFilter;
  search: string;
  collapsed: ReadonlySet<string>;
  clashIds: ReadonlySet<string>;
  compare: (a: FestivalSet, b: FestivalSet) => number;
}): PicksRow[] {
  const { sets, picks, days, stages, groupMode, filter, search, collapsed, clashIds, compare } = input;

  const eligible = sets.filter((s) => {
    const p = picks?.[s.id];
    if (!p) return false;
    if (!setMatchesSearch(s, search, stages)) return false;
    if (filter === 'clashes') return clashIds.has(s.id);
    if (filter !== 'all' && p !== filter) return false;
    return true;
  });

  const out: PicksRow[] = [];
  const prioOf = (s: FestivalSet) => picks![s.id]!;
  const pushSets = (list: FestivalSet[]) =>
    list.sort(compare).forEach((set) => out.push({ kind: 'set', key: `set-${set.id}`, set, priority: prioOf(set) }));

  // Day buckets in day order, then the unscheduled bucket.
  const dayBuckets = [
    ...days.map((day, i) => ({
      id: String(i),
      label: day.label || day.date,
      sets: eligible.filter((s) => s.dayIndex === i),
    })),
    { id: 'tba', label: UNSCHEDULED_LABEL, sets: eligible.filter((s) => !isSetScheduled(s, days)) },
  ].filter((b) => b.sets.length > 0);

  if (groupMode === 'day') {
    for (const bucket of dayBuckets) {
      const groupId = `day-${bucket.id}`;
      const isCollapsed = collapsed.has(groupId);
      out.push({
        kind: 'group',
        key: `g-${groupId}`,
        groupId,
        label: bucket.label,
        count: bucket.sets.length,
        collapsed: isCollapsed,
      });
      if (isCollapsed) continue;
      for (const opt of PRIORITY_OPTIONS) {
        const picked = bucket.sets.filter((s) => prioOf(s) === opt.value);
        if (picked.length === 0) continue;
        out.push({
          kind: 'subgroup',
          key: `sg-${bucket.id}-${opt.value}`,
          label: opt.label,
          count: picked.length,
          priority: opt.value,
        });
        pushSets(picked);
      }
    }
    return out;
  }

  for (const opt of PRIORITY_OPTIONS) {
    const tierSets = eligible.filter((s) => prioOf(s) === opt.value);
    if (tierSets.length === 0) continue;
    const groupId = `prio-${opt.value}`;
    const isCollapsed = collapsed.has(groupId);
    out.push({
      kind: 'group',
      key: `g-${groupId}`,
      groupId,
      label: opt.label,
      count: tierSets.length,
      priority: opt.value,
      collapsed: isCollapsed,
    });
    if (isCollapsed) continue;
    for (const bucket of dayBuckets) {
      const picked = tierSets.filter((s) => bucket.sets.includes(s));
      if (picked.length === 0) continue;
      out.push({ kind: 'subgroup', key: `sg-${opt.value}-${bucket.id}`, label: bucket.label, count: picked.length });
      pushSets(picked);
    }
  }
  return out;
}

/** 60 -> '1h', 15 -> '15m', 90 -> '90m'. */
export function reminderLeadLabel(minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

/** 60 -> '1 hour', 15 -> '15 minutes', 1 -> '1 minute'. */
export function reminderLeadA11y(minutes: number): string {
  const hours = minutes >= 60 && minutes % 60 === 0;
  const n = hours ? minutes / 60 : minutes;
  return `${n} ${hours ? 'hour' : 'minute'}${n === 1 ? '' : 's'}`;
}

export interface BulkPickGroup {
  key: string;
  label: string;
  setIds: string[];
}

/** Group every set by stage (stage order) and by artist genre, for one-tap bulk add. */
export function buildBulkPickGroups(
  sets: FestivalSet[],
  stages: Stage[],
  getStageName: (stageId: string) => string | undefined,
): { stages: BulkPickGroup[]; genres: BulkPickGroup[] } {
  const byStage = new Map<string, string[]>();
  for (const s of sets) {
    const arr = byStage.get(s.stageId);
    if (arr) arr.push(s.id);
    else byStage.set(s.stageId, [s.id]);
  }
  const order = new Map<string, number>();
  stages.forEach((st, i) => order.set(st.id, i));
  const stageGroups = [...byStage.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map(([stageId, setIds]) => ({ key: `stage-${stageId}`, label: getStageName(stageId) || 'Stage', setIds }));

  const byGenre = new Map<string, string[]>();
  // Lowercase only the dedupe key; keep the first-seen casing for the label.
  const labelByKey = new Map<string, string>();
  for (const s of sets) {
    const seen = new Set<string>();
    for (const a of s.artists ?? []) {
      for (const g of a.genres ?? []) {
        const display = g.trim();
        const key = display.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (!labelByKey.has(key)) labelByKey.set(key, display);
        const arr = byGenre.get(key);
        if (arr) arr.push(s.id);
        else byGenre.set(key, [s.id]);
      }
    }
  }
  const genres = [...byGenre.entries()]
    .map(([key, setIds]) => ({ key: `genre-${key}`, label: labelByKey.get(key) ?? key, setIds }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { stages: stageGroups, genres };
}

/** Toast text for a bulk add: the true count, and how many were already picked. */
export function bulkAddMessage(o: { changed: number; total: number; label: string; priority: Priority }): string {
  if (o.changed === 0) return `Nothing new to add from ${o.label}.`;
  const skipped = o.total - o.changed;
  const priorityLabel = PRIORITY_OPTIONS.find((p) => p.value === o.priority)?.label ?? o.priority;
  return (
    `Added ${o.changed} ${o.changed === 1 ? 'set' : 'sets'} from ${o.label} to ${priorityLabel}` +
    (skipped > 0 ? ` (${skipped} already picked)` : '') +
    '.'
  );
}
