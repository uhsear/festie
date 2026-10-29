import { createDateInLocalFrame, zonedWallTimeToMs } from '@festie/shared/utils';

/**
 * Where "now" sits (0-100 %) inside the displayed festival day's time window,
 * or null when now is outside it. The window runs from `dayDate` 00:00 in the
 * festival's zone (device-local when `timeZone` is omitted) plus minMin..maxMin;
 * maxMin > 1440 covers sets that run past midnight into the next calendar day.
 * Date-aware, so a past or future festival never draws the line.
 */
export function nowPositionPercent(
  nowMs: number,
  dayDate: string | null | undefined,
  bounds: { minMin: number; maxMin: number },
  timeZone?: string,
): number | null {
  if (!dayDate || bounds.maxMin <= bounds.minMin) return null;
  const dayStartMs = timeZone
    ? zonedWallTimeToMs(dayDate, 0, 0, timeZone)
    : createDateInLocalFrame(dayDate, 0, 0).getTime();
  if (Number.isNaN(dayStartMs)) return null;
  const nowMin = (nowMs - dayStartMs) / 60_000;
  if (nowMin < bounds.minMin || nowMin > bounds.maxMin) return null;
  return ((nowMin - bounds.minMin) / (bounds.maxMin - bounds.minMin)) * 100;
}
