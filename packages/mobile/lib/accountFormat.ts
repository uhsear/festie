/**
 * Pure formatting + scoring helpers for the Account tab. No React Native / DOM
 * imports so this stays trivially unit-testable and safe to import anywhere.
 *
 * Lives in packages/mobile/lib (mobile-local) rather than @festie/shared because
 * it is presentation-only sugar for the native Account screen; the shared
 * package owns the data shapes, not how mobile chrome labels them. Date
 * formatting (formatFestivalDate, formatDateSpan) lives in @festie/shared/utils.
 */

import { formatTime } from '@festie/shared/utils';

/**
 * Format a 24h 'HH:MM' clock string in the device locale's hour cycle: "11:00 PM" / "8:00 AM", or "23:00" / "08:00" on a 24-hour clock.
 * Returns the raw input on any parse miss so a caption never blanks. Used by the
 * quiet-hours caption so it reflects the stored DND window instead of a
 * hardcoded "11 PM – 8 AM".
 */
export function formatClockTime(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return hhmm;
  return formatTime(`${m[1]}:${m[2]}`);
}

/**
 * Human label for a quiet-hours / DND window, e.g. "11 PM–8 AM" or "11:30 PM–8 AM".
 * Returns null when either bound is missing so callers can fall back.
 */
export function formatQuietHours(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const a = formatClockTime(start)?.replace(':00 ', ' ');
  const b = formatClockTime(end)?.replace(':00 ', ' ');
  if (!a || !b) return null;
  return `${a}–${b}`;
}
