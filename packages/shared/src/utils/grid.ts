/**
 * Shared constants and utility functions for the timeline grid view.
 */

export function fmtHour(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24;
  return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
}

export function fmtShort(t: string): string {
  const [h = 0, m = 0] = t.split(':').map(Number);
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
