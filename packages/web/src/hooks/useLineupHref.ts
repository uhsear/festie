import { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared';
import { defaultScheduleView, festivalPhase } from '@festie/shared/utils';

/** Where the Lineup tab goes: the view last used for this festival, else the shared default. */
export function useLineupHref(): string {
  const scheduleView = useFestivalStore((s) => s.scheduleView);
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const hasTimedSets = useMemo(() => sets.some((s) => s.startTime && s.endTime), [sets]);
  const phase = useMemo(() => festivalPhase(currentFestival, days), [currentFestival, days]);
  return `/${scheduleView ?? defaultScheduleView({ hasTimedSets, phase })}`;
}
