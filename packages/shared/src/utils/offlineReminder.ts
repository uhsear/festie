import { zonedWallTimeToMs } from './setStatus';

/** Copy for the day-before reminder: the mobile local notification and the web home banner. */
export const OFFLINE_REMINDER_TEXT = 'Open Festie on wifi to save the lineup for no signal.';

const REMINDER_HOUR = 18;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Stable notification id, so rescheduling replaces the old one: at most one reminder per festival. */
export function offlineReminderId(festivalId: string): string {
  return `festie-offline-pack-${festivalId}`;
}

export interface QuietHours {
  dndStart?: string | null;
  dndEnd?: string | null;
  dndTimeZone?: string | null;
}

function wallClockHhmm(ms: number, timeZone?: string | null): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      // Unknown zone: fall through to the device clock.
    }
  }
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Same window rule as the server's `isInDndWindow` (lib/notifications/dnd.ts). */
function inQuietHours(ms: number, q: QuietHours): boolean {
  const { dndStart: start, dndEnd: end } = q;
  if (!start || !end || start === end) return false;
  const hhmm = wallClockHhmm(ms, q.dndTimeZone);
  return start < end ? hhmm >= start && hhmm <= end : hhmm >= start || hhmm < end;
}

const MINUTE_MS = 60_000;

/** First minute at or after `ms` that is outside quiet hours; `ms` itself when it is not inside them. */
function quietHoursEnd(ms: number, q: QuietHours): number {
  if (!inQuietHours(ms, q)) return ms;
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const untilEnd = (toMinutes(q.dndEnd!) - toMinutes(wallClockHhmm(ms, q.dndTimeZone)) + 1440) % 1440;
  let at = ms + untilEnd * MINUTE_MS;
  // The window's end minute can itself be inside it (same-day windows are inclusive), and a DST change can shift the wall clock.
  for (let i = 0; i < 180 && inQuietHours(at, q); i++) at += MINUTE_MS;
  return at;
}

/**
 * When to remind people to save the offline pack: 18:00 festival time on the
 * day before day 1 (device-local when the festival has no zone). Null when the
 * pack is ready or no day has a date. A time inside the user's quiet hours moves
 * to the end of them, and is dropped when that is not before the first day starts.
 * The result may be in the past; the caller decides what that means.
 */
export function offlineReminderAt(
  days: ReadonlyArray<{ date?: string | null }> | null | undefined,
  opts: { timeZone?: string; packReady: boolean; quietHours?: QuietHours | null },
): number | null {
  if (opts.packReady) return null;
  const dates = (days ?? []).map((d) => d.date?.slice(0, 10) ?? '').filter((d) => DATE_RE.test(d));
  if (dates.length === 0) return null;
  const [y, m, d] = dates.sort()[0]!.split('-').map(Number) as [number, number, number];
  const eve = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  const wallMs = (date: string, hour: number, localParts: [number, number, number]) =>
    opts.timeZone ? zonedWallTimeToMs(date, hour, 0, opts.timeZone) : new Date(...localParts, hour).getTime();
  const at = wallMs(eve, REMINDER_HOUR, [y, m - 1, d - 1]);
  if (Number.isNaN(at)) return null;
  if (!opts.quietHours) return at;
  const moved = quietHoursEnd(at, opts.quietHours);
  if (moved === at) return at;
  const start = wallMs(dates[0]!, 0, [y, m - 1, d]);
  return Number.isNaN(start) || moved >= start ? null : moved;
}
