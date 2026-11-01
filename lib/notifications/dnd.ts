// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Wall-clock HH:MM in `timeZone`, or the server clock when the zone is absent or unknown. */
function wallClockHhmm(now: Date, timeZone?: string | null): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(now);
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      // Unknown zone: fall through to the server clock.
    }
  }
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/**
 * Check whether `now` falls inside a user's Do-Not-Disturb window. The window is read
 * in `prefs.dndTimeZone` when set and valid, otherwise on the server clock.
 */
export function isInDndWindow(
  prefs: { dndStart?: string; dndEnd?: string; dndTimeZone?: string | null } | null | undefined,
  now: Date = new Date(),
) {
  if (!prefs) return false;
  if (!prefs.dndStart || !prefs.dndEnd) return false;
  const hhmm = wallClockHhmm(now, prefs.dndTimeZone);
  if (prefs.dndStart <= prefs.dndEnd) {
    if (prefs.dndStart === prefs.dndEnd) return false;
    return hhmm >= prefs.dndStart && hhmm <= prefs.dndEnd;
  }
  // Wraps midnight (e.g., 22:00 - 08:00)
  return hhmm >= prefs.dndStart || hhmm < prefs.dndEnd;
}
