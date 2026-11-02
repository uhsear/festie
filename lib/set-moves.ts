// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * "Moved" marks on festival sets (T46). When an admin moves a set in a published
 * festival, the server stores when and where it was, and the app says
 * "Moved from Sat 10:00 PM, Sahara" for 48 hours. Pure functions, no DB access.
 */

export const SET_MOVE_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface SetMovedFrom {
  dayIndex: number;
  stageId: string | null;
  start: string | null;
  end: string | null;
}
export type MoveMark = { movedAt: Date; movedFrom: SetMovedFrom } | null;
export type SlotAt = {
  dayKey: string;
  dayIndex: number;
  stageId: string | null;
  start: string | null;
  end: string | null;
};

type DayLike = { date?: string | null; label?: string | null };

const orNull = (v: string | null | undefined) => v || null;

// Keep in sync with indexSets in lib/schedule-diff.ts, which keys days the same way.
export function dayKeyOf(day: DayLike, dayIndex: number): string {
  return day.date || day.label || `#${dayIndex}`;
}

/** Keys for one day layout. When two days share a key, every day falls back to its position. */
export function dayKeysOf(days: (DayLike & { dayIndex: number })[]): Map<number, string> {
  const keys = days.map((d) => dayKeyOf(d, d.dayIndex));
  const unique = new Set(keys).size === keys.length;
  return new Map(days.map((d, i) => [d.dayIndex, unique ? keys[i]! : `#${d.dayIndex}`]));
}

function sameSlot(a: Omit<SetMovedFrom, 'dayIndex'>, b: Omit<SetMovedFrom, 'dayIndex'>): boolean {
  return (
    orNull(a.stageId) === orNull(b.stageId) && orNull(a.start) === orNull(b.start) && orNull(a.end) === orNull(b.end)
  );
}

export function nextMoveMark(prior: MoveMark, before: SlotAt, after: SlotAt, now: Date): MoveMark {
  const fresh = !!prior && now.getTime() - prior.movedAt.getTime() < SET_MOVE_WINDOW_MS;
  const keep = fresh ? prior : null;
  if (before.dayKey === after.dayKey && sameSlot(before, after)) return keep;
  // The old day is gone or cannot be traced (edited in place, positions shifted): same stage and time is not a move.
  if (before.dayIndex < 0 && sameSlot(before, after)) return keep;
  const tbaToTime =
    !orNull(before.start) &&
    !!orNull(after.start) &&
    before.dayKey === after.dayKey &&
    orNull(before.stageId) === orNull(after.stageId);
  if (tbaToTime) return keep;
  if (fresh && prior) {
    if (after.dayIndex === prior.movedFrom.dayIndex && sameSlot(after, prior.movedFrom)) return null;
    return { movedAt: now, movedFrom: prior.movedFrom };
  }
  return {
    movedAt: now,
    movedFrom: {
      dayIndex: before.dayIndex,
      stageId: orNull(before.stageId),
      start: orNull(before.start),
      end: orNull(before.end),
    },
  };
}

export type StoredDay = DayLike & { dayIndex: number };
export type StoredSet = {
  id: string;
  dayIndex: number;
  stageId: string | null;
  start: string | null;
  end: string | null;
  movedAt?: Date | string | null;
  movedFrom?: SetMovedFrom | null;
};

/**
 * Marks for every set that exists in both layouts. A set's old day and its prior
 * movedFrom day are remapped to the new layout by day key; a gone day maps to -1,
 * and a prior whose movedFrom day is gone is dropped. Positional keys ('#n') map to -1
 * when the day count changes. Returns non-null marks only.
 */
export function planMoveMarks(
  oldDays: StoredDay[],
  oldSets: StoredSet[],
  newDays: StoredDay[],
  newSets: StoredSet[],
  now: Date,
): { id: string; movedAt: Date; movedFrom: SetMovedFrom }[] {
  const oldKeys = dayKeysOf(oldDays);
  const newKeys = dayKeysOf(newDays);
  const newIndexByKey = new Map([...newKeys].map(([index, key]) => [key, index]));
  const oldKey = (dayIndex: number) => oldKeys.get(dayIndex) ?? `#${dayIndex}`;
  const sameDayCount = oldDays.length === newDays.length;
  // A positional key names a different day once a day is added or removed, so it cannot be remapped.
  const remap = (dayIndex: number) => {
    const key = oldKey(dayIndex);
    return key.startsWith('#') && !sameDayCount ? -1 : (newIndexByKey.get(key) ?? -1);
  };
  const oldById = new Map(oldSets.map((s) => [s.id, s]));
  const marks: { id: string; movedAt: Date; movedFrom: SetMovedFrom }[] = [];
  for (const next of newSets) {
    const old = oldById.get(next.id);
    if (!old) continue;
    const before: SlotAt = { ...old, dayKey: oldKey(old.dayIndex), dayIndex: remap(old.dayIndex) };
    const after: SlotAt = { ...next, dayKey: newKeys.get(next.dayIndex) ?? `#${next.dayIndex}` };
    const mark = nextMoveMark(priorMark(old, remap), before, after, now);
    if (mark) marks.push({ id: next.id, ...mark });
  }
  return marks;
}

function priorMark(old: StoredSet, remap: (dayIndex: number) => number): MoveMark {
  if (!old.movedAt || !old.movedFrom) return null;
  const movedAt = new Date(old.movedAt);
  const dayIndex = old.movedFrom.dayIndex < 0 ? -1 : remap(old.movedFrom.dayIndex);
  if (Number.isNaN(movedAt.getTime()) || dayIndex < 0) return null;
  return { movedAt, movedFrom: { ...old.movedFrom, dayIndex } };
}

/** True when movedAt parses and is under 48 hours old. A future movedAt (clock skew) counts as fresh. */
export function isFreshMove(movedAt: unknown, nowMs: number): boolean {
  if (!(movedAt instanceof Date) && typeof movedAt !== 'string') return false;
  const t = new Date(movedAt).getTime();
  return !Number.isNaN(t) && nowMs - t < SET_MOVE_WINDOW_MS;
}

const isStale = (set: any, nowMs: number) => set?.movedAt !== undefined && !isFreshMove(set.movedAt, nowMs);

/** A copy of the festival without stale marks. Returns the same object when nothing is stale; never mutates it. */
export function withFreshMoves<T>(festival: T, nowMs: number): T {
  const days = (festival as any)?.days;
  if (!Array.isArray(days) || !days.some((d: any) => d?.sets?.some((s: any) => isStale(s, nowMs)))) return festival;
  return {
    ...festival,
    days: days.map((d: any) =>
      d?.sets?.some((s: any) => isStale(s, nowMs))
        ? {
            ...d,
            sets: d.sets.map((s: any) => {
              if (!isStale(s, nowMs)) return s;
              const { movedAt: _a, movedFrom: _f, ...rest } = s;
              return rest;
            }),
          }
        : d,
    ),
  };
}
