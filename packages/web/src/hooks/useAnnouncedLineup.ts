import { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { announcedLineupModel, type AnnouncedLineupModel } from '@festie/shared/utils';
import { useNow } from './useSetStatus';

export type { AnnouncedLineupModel };

/**
 * The announced lineup for the selected day, computed from the festival in the store. A route calls
 * this once, decides whether the lineup replaces its empty state, and passes the model to the component.
 */
export function useAnnouncedLineup(): AnnouncedLineupModel {
  const festival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const nowMs = useNow();
  return useMemo(
    () => announcedLineupModel(festival, days, sets, selectedDay, nowMs),
    [festival, days, sets, selectedDay, nowMs],
  );
}
