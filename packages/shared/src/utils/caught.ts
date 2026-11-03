import type { FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import type { WrapCaughtSet, WrapPlannedSet, WrapResponse } from '../types/wrap';
import { resolveFestivalTimeZone } from './festivalTime';
import { artistDisplayName } from './format';
import { setMatchesSearch } from './setSearch';
import { festivalStartMinutes, getSetTimeBounds } from './setStatus';
import { isWrapUnlocked } from './wrap';

export const CATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface CatchableSet {
  set: FestivalSet;
  startMs: number;
  endMs: number;
  live: boolean;
}

/** Picks that are live now or ended within CATCH_WINDOW_MS. Live first (earliest end first), then ended (latest end first). */
export function selectCatchable(input: {
  sets: FestivalSet[];
  days: FestivalDay[];
  picks: Record<string, Priority> | null | undefined;
  nowMs: number;
  timeZone?: string;
  limit?: number;
}): CatchableSet[] {
  const { sets, days, picks, nowMs, timeZone, limit = 3 } = input;
  if (!picks) return [];
  const items: CatchableSet[] = [];
  for (const set of sets) {
    if (!picks[set.id]) continue;
    const b = getSetTimeBounds(set, days, timeZone);
    if (!b || b.startMs > nowMs || b.endMs <= nowMs - CATCH_WINDOW_MS) continue;
    items.push({ set, startMs: b.startMs, endMs: b.endMs, live: b.endMs > nowMs });
  }
  return items
    .sort((a, b) => Number(b.live) - Number(a.live) || (a.live ? a.endMs - b.endMs : b.endMs - a.endMs))
    .slice(0, limit);
}

/** Flatten a festival detail into sets with dayIndex and date, as festivalDataStore does. */
export function lineupFromDays(days: Array<{ date: string; sets?: FestivalSet[] }>): FestivalSet[] {
  return days.flatMap((day, dayIndex) => (day.sets ?? []).map((s) => ({ ...s, dayIndex, date: day.date })));
}

export interface ChecklistRow {
  setId: string;
  artist: string | null;
  stageName: string | null;
  startTime: string | null;
  dayIndex: number | null;
  rating: number | null;
  caught: boolean | null;
  /** True for caughtExtra rows. */
  added: boolean;
  /** Set has started; a TBA row counts as started once the festival is over. */
  started: boolean;
}
export interface ChecklistDay {
  dayIndex: number | null;
  label: string;
  rows: ChecklistRow[];
}

const startKey = (t: string | null | undefined) => (t ? festivalStartMinutes(t) : Infinity);

/** Picks plus added sets, grouped by day (TBA day last), each day in festival-day start order. */
export function buildCaughtChecklist(
  wrap: WrapResponse,
  nowMs: number = Date.now(),
): { days: ChecklistDay[]; counts: { saw: number; skipped: number; toMark: number } } {
  const zone = resolveFestivalTimeZone(wrap.festival);
  const festDays = wrap.festival.days;
  const unlocked = isWrapUnlocked(wrap.festival, new Date(nowMs));
  const sources: Array<{ s: WrapPlannedSet | WrapCaughtSet; added: boolean }> = [
    ...wrap.planned.map((s) => ({ s, added: false })),
    ...(wrap.caughtExtra ?? []).filter((s) => s.caught !== null).map((s) => ({ s, added: true })),
  ];
  const rows: ChecklistRow[] = sources.map(({ s, added }) => {
    const bounds = s.startTime
      ? getSetTimeBounds(
          { startTime: s.startTime, endTime: s.endTime ?? '', dayIndex: s.dayIndex ?? undefined },
          festDays,
          zone,
        )
      : null;
    return {
      setId: s.setId,
      artist: s.artist,
      stageName: s.stageName,
      startTime: s.startTime,
      dayIndex: s.dayIndex,
      rating: s.rating,
      caught: s.caught,
      added,
      started: bounds ? bounds.startMs <= nowMs : unlocked,
    };
  });

  const byDay = new Map<number | null, ChecklistRow[]>();
  for (const r of rows) byDay.set(r.dayIndex, [...(byDay.get(r.dayIndex) ?? []), r]);
  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([dayIndex, dayRows]) => ({
      dayIndex,
      label: dayIndex === null ? 'TBA' : (festDays[dayIndex]?.label ?? `Day ${dayIndex + 1}`),
      rows: dayRows.sort((a, b) => startKey(a.startTime) - startKey(b.startTime)),
    }));

  return {
    days,
    counts: {
      saw: rows.filter((r) => r.caught === true).length,
      skipped: rows.filter((r) => r.caught === false).length,
      toMark: rows.filter((r) => r.started && r.caught === null).length,
    },
  };
}

/** Sets the user can add: not excluded, started (or TBA once the festival is over), matching the query. Sorted by day then start. */
export function findSetsToAdd(input: {
  lineup: FestivalSet[];
  days: FestivalDay[];
  excludeIds: ReadonlySet<string>;
  query: string;
  stages: Stage[];
  nowMs: number;
  timeZone?: string;
  festivalOver: boolean;
  limit?: number;
}): FestivalSet[] {
  const { lineup, days, excludeIds, query, stages, nowMs, timeZone, festivalOver, limit = 20 } = input;
  if (!query.trim()) return [];
  return lineup
    .filter((set) => {
      if (excludeIds.has(set.id)) return false;
      const b = getSetTimeBounds(set, days, timeZone);
      if (b ? b.startMs > nowMs : !festivalOver) return false;
      return setMatchesSearch(set, query, stages);
    })
    .sort(
      (a, b) =>
        (a.dayIndex ?? Infinity) - (b.dayIndex ?? Infinity) || startKey(a.startTime) - startKey(b.startTime),
    )
    .slice(0, limit);
}

/** WrapCaughtSet for a lineup set, for the optimistic "Add" row. */
export function caughtSetFromLineup(set: FestivalSet, stageName: string | null, b2bSeparator?: string): WrapCaughtSet {
  return {
    setId: set.id,
    artist: artistDisplayName(set, b2bSeparator),
    stageId: set.stageId ?? null,
    stageName,
    dayIndex: set.dayIndex ?? null,
    startTime: set.startTime || null,
    endTime: set.endTime || null,
    rating: null,
    note: null,
    caught: true,
  };
}

/** Copy of the wrap data with one mark applied. A null mark on an added row removes that row. */
export function applyCaughtMark(
  wrap: WrapResponse,
  setId: string,
  caught: boolean | null,
  added?: WrapCaughtSet,
): WrapResponse {
  if (wrap.planned.some((s) => s.setId === setId)) {
    return { ...wrap, planned: wrap.planned.map((s) => (s.setId === setId ? { ...s, caught } : s)) };
  }
  const extra = wrap.caughtExtra ?? [];
  if (extra.some((s) => s.setId === setId)) {
    return {
      ...wrap,
      caughtExtra:
        caught === null
          ? extra.filter((s) => s.setId !== setId)
          : extra.map((s) => (s.setId === setId ? { ...s, caught } : s)),
    };
  }
  return added ? { ...wrap, caughtExtra: [...extra, { ...added, caught }] } : wrap;
}

/** The shown mark for one set: the overlay value when present, else planned/caughtExtra, else null. */
export function caughtFor(
  wrap: WrapResponse | undefined,
  overlay: ReadonlyMap<string, boolean | null>,
  setId: string,
): boolean | null {
  if (overlay.has(setId)) return overlay.get(setId) ?? null;
  const row = wrap?.planned.find((s) => s.setId === setId) ?? wrap?.caughtExtra?.find((s) => s.setId === setId);
  return row?.caught ?? null;
}

/** "Playing now · Main", "Ended 12 min ago · Main", "Ended 1 h ago". Missing stage is left out. */
export function catchableMeta(item: CatchableSet, nowMs: number, stageName?: string | null): string {
  let when = 'Playing now';
  if (!item.live) {
    const m = Math.floor((nowMs - item.endMs) / 60000);
    when = m < 1 ? 'Ended just now' : m < 60 ? `Ended ${m} min ago` : `Ended ${Math.floor(m / 60)} h ago`;
  }
  return stageName ? `${when} · ${stageName}` : when;
}

/** "3 seen · 1 skipped · 2 to mark", leaving out zero parts; '' when all are zero. */
export function checklistCountLine(counts: { saw: number; skipped: number; toMark: number }): string {
  return [
    counts.saw && `${counts.saw} seen`,
    counts.skipped && `${counts.skipped} skipped`,
    counts.toMark && `${counts.toMark} to mark`,
  ]
    .filter(Boolean)
    .join(' · ');
}
