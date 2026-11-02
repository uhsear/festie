import type { FestivalDay, FestivalSet, Priority, Stage } from '../types/domain';
import { COPY } from '../constants/copy';
import { artistDisplayName, formatTime } from './format';
import { getSetTimeBounds, isSetScheduled } from './setStatus';
import { buildPickConflicts, conflictSetIds, type ConflictGroup } from './pickConflicts';
import { dayShortLabel } from './crewDays';
import type { ClashChange } from './clashPlan';

// "Also plays": other slots of the same act, and the clash fix that uses one.
// Pure (RN + web safe). The act key mirrors the server's T15 lineup match key
// (lib/lineup-import-plan.ts); shared cannot import server code.

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normName = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** T15 match key: artist names, lower case, spaces collapsed, joined with '|'. '' when blank. */
export function artistKey(set: Pick<FestivalSet, 'artist' | 'artists'>, b2bSeparator?: string): string {
  let names: string[];
  if (set.artists?.length) {
    names = set.artists.map((a) => a.name);
  } else {
    const sep = b2bSeparator?.trim() || 'b2b';
    names = (set.artist ?? '').split(new RegExp(`\\s+(?:${escapeRe(sep)}|b2b)\\s+`, 'i'));
  }
  return names.map(normName).filter(Boolean).join('|');
}

export interface AlsoPlaysSlot {
  set: FestivalSet;
  /** 'Sat 9:00 PM', or 'Sat, time TBA' with no start time. */
  when: string;
  /** 'Sat' */
  day: string;
}

/** Other slots of the same act in this festival that have not ended, earliest first. */
export function alsoPlaysSlots(
  set: FestivalSet,
  sets: readonly FestivalSet[],
  o: { days: FestivalDay[]; timeZone?: string; nowMs: number; b2bSeparator?: string },
): AlsoPlaysSlot[] {
  const key = artistKey(set, o.b2bSeparator);
  if (!key) return [];
  const found: Array<{ slot: AlsoPlaysSlot; dayIndex: number; startMs: number }> = [];
  for (const s of sets) {
    if (s.id === set.id || s.festivalId !== set.festivalId) continue;
    if (!isSetScheduled(s, o.days) || artistKey(s, o.b2bSeparator) !== key) continue;
    const bounds = getSetTimeBounds(s, o.days, o.timeZone);
    if (bounds && bounds.endMs <= o.nowMs) continue;
    const dayIndex = s.dayIndex as number;
    const day = dayShortLabel(o.days[dayIndex]!, dayIndex);
    const when = s.startTime ? `${day} ${formatTime(s.startTime)}` : `${day}, time TBA`;
    found.push({ slot: { set: s, when, day }, dayIndex, startMs: bounds?.startMs ?? Infinity });
  }
  found.sort((a, b) => a.dayIndex - b.dayIndex || a.startMs - b.startMs || (a.slot.set.id < b.slot.set.id ? -1 : 1));
  return found.map((f) => f.slot);
}

export interface CatchInstead {
  fromSetId: string;
  priority: Priority;
  to: AlsoPlaysSlot;
  /** artistDisplayName of the act */
  artist: string;
}

/** The first move that fixes a clash by using another slot, or null. */
export function catchInsteadOption(
  group: ConflictGroup,
  o: {
    sets: readonly FestivalSet[];
    myPicks: Record<string, Priority>;
    days: FestivalDay[];
    timeZone?: string;
    stages?: ReadonlyArray<Pick<Stage, 'id' | 'latitude' | 'longitude'>>;
    nowMs: number;
    b2bSeparator?: string;
  },
): CatchInstead | null {
  // The recommended pick goes last, so the move frees a pick you would otherwise drop.
  const ordered = [...group.picks].sort(
    (a, b) => Number(a.set.id === group.recommendedKeepId) - Number(b.set.id === group.recommendedKeepId),
  );
  for (const p of ordered) {
    for (const slot of alsoPlaysSlots(p.set, o.sets, o)) {
      if (o.myPicks[slot.set.id]) continue;
      if (!getSetTimeBounds(slot.set, o.days, o.timeZone)) continue;
      const { [p.set.id]: _dropped, ...rest } = o.myPicks;
      const trial = { ...rest, [slot.set.id]: p.priority };
      const clashes = buildPickConflicts({
        sets: [...o.sets],
        myPicks: trial,
        selectedDay: slot.set.dayIndex ?? 0,
        days: o.days,
        timeZone: o.timeZone,
        stages: o.stages,
      });
      if (conflictSetIds(clashes).has(slot.set.id)) continue;
      return {
        fromSetId: p.set.id,
        priority: p.priority,
        to: slot,
        artist: artistDisplayName(p.set, o.b2bSeparator),
      };
    }
  }
  return null;
}

/** Remove the clashing pick and pick the other slot at the same priority. */
export function planCatchInstead(option: CatchInstead): ClashChange {
  return {
    picks: [
      { setId: option.fromSetId, from: option.priority, to: null },
      { setId: option.to.set.id, from: null, to: option.priority },
    ],
    notes: [],
    message: COPY.alsoPlays.caught(option.artist, option.to.when),
  };
}
