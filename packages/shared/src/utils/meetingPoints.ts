import type { CrewMeetingPoint } from '../types/domain';

export const MEETING_POINT_PAST_HINT = 'Moves to Past 30 minutes after the meet time.';

/** Google Maps link: the saved coordinates when the point has them, else its text location. */
export function meetingPointDirectionsUrl(p: {
  latitude?: number | null;
  longitude?: number | null;
  location: string;
}): string {
  const q =
    typeof p.latitude === 'number' && Number.isFinite(p.latitude) && typeof p.longitude === 'number' && Number.isFinite(p.longitude)
      ? `${p.latitude},${p.longitude}`
      : p.location;
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`;
}

/**
 * `current`: active points not yet expired. `past`: active-but-expired points plus
 * the server's recently swept ones, deduplicated by id, newest `meet_at` first.
 */
export function splitMeetingPoints<T extends Pick<CrewMeetingPoint, 'id' | 'expires_at' | 'meet_at'>>(
  active: ReadonlyArray<T>,
  past: ReadonlyArray<T>,
  nowMs: number,
): { current: T[]; past: T[] } {
  const isExpired = (p: T) => !!p.expires_at && Date.parse(p.expires_at) <= nowMs;
  const current = active.filter((p) => !isExpired(p));
  const seen = new Set<string>();
  const merged = [...active.filter(isExpired), ...past].filter((p) => !seen.has(p.id) && !!seen.add(p.id));
  const at = (p: T) => (p.meet_at ? Date.parse(p.meet_at) : NaN);
  merged.sort((a, b) => {
    const x = at(a);
    const y = at(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
    return y - x;
  });
  return { current, past: merged };
}
