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

/** The surface state: a cache age level, or `offline` when the device has no signal. */
export type SignalState = Freshness | 'offline';

/** Offline wins over cache age: with no signal, the data cannot be arriving. */
export function signalStateFor(cachedAt: number, offline: boolean, now: number = Date.now()): SignalState {
  return offline ? 'offline' : freshnessFor(cachedAt, now);
}

/** Does this state still carry the glow? Only live data does; aging dims it, stale and offline lose it. */
export const signalGlows = (state: SignalState): boolean => state === 'live';

/**
 * The data age as a bare numeral for the header: "<1m", "4m", "2h", "3d".
 * Clock skew or a non-finite age reads as "<1m", matching `timeAgo`.
 */
export function signalAgeNumeral(cachedAt: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - cachedAt) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
