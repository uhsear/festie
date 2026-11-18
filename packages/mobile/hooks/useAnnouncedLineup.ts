import { useMemo } from 'react';
import { useFestivalDataStore, useFestivalStore } from '@festie/shared/stores';
import { announcedLineupModel, type AnnouncedLineupModel } from '@festie/shared/utils';
import { useNow } from './useNow';

export type { AnnouncedLineupModel };

/**
 * The announced lineup for the selected day, computed from the festival in the store. The home screen
 * calls this once, decides whether the lineup replaces its empty state, and passes the model on.
 */
export function useAnnouncedLineup(): AnnouncedLineupModel {
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const days = useFestivalDataStore((s) => s.days);
  const sets = useFestivalDataStore((s) => s.sets);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const nowMs = useNow(60_000);
  return useMemo(
    () => announcedLineupModel(festival, days, sets, selectedDay, nowMs),
    [festival, days, sets, selectedDay, nowMs],
  );
}
