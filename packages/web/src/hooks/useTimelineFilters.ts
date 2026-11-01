import { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { usePicks } from '@festie/shared/hooks';
import { applyScheduleFilters } from './useScheduleFilters';
import { FestivalSet, Stage } from '@festie/shared/types';
import { setMinuteRange, artistDisplayName, getConflictingSetIds } from '@festie/shared/utils';

const SLOT_MINUTES = 15;

export interface TimeBounds {
  minMin: number;
  maxMin: number;
  totalSlots: number;
}

export function useTimelineFilters() {
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const activeStages = useFestivalStore((state) => state.activeStages);
  const onlyMine = useFestivalStore((state) => state.onlyMine);
  const { getMyPick } = usePicks();

  // Ensure all stages are active if none selected
  const effectiveActiveStages = useMemo(() => {
    if (!activeStages || activeStages.length === 0) {
      return stages.map((st: Stage) => st.id);
    }
    return activeStages;
  }, [activeStages, stages]);

  const visibleStages = useMemo(() => {
    return stages.filter((st: Stage) => effectiveActiveStages.includes(st.id));
  }, [stages, effectiveActiveStages]);

  // Filter sets for the selected day using dayIndex
  const allDaySets = useMemo(() => {
    return applyScheduleFilters(
      sets.filter((s: FestivalSet) => s.dayIndex === selectedDay),
      { activeStages: effectiveActiveStages, stageCount: stages.length, onlyMine, getMyPick },
    );
  }, [sets, selectedDay, stages, effectiveActiveStages, onlyMine, getMyPick]);

  const timedSets = useMemo(() => allDaySets.filter((s: FestivalSet) => s.startTime && s.endTime), [allDaySets]);

  const timelessSets = useMemo(
    () =>
      allDaySets
        .filter((s: FestivalSet) => !s.startTime || !s.endTime)
        .sort((a: FestivalSet, b: FestivalSet) =>
          artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
            artistDisplayName(b, currentFestival?.b2bSeparator),
            undefined,
            { sensitivity: 'base' },
          ),
        ),
    [allDaySets, currentFestival?.b2bSeparator],
  );

  // Conflict detection
  const conflictIds = useMemo(() => getConflictingSetIds(allDaySets, getMyPick), [allDaySets, getMyPick]);

  // Calculate time bounds
  const timeBounds = useMemo((): TimeBounds | null => {
    if (timedSets.length === 0) return null;

    let minMin = Infinity;
    let maxMin = 0;

    timedSets.forEach((s: FestivalSet) => {
      const range = setMinuteRange(s);
      if (!range) return;
      if (range.start < minMin) minMin = range.start;
      if (range.end > maxMin) maxMin = range.end;
    });

    minMin = Math.floor(minMin / SLOT_MINUTES) * SLOT_MINUTES;
    maxMin = Math.ceil(maxMin / SLOT_MINUTES) * SLOT_MINUTES;
    const totalSlots = (maxMin - minMin) / SLOT_MINUTES;

    return { minMin, maxMin, totalSlots };
  }, [timedSets]);

  return {
    currentFestival,
    stages,
    selectedDay,
    visibleStages,
    allDaySets,
    timedSets,
    timelessSets,
    conflictIds,
    timeBounds,
  };
}
