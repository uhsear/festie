import { FestivalSet } from '../types/domain';
import { createDateInLocalFrame } from './setStatus';

/**
 * Format a festival date range for display, e.g. "Sep 4 – Sep 6, 2026".
 * Accepts YYYY-MM-DD or ISO strings (uses the date portion, parsed as local to
 * avoid UTC off-by-one). Returns null on missing/unparseable input so callers
 * hide the row instead of rendering "Invalid Date".
 */
export function formatFestivalDateRange(startDate?: string | null, endDate?: string | null): string | null {
  if (!startDate || !endDate) return null;
  // Build both endpoints in a single consistent local frame (no JS string-parser
  // UTC/local ambiguity) — same TZ-safe pattern as setStatus.createDateInLocalFrame.
  const start = createDateInLocalFrame(startDate, 0, 0);
  const end = createDateInLocalFrame(endDate, 0, 0);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString('en-US', opts);
  const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

export function formatTime(t: string | undefined): string {
  if (!t) return '';
  const [hh = '0', mm = '00'] = t.split(':');
  let hr = parseInt(hh, 10);
  const ap = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${hr}:${mm} ${ap}`;
}

export function timeToMinutes(t: string | undefined): number {
  if (!t) return 0;
  const [hh = 0, mm = 0] = t.split(':').map((x) => parseInt(x, 10));
  return hh * 60 + mm;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function artistDisplayName(set: FestivalSet, separator?: string): string {
  const sep = separator || 'b2b';
  const joined = set.artists?.length ? set.artists.map((a) => a.name).join(` ${sep} `) : '';

  if (set.artist && (!joined || set.artist !== joined)) return set.artist;
  if (joined) return joined;
  return set.artist || 'Unknown';
}

export function artistSubtitle(set: FestivalSet, separator?: string): string {
  if (!set.artists || set.artists.length < 2) return '';
  const sep = separator || 'b2b';
  const joined = set.artists.map((a) => a.name).join(` ${sep} `);
  if (!set.artist || set.artist === joined) return '';
  return joined;
}

export function getSetLinks(set: FestivalSet): Array<{ name: string; links: Record<string, string> }> {
  if (!set.artists?.length) {
    return set.linkUrl ? [{ name: set.artist || 'Unknown', links: { spotify: set.linkUrl } }] : [];
  }
  return set.artists.filter((a) => a.links && Object.keys(a.links).length > 0) as Array<{
    name: string;
    links: Record<string, string>;
  }>;
}
