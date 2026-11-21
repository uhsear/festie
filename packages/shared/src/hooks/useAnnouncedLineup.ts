import { useMemo } from 'react';
import { useFestivalStore } from '../stores';
import { announcedLineupModel, type AnnouncedLineupModel } from '../utils/lineup';

/**
 * The announced lineup for the selected day, computed from the festival in the store. A screen calls
 * this once, decides whether the lineup replaces its empty state, and passes the model on. `nowMs` comes
 * from each app's own clock hook (`useNow`), so the "New" and "Just announced" badges follow the clock.
 */
export function useAnnouncedLineup(nowMs: number): AnnouncedLineupModel {
  const festival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  return useMemo(
    () => announcedLineupModel(festival, days, sets, selectedDay, nowMs),
    [festival, days, sets, selectedDay, nowMs],
  );
}
