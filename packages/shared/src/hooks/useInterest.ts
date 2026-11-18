import { useCallback, useMemo } from 'react';
import { useFestivalStore, useFestivalDataStore, selectMyInterests, selectMyPicks } from '../stores/festivalStore';
import type { InterestMark } from '../types';
import { lineupDays } from '../utils/lineup';
import { coverLineup } from '../utils/lineupCover';
import { interestedRows, type InterestRow } from '../utils/lineupInterest';

/**
 * One announced act's "Interested" mark for the viewer (the profile's, else a guest's). Re-renders only
 * when this act's mark changes. `toggle` marks or unmarks it, and a guest's mark stays on the device.
 */
export function useInterest(entryId: string): { mark: InterestMark | undefined; marked: boolean; toggle: () => Promise<void> } {
  const mark = useFestivalStore((state) => selectMyInterests(state)?.[entryId]);
  const toggleInterest = useFestivalDataStore((state) => state.toggleInterest);
  const toggle = useCallback(() => toggleInterest(entryId), [toggleInterest, entryId]);
  return { mark, marked: mark !== undefined, toggle };
}

/** The viewer's whole marks map, for views that list every mark. */
export function useMyInterests(): Record<string, InterestMark> | null {
  return useFestivalStore((state) => selectMyInterests(state));
}

/**
 * The viewer's marks as rows for the Interested view and the Picks group, computed from the festival
 * in the store (see interestedRows). Empty when the festival has no lineup or the viewer has no marks.
 */
export function useInterestedRows(): InterestRow[] {
  const festival = useFestivalStore((state) => state.currentFestival);
  const days = useFestivalStore((state) => state.days);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const marks = useMyInterests();
  const picks = useFestivalStore(selectMyPicks);
  return useMemo(() => {
    const lineup = festival?.lineup ?? [];
    if (lineup.length === 0 || !marks) return [];
    const cover = coverLineup(lineup, lineupDays(days, sets), festival?.b2bSeparator || 'b2b');
    return interestedRows({ lineup, marks, cover, picks, sets, days, stages });
  }, [festival, days, sets, stages, marks, picks]);
}
