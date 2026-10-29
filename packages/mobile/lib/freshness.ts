export type Freshness = 'live' | 'aging' | 'stale';

/** Cache age under which a surface still reads as live. */
export const LIVE_MAX_AGE_MS = 5 * 60_000;
/** Cache age under which a surface reads as aging; older is stale. */
export const AGING_MAX_AGE_MS = 60 * 60_000;

/**
 * Maps a cache age to the shared `confidence.*` level. A future or invalid
 * timestamp (clock skew) reads as live, matching `timeAgo`'s "just now".
 */
export function freshnessFor(cachedAt: number, now: number = Date.now()): Freshness {
  const age = now - cachedAt;
  if (!Number.isFinite(age) || age < LIVE_MAX_AGE_MS) return 'live';
  return age < AGING_MAX_AGE_MS ? 'aging' : 'stale';
}
