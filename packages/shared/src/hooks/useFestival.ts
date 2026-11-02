import { useCallback } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { FestivalSet } from '../types';
import { STAGE_COLOR_FALLBACK } from '../utils/stageColor';
import { filterScheduleSets } from '../utils/scheduleFilters';

export interface UseFestivalReturn {
  getDays: () => { index: number; date: string; label?: string }[];
  getCurrentDaySets: () => FestivalSet[];
  getFilteredSets: () => FestivalSet[];
  getStageColor: (stageId: string) => string;
  getStageName: (stageId: string) => string | undefined;
}

export function useFestival(): UseFestivalReturn {
  const days = useFestivalStore((state) => state.days);
  const sets = useFestivalStore((state) => state.sets);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const activeStages = useFestivalStore((state) => state.activeStages);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const onlyMine = useFestivalStore((state) => state.onlyMine);
  const currentProfile = useFestivalStore((state) => state.currentProfile);

  const getDays = useCallback(() => {
    return days.map((day, index) => ({
      index,
      date: day.date,
      label: day.label || day.date,
    }));
  }, [days]);

  const getCurrentDaySets = useCallback(() => {
    if (selectedDay < 0 || selectedDay >= days.length) return [];
    // Filter by dayIndex (set by selectFestival when flattening)
    return sets.filter((s) => s.dayIndex === selectedDay);
  }, [selectedDay, days, sets]);

  const getFilteredSets = useCallback(
    () =>
      filterScheduleSets(getCurrentDaySets(), {
        activeStages,
        stages,
        onlyMine,
        picks: currentProfile?.picks,
        query: searchQuery,
      }),
    [getCurrentDaySets, activeStages, searchQuery, stages, onlyMine, currentProfile],
  );

  // Use actual stage.color from API response. When a stage has no color we
  // return the platform-neutral STAGE_COLOR_FALLBACK sentinel (NOT a web CSS var
  // — shared must stay RN-safe); each platform maps it to its own muted value
  // via resolveStageColor (web → var(--text-muted), mobile → token).
  const getStageColor = useCallback(
    (stageId: string): string => {
      return stages.find((s) => s.id === stageId)?.color || STAGE_COLOR_FALLBACK;
    },
    [stages],
  );

  const getStageName = useCallback(
    (stageId: string): string | undefined => {
      return stages.find((s) => s.id === stageId)?.name;
    },
    [stages],
  );

  return {
    getDays,
    getCurrentDaySets,
    getFilteredSets,
    getStageColor,
    getStageName,
  };
}
