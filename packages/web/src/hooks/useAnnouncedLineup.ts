import { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useNow } from './useSetStatus';
import {
  coverLineup,
  festivalPhase,
  lineupDays,
  lineupSummary,
  selectLineupEntries,
  type LineupCover,
  type LineupDay,
  type LineupSelection,
  type LineupSummary,
} from '@festie/shared/utils';
import type { LineupEntry } from '@festie/shared/types';

export interface AnnouncedLineupModel {
  /** False when there is nothing to show: no entries, or the festival is over. */
  visible: boolean;
  /** The festival has announced acts but no sets at all. */
  noSets: boolean;
  lineup: LineupEntry[];
  days: LineupDay[];
  cover: Record<string, LineupCover>;
  summary: LineupSummary;
  /** The default view for the selected day: acts with no set, no scheduled ones. */
  selection: LineupSelection;
}

const NO_LINEUP: LineupEntry[] = [];

/**
 * The announced lineup for the selected day, computed from the festival in the store. The component
 * and the routes that swap an empty state for it read the same answer from here.
 */
export function useAnnouncedLineup(): AnnouncedLineupModel {
  const festival = useFestivalStore((s) => s.currentFestival);
  const storeDays = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const lineup = festival?.lineup ?? NO_LINEUP;
  const separator = festival?.b2bSeparator;

  const days = useMemo(() => lineupDays(storeDays ?? [], sets ?? []), [storeDays, sets]);
  const cover = useMemo(() => coverLineup(lineup, days, separator || 'b2b'), [lineup, days, separator]);
  const summary = useMemo(() => lineupSummary(lineup, cover), [lineup, cover]);
  const selection = useMemo(
    () => selectLineupEntries(lineup, cover, sets ?? [], { dayIndex: selectedDay, fullLineup: false }),
    [lineup, cover, sets, selectedDay],
  );
  // An unscheduled festival is over once its last day has passed; the acts that never got a set drop out.
  const nowMs = useNow();
  const over = festival ? festivalPhase(festival, storeDays, new Date(nowMs)) === 'post' : false;

  return {
    visible: lineup.length > 0 && !over,
    noSets: (sets ?? []).length === 0,
    lineup,
    days,
    cover,
    summary,
    selection,
  };
}
