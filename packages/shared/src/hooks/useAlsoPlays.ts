import { useMemo } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { alsoPlaysSlots, type AlsoPlaysSlot } from '../utils/alsoPlays';
import { resolveFestivalTimeZone } from '../utils/festivalTime';
import type { FestivalSet } from '../types/domain';

/** Other open slots of the same act. The caller passes its own clock so the list drops a slot when it ends. */
export function useAlsoPlays(set: FestivalSet | null, nowMs: number): AlsoPlaysSlot[] {
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const festival = useFestivalStore((s) => s.currentFestival);
  const timeZone = resolveFestivalTimeZone(festival);
  const separator = festival?.b2bSeparator;
  return useMemo(
    () => (set ? alsoPlaysSlots(set, sets, { days, timeZone, nowMs, b2bSeparator: separator }) : []),
    [set, sets, days, timeZone, separator, nowMs],
  );
}
