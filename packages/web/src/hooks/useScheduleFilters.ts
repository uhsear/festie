import { useCallback } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { usePicks } from '@festie/shared/hooks';
import type { FestivalSet, Priority } from '@festie/shared/types';

/**
 * The one place that decides which sets the schedule views (Cards, Timeline,
 * Grid) show. `activeStages` empty or covering every stage means "all stages";
 * `onlyMine` keeps only sets the signed-in profile has picked.
 */
export function applyScheduleFilters(
  sets: FestivalSet[],
  opts: {
    activeStages: string[];
    stageCount: number;
    onlyMine: boolean;
    getMyPick: (setId: string) => Priority | null | undefined;
  },
): FestivalSet[] {
  const { activeStages, stageCount, onlyMine, getMyPick } = opts;
  let out = sets;
  if (activeStages.length > 0 && activeStages.length < stageCount) {
    out = out.filter((s) => activeStages.includes(s.stageId));
  }
  if (onlyMine) out = out.filter((s) => !!getMyPick(s.id));
  return out;
}

/** Returns a stable-per-filter-change function that applies the stage + My picks filters. */
export function useScheduleFilters() {
  const stageCount = useFestivalStore((s) => s.stages.length);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const onlyMine = useFestivalStore((s) => s.onlyMine);
  const { getMyPick } = usePicks();

  const filterSets = useCallback(
    (sets: FestivalSet[]) => applyScheduleFilters(sets, { activeStages, stageCount, onlyMine, getMyPick }),
    [activeStages, stageCount, onlyMine, getMyPick],
  );

  return { filterSets, activeStages, onlyMine };
}
