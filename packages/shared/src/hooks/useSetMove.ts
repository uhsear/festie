import { useMemo } from 'react';
import { useFestivalStore } from '../stores/festivalStore';
import type { FestivalSet } from '../types';
import { describeSetMove, type SetMoveNotice } from '../utils/setMoves';

/** Reads only days and stages (not useFestival), so a card does not re-render on every search keystroke. */
export function useSetMove(set: FestivalSet | null | undefined): SetMoveNotice | null {
  const days = useFestivalStore((state) => state.days);
  const stages = useFestivalStore((state) => state.stages);
  const movedAt = set?.movedAt;
  const movedFrom = set?.movedFrom;
  const startTime = set?.startTime ?? '';

  return useMemo(() => {
    if (!movedAt) return null;
    return describeSetMove(
      { movedAt, movedFrom, startTime },
      { days, stageName: (id) => stages.find((s) => s.id === id)?.name, nowMs: Date.now() },
    );
  }, [movedAt, movedFrom, startTime, days, stages]);
}
