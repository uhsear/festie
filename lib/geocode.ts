// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Venue geocoding for festivals: turns a free-text `location` such as
// "Tinker Field · Orlando, FL" into latitude/longitude, which the map uses as its
// fallback centre and the weather route needs.
//
// Provider: OpenStreetMap Nominatim. Its usage policy allows storing results
// (ODbL, credited by the map attribution) and asks for an identifying
// User-Agent and at most one request per second, so requests are serialised.
// Only admin festival saves and a one-time boot backfill call this.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Festie/1.0 (+https://festie.us; security@festie.us)';
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 5000;

export interface VenueCoords {
  latitude: number;
  longitude: number;
}

/**
 * Queries to try, most specific first: the whole location, then the venue name
 * alone (a venue's listed city is often wrong, e.g. SeatGeek Stadium is in
 * Bridgeview, not Chicago), then the town alone.
 */
export function venueQueries(location: string): string[] {
  const parts = location
    .split(/\s*[·•|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const queries = [parts.join(', ')];
  if (parts.length > 1) queries.push(parts[0] ?? '', parts.slice(1).join(', '));
  return [...new Set(queries.filter(Boolean))];
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export function createVenueGeocoder({ fetchImpl = fetch as unknown as FetchLike, log }: { fetchImpl?: FetchLike; log?: any } = {}) {
  let queue: Promise<unknown> = Promise.resolve();
  let nextSlotAt = 0;

  async function search(q: string): Promise<VenueCoords | null> {
    // Claim the next free slot before waiting, so the spacing holds without a read-after-await.
    const now = Date.now();
    const startAt = Math.max(now, nextSlotAt);
    nextSlotAt = startAt + MIN_INTERVAL_MS;
    if (startAt > now) await new Promise((r) => setTimeout(r, startAt - now));
    const url = `${NOMINATIM_URL}?${new URLSearchParams({ q, format: 'jsonv2', limit: '1' })}`;
    const resp = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{ lat?: string; lon?: string }>;
    const latitude = Number(rows?.[0]?.lat);
    const longitude = Number(rows?.[0]?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
  }

  /** Resolve a festival location to coordinates, or null when nothing matches or the lookup fails. */
  function geocodeVenue(location: string | null | undefined): Promise<VenueCoords | null> {
    const run = async () => {
      if (!location?.trim()) return null;
      for (const q of venueQueries(location)) {
        try {
          const hit = await search(q);
          if (hit) return hit;
        } catch (error: any) {
          log?.warn?.('venue geocode failed', { query: q, error: error?.message });
          return null;
        }
      }
      return null;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => null);
    return result;
  }

  return { geocodeVenue };
}

/**
 * One pass over festivals that have a location but no venue coordinates. Run once
 * at boot by the leader instance, so festivals saved before geocoding existed get
 * a map centre and weather. Requests are serialised by the geocoder (1 per second).
 * shortcut: a location Nominatim cannot find is retried on every boot; add a
 * "not found" marker if that list ever grows past a handful.
 */
export async function backfillVenueCoords({ pool, geocodeVenue, log, onUpdated }: any): Promise<number> {
  const { rows } = await pool.query(
    "SELECT id, location FROM festivals WHERE deleted_at IS NULL AND latitude IS NULL AND COALESCE(location, '') <> ''",
  );
  let filled = 0;
  for (const row of rows) {
    const coords = await geocodeVenue(row.location);
    if (!coords) continue;
    await pool.query('UPDATE festivals SET latitude = $1, longitude = $2 WHERE id = $3 AND latitude IS NULL', [
      coords.latitude,
      coords.longitude,
      row.id,
    ]);
    filled++;
  }
  if (filled) onUpdated?.();
  log?.info?.('venue backfill completed', { checked: rows.length, filled });
  return filled;
}
