import { useCallback, useMemo } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import { usePicks } from './usePicks';
import { resolveFestivalTimeZone } from '../utils/festivalTime';
import type { ConflictGroup } from '../utils/pickConflicts';
import {
  SPLIT_PLAN_PREFIX,
  buildSplitPlan,
  findSplitPlanLine,
  invertChange,
  planClearSplit,
  planKeep,
  planSplit,
  type ClashChange,
  type SplitContext,
  type SplitPlan,
} from '../utils/clashPlan';

export interface ClashResolution {
  message: string;
  undo: () => Promise<void>;
}

/**
 * Keep, Split and Clear plan for the clash cards, with Undo. Writes go through
 * `usePicks`, so every one is offline-queued. A store failure rejects, so the
 * card can show `COPY.clash.failed`.
 */
export function useClashResolver(): {
  splitPlan: (group: ConflictGroup) => SplitPlan | null;
  /** The saved plan line without its prefix, or null. */
  plannedSplit: (group: ConflictGroup) => string | null;
  keep: (group: ConflictGroup, keepSetId: string) => Promise<ClashResolution>;
  split: (group: ConflictGroup) => Promise<ClashResolution>;
  clearSplit: (group: ConflictGroup) => Promise<ClashResolution>;
} {
  const festival = useFestivalStore((s) => s.currentFestival);
  const stages = useFestivalStore((s) => s.stages);
  const notes = useFestivalStore((s) => s.currentProfile?.notes);
  const { savePick, removePick, saveNote } = usePicks();

  const festivalId = festival?.id;
  const separator = festival?.b2bSeparator;
  const timeZone = resolveFestivalTimeZone(festival);

  const ctx = useMemo<SplitContext>(
    () => ({
      b2bSeparator: separator,
      timeZone,
      stageName: (stageId) => stages.find((s) => s.id === stageId)?.name ?? 'their stage',
    }),
    [separator, timeZone, stages],
  );

  const apply = useCallback(
    async (change: ClashChange): Promise<ClashResolution> => {
      if (!festivalId) throw new Error('No festival selected. Open a festival, then try again.');
      const run = async (c: ClashChange) => {
        for (const p of c.picks) {
          if (p.to === null) await removePick(festivalId, p.setId);
          else await savePick(festivalId, p.setId, p.to);
        }
        for (const n of c.notes) await saveNote(festivalId, n.setId, n.to ?? '');
      };
      await run(change);
      return { message: change.message, undo: () => run(invertChange(change)) };
    },
    [festivalId, savePick, removePick, saveNote],
  );

  const splitPlan = useCallback((group: ConflictGroup) => buildSplitPlan(group, ctx), [ctx]);

  const plannedSplit = useCallback(
    (group: ConflictGroup) => findSplitPlanLine(group, notes, separator)?.slice(SPLIT_PLAN_PREFIX.length) ?? null,
    [notes, separator],
  );

  const keep = useCallback(
    (group: ConflictGroup, keepSetId: string) => apply(planKeep(group, keepSetId, separator)),
    [apply, separator],
  );

  const split = useCallback(
    async (group: ConflictGroup) => {
      const change = planSplit(group, notes, ctx);
      if ('error' in change) throw new Error(change.error);
      return apply(change);
    },
    [apply, notes, ctx],
  );

  const clearSplit = useCallback(
    async (group: ConflictGroup) => {
      const change = planClearSplit(group, notes, separator);
      if (!change) throw new Error('No split plan to remove.');
      return apply(change);
    },
    [apply, notes, separator],
  );

  return { splitPlan, plannedSplit, keep, split, clearSplit };
}
