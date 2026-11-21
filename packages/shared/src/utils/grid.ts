/**
 * Shared constants and utility functions for the timeline grid view.
 */
import { minutesToTime, uses24HourClock } from './format';

// The grid axis and set cells are tight, so these keep the compact 12-hour form ("9pm") and switch to plain
// "21:00" where the runtime locale uses a 24-hour clock.
const clock24 = (totalMin: number) => minutesToTime(totalMin % 1440);

export function fmtHour(totalMin: number): string {
  if (uses24HourClock()) return clock24(totalMin);
  const h = Math.floor(totalMin / 60) % 24;
  return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
}

/** The one-letter form of `fmtHour` for a grid time axis: "9a", "9:30p", or "21:30" on a 24-hour clock. */
export function fmtAxisHour(totalMin: number): string {
  if (uses24HourClock()) return clock24(totalMin);
  const hh = Math.floor(totalMin / 60) % 24;
  const mm = totalMin % 60;
  const h = hh % 12 || 12;
  const suffix = hh < 12 ? 'a' : 'p';
  return mm === 0 ? `${h}${suffix}` : `${h}:${String(mm).padStart(2, '0')}${suffix}`;
}

export function fmtShort(t: string): string {
  const [h = 0, m = 0] = t.split(':').map(Number);
  if (uses24HourClock()) return clock24(h * 60 + m);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}

export interface GridBounds {
  lo: number;
  hi: number;
  span: number;
}

export interface HourMark {
  m: number;
  px: number;
}
