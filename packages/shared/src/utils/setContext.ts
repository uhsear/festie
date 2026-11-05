import type { FestivalDay, FestivalSet } from '../types/domain';
import { formatTime } from './format';
import { getSetTimeBounds } from './setStatus';

// Set detail context: the neighbours on the same stage and what else plays at the same time.
// All time math goes through getSetTimeBounds (festival zone, past-midnight roll, dayIndex).

export interface SetContextOptions {
  days: FestivalDay[];
  timeZone?: string;
}

export interface SetContextEntry {
  set: FestivalSet;
  /** '9:00 PM - 10:30 PM', or just the start when the end is missing. */
  time: string;
}

export interface SetContext {
  before: SetContextEntry | null;
  after: SetContextEntry | null;
  /** Sets on other stages that overlap this one, earliest start first. */
  overlaps: SetContextEntry[];
}

const EMPTY: SetContext = { before: null, after: null, overlaps: [] };

const entry = (set: FestivalSet): SetContextEntry => ({
  set,
  time: set.endTime ? `${formatTime(set.startTime)} - ${formatTime(set.endTime)}` : formatTime(set.startTime),
});

/** Empty for a TBA set: with no times there is nothing to place it against. */
export function buildSetContext(set: FestivalSet, sets: readonly FestivalSet[], o: SetContextOptions): SetContext {
  const mine = getSetTimeBounds(set, o.days, o.timeZone);
  if (!mine) return EMPTY;

  let before: { s: FestivalSet; startMs: number } | null = null;
  let after: { s: FestivalSet; startMs: number } | null = null;
  const overlaps: Array<{ s: FestivalSet; startMs: number }> = [];

  for (const s of sets) {
    if (s.id === set.id || s.festivalId !== set.festivalId) continue;
    const b = getSetTimeBounds(s, o.days, o.timeZone);
    if (!b) continue;
    if (s.stageId === set.stageId) {
      // Neighbours stay on the same festival day, so a start at the same clock time on another day never counts.
      if (s.dayIndex !== set.dayIndex) continue;
      if (b.startMs < mine.startMs && (!before || b.startMs > before.startMs)) before = { s, startMs: b.startMs };
      if (b.startMs > mine.startMs && (!after || b.startMs < after.startMs)) after = { s, startMs: b.startMs };
    } else if (b.startMs < mine.endMs && mine.startMs < b.endMs) {
      overlaps.push({ s, startMs: b.startMs });
    }
  }

  overlaps.sort((a, b) => a.startMs - b.startMs || (a.s.id < b.s.id ? -1 : 1));
  return {
    before: before && entry(before.s),
    after: after && entry(after.s),
    overlaps: overlaps.map((x) => entry(x.s)),
  };
}
