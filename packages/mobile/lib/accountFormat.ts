/**
 * Pure formatting + scoring helpers for the Account tab. No React Native / DOM
 * imports so this stays trivially unit-testable and safe to import anywhere.
 *
 * Lives in packages/mobile/lib (mobile-local) rather than @festie/shared because
 * it is presentation-only sugar for the native Account screen; the shared
 * package owns the data shapes, not how mobile chrome labels them. Date
 * formatting (formatFestivalDate, formatDateSpan) lives in @festie/shared/utils.
 */

/**
 * Format a 24h 'HH:MM' clock string into a 12h label like "11:00 PM" / "8:00 AM".
 * Returns the raw input on any parse miss so a caption never blanks. Used by the
 * quiet-hours caption so it reflects the stored DND window instead of a
 * hardcoded "11 PM – 8 AM".
 */
export function formatClockTime(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  let hour = Number(m[1]);
  const minutes = m[2];
  if (hour < 0 || hour > 23 || Number(minutes) > 59) return hhmm;
  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minutes} ${period}`;
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

export interface PasswordStrength {
  /** 0 (empty) … 4 (strong). Drives the meter segment count + label. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

/**
 * Lightweight password-strength heuristic for the change-password meter. This is
 * UX guidance only — the authoritative rule is the shared 8-char minimum the
 * form already enforces; this just rewards length + character variety so a user
 * gets a "weak / fair / good / strong" nudge as they type.
 */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: '' };
  let points = 0;
  if (pw.length >= 8) points += 1;
  if (pw.length >= 12) points += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points += 1;
  if (/\d/.test(pw)) points += 1;
  if (/[^A-Za-z0-9]/.test(pw)) points += 1;
  // Anything under the 8-char floor can never read above "Weak".
  if (pw.length < 8) {
    return { score: 1, label: 'Too short' };
  }
  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4;
  const label = (['', 'Weak', 'Fair', 'Good', 'Strong'] as const)[score];
  return { score, label };
}
