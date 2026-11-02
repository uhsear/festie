import { useMemo } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { artistDisplayName } from '../utils/format';
import { buildClashMarks, type ClashMark } from '../utils/scheduleGrid';
import { buildPickConflicts, type ConflictGroup } from '../utils/pickConflicts';
import { resolveFestivalTimeZone } from '../utils/festivalTime';

export interface DayClashes { count: number; marks: Map<string, ClashMark>; groups: ConflictGroup[] }

/**
 * Clash groups for the selected day plus a per-set mark (hatch segments and
 * "Clashes with X · Stage" text) for the grids. `count` is the number of
 * strict-overlap clash groups. Empty without a profile.
 */
export function useDayClashes(): DayClashes {
  const sets = useFestivalStore((s) => s.sets);
  const days = useFestivalStore((s) => s.days);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const currentProfileId = useFestivalStore((s) => s.currentProfile?.id);
  const myPicks = useFestivalStore((s) => s.currentProfile?.picks);
  const timeZone = resolveFestivalTimeZone(useFestivalStore((s) => s.currentFestival));
  const stages = useFestivalStore((s) => s.stages);
  const separator = useFestivalStore((s) => s.currentFestival?.b2bSeparator);

  // No `stages` here: the grids mark strict overlaps only; tight changes stay on the Picks cards.
  const groups = useMemo(
    () => (currentProfileId ? buildPickConflicts({ sets, myPicks: myPicks ?? {}, selectedDay, days, timeZone }) : []),
    [sets, days, selectedDay, currentProfileId, myPicks, timeZone],
  );

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
