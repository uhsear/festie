import type { FestivalDay, FestivalSet } from '../types';
import { dayShortLabel } from './crewDays';
import { formatTime } from './format';
import { formatSetTimeRange } from './scheduleFormat';
import { createDateInLocalFrame } from './setStatus';

export const SET_MOVE_WINDOW_MS = 48 * 60 * 60 * 1000; // keep in sync with lib/set-moves.ts SET_MOVE_WINDOW_MS

export interface SetMoveNotice {
  chip: string;
  line: string;
  a11y: string;
}

type MoveDay = Pick<FestivalDay, 'date' | 'label'>;

function longDayLabel(day: MoveDay, dayIndex: number): string {
  const key = day.date?.slice(0, 10) ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = createDateInLocalFrame(key, 12, 0);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return dayShortLabel(day, dayIndex);
}

/** The "Moved" chip and "Moved from Sat 10:00 PM, Sahara" line, or null when no fresh move mark. */
export function describeSetMove(
  set: Pick<FestivalSet, 'movedAt' | 'movedFrom' | 'startTime'>,
  ctx: { days: MoveDay[]; stageName: (stageId: string) => string | undefined; nowMs: number },
): SetMoveNotice | null {
  const { movedAt, movedFrom } = set;
  if (!movedAt || !movedFrom) return null;
  const at = Date.parse(movedAt);
  if (Number.isNaN(at) || ctx.nowMs - at >= SET_MOVE_WINDOW_MS) return null;

  const day = ctx.days[movedFrom.dayIndex];
  const time = movedFrom.start
    ? movedFrom.start === set.startTime
      ? formatSetTimeRange({ startTime: movedFrom.start, endTime: movedFrom.end ?? '' })
      : formatTime(movedFrom.start)
    : '';
  const stage = movedFrom.stageId ? ctx.stageName(movedFrom.stageId) : undefined;

  const build = (dayText: string): string => {
    const when = [dayText, time].filter(Boolean).join(' ');
    const head = [when, stage].filter(Boolean).join(', ');
    return head ? `Moved from ${head}` : 'Moved';
  };
  return {
    chip: 'Moved',
    line: build(day ? dayShortLabel(day, movedFrom.dayIndex) : ''),
    a11y: build(day ? longDayLabel(day, movedFrom.dayIndex) : ''),
  };
}
