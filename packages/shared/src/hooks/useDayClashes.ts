import { useMemo } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { usePickConflicts } from './usePickConflicts';
import { artistDisplayName } from '../utils/format';
import { buildClashMarks, type ClashMark } from '../utils/scheduleGrid';
import type { ConflictGroup } from '../utils/pickConflicts';

export interface DayClashes { count: number; marks: Map<string, ClashMark>; groups: ConflictGroup[] }

/**
 * Clash groups for the selected day plus a per-set mark (hatch segments and
 * "Clashes with X · Stage" text) for the grids. `count` is the number of clash
 * groups, the same number the Picks banner shows. Empty without a profile.
 */
export function useDayClashes(): DayClashes {
  const groups = usePickConflicts();
  const stages = useFestivalStore((s) => s.stages);
  const separator = useFestivalStore((s) => s.currentFestival?.b2bSeparator);

  return useMemo(() => {
    const stageNames = new Map(stages.map((st) => [st.id, st.name]));
    const marks = buildClashMarks(groups, (set) => {
      const stage = stageNames.get(set.stageId) ?? set.stageName;
      const name = artistDisplayName(set, separator);
      return stage ? `${name} · ${stage}` : name;
    });
    return { count: groups.length, marks, groups };
  }, [groups, stages, separator]);
}
