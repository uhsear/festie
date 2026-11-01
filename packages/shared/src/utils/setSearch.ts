import type { FestivalSet, Stage } from '../types/domain';
import { byStartTime } from './scheduleFormat';

/**
 * Lineup search match, shared by web and mobile. Case-insensitive substring
 * match on the headline artist, any B2B artist name, or the stage name. An
 * empty (or whitespace-only) query matches every set.
 */
export function setMatchesSearch(set: FestivalSet, query: string, stages: Stage[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (set.artist?.toLowerCase().includes(q)) return true;
  if (set.artists?.some((a) => a.name.toLowerCase().includes(q))) return true;
  return stages.find((s) => s.id === set.stageId)?.name.toLowerCase().includes(q) ?? false;
}

/**
 * Search matches on every day except `selectedDay`, grouped by day in ascending
 * order and sorted by start time (TBA last). Ignores the stage and "my picks"
 * filters on purpose: the user is looking for an artist. A blank query returns
 * no groups.
 */
export function searchOtherDays(
  sets: FestivalSet[],
  query: string,
  selectedDay: number,
  stages: Stage[],
): Array<{ dayIndex: number; sets: FestivalSet[] }> {
  if (!query.trim()) return [];
  const byDay = new Map<number, FestivalSet[]>();
  for (const set of sets) {
    if (set.dayIndex == null || set.dayIndex === selectedDay) continue;
    if (!setMatchesSearch(set, query, stages)) continue;
    const group = byDay.get(set.dayIndex);
    if (group) group.push(set);
    else byDay.set(set.dayIndex, [set]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayIndex, daySets]) => ({ dayIndex, sets: daySets.sort(byStartTime) }));
}

/**
 * Empty-state copy for a search that shows no cards on the selected day, shared
 * by web and mobile. A match on the selected day that the stage or "my picks"
 * filters hide gets filter copy (`hiddenByFilters`), never "not in this lineup".
 */
export function searchEmptyCopy(opts: {
  sets: FestivalSet[];
  query: string;
  selectedDay: number;
  stages: Stage[];
  otherDayCount: number;
  dayLabel?: string;
}): { hiddenByFilters: boolean; title: string; description: string } {
  const q = opts.query.trim();
  const hiddenByFilters = opts.sets.some(
    (s) => s.dayIndex === opts.selectedDay && setMatchesSearch(s, q, opts.stages),
  );
  if (hiddenByFilters) {
    return {
      hiddenByFilters,
      title: `“${q}” is hidden by your filters`,
      description: 'Your stage or My picks filters hide it. Clear them to see it.',
    };
  }
  if (opts.otherDayCount > 0) {
    return { hiddenByFilters, title: `No “${q}” on ${opts.dayLabel ?? 'this day'}`, description: 'Found on other days:' };
  }
  return {
    hiddenByFilters,
    title: `No artist called “${q}” in this lineup`,
    description: 'Check the spelling, or clear the search to see everyone.',
  };
}
