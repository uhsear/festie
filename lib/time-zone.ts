// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Backend time-zone helper.
 *
 * `zoneOffsetMsAt` comes from packages/shared/src/utils/setStatus.ts, imported by
 * relative path: scripts/build.mjs bundles it into dist. Only import shared modules
 * whose own imports stay free of React and other bare packages, because the build
 * keeps bare imports external.
 */
import { zoneOffsetMsAt } from '../packages/shared/src/utils/setStatus';

/**
 * Epoch-ms for a wall-clock (Y-M-D h:m) interpreted in a specific IANA zone,
 * independent of the server's own zone. Returns NaN for an unparseable date or
 * an unknown zone, so the caller can fall back to bare-local behavior.
 *
 * Two-pass offset correction (DST-safe): treat the wall time as if it were UTC
 * to get a first guess, read back the zone's offset at that instant, apply it,
 * then re-read the offset at the resolved instant and re-apply if it changed
 * (handles DST boundaries where the naive-instant offset differs from the real
 * one).
 */
export function zonedWallTimeToMs(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): number {
  if ([year, month, day, hours, minutes].some((n) => Number.isNaN(n))) return NaN;
  try {
    // First guess: pretend the wall-clock is UTC, then correct by the zone offset.
    const naiveUtc = Date.UTC(year, month - 1, day, hours, minutes, 0);
    const offset1 = zoneOffsetMsAt(naiveUtc, timeZone);
    let ms = naiveUtc - offset1;
    // Second pass: the offset at the resolved instant may differ across a DST
    // boundary — re-apply with the corrected offset if so.
    const offset2 = zoneOffsetMsAt(ms, timeZone);
    if (offset2 !== offset1) ms = naiveUtc - offset2;
    return ms;
  } catch {
    return NaN;
  }
}

// Keep in sync with packages/shared (setStatus.ts FESTIVAL_DAY_START_HOUR / festivalStartMinutes, format.ts formatTime).
/** Sets starting before this hour belong to the previous festival day (CONTEXT.md "Day"). */
export const FESTIVAL_DAY_START_HOUR = 6;

/** Minutes since the logical day's midnight; a start before 06:00 counts as after midnight (+1440). */
export function festivalStartMinutes(hhmm: string): number {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h! * 60 + m! + (h! < FESTIVAL_DAY_START_HOUR ? 1440 : 0);
}

/**
 * Mirror of shared `setMinuteRange` (setStatus.ts): a set's minute range from its
 * logical day's midnight. The start follows `festivalStartMinutes`; the end rolls
 * forward a day until it is after the start. Null when either time is missing.
 */
export function setMinuteRange(set: {
  startTime?: string | null;
  endTime?: string | null;
}): { start: number; end: number } | null {
  if (!set.startTime || !set.endTime) return null;
  const start = festivalStartMinutes(set.startTime);
  const [h, m] = set.endTime.split(':').map(Number);
  let end = h! * 60 + m!;
  while (end <= start) end += 1440;
  return { start, end };
}

/** `21:30` to `9:30 PM`, `00:15` to `12:15 AM`. */
export function formatClock12(hhmm: string): string {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${h! % 12 || 12}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`;
}
