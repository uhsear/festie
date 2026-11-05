import { useMemo } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { buildSetContext, type SetContext } from '../utils/setContext';
import { resolveFestivalTimeZone } from '../utils/festivalTime';
import type { FestivalSet } from '../types/domain';

/** The set's stage neighbours and its overlaps on other stages. */
export function useSetContext(set: FestivalSet | null): SetContext {
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const timeZone = resolveFestivalTimeZone(useFestivalStore((s) => s.currentFestival));
  return useMemo(
    () => (set ? buildSetContext(set, sets, { days, timeZone }) : { before: null, after: null, overlaps: [] }),
    [set, sets, days, timeZone],
  );
}
