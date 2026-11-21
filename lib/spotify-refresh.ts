// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Keeps stored Spotify content fresh. The Spotify Developer Terms (IV.3.1.1) forbid keeping Spotify
 * content indefinitely, so every artist with a Spotify id gets its photo and genres re-read once the
 * stored copy is older than SPOTIFY_MAX_AGE_DAYS (artists.spotify_fetched_at, migration 121).
 *
 * An artist that Spotify answers for as unknown (404) loses its Spotify photo and genres at that age; a lookup that
 * fails keeps them and is tried again. A photo that did not come from Spotify is never replaced or cleared.
 *
 * It uses the same Spotify lookup (getArtistsByIds) and the same festival-copy rewrite as the admin
 * "fill photos from Spotify" route. Two callers: the admin route POST /api/v1/admin/artists/spotify-refresh-stale,
 * and scripts/spotify-refresh-stale.ts, which a cron runs. Crontab line (documented, not installed):
 *   30 3 * * * cd $APP_DIR && node --import tsx/esm scripts/spotify-refresh-stale.ts >> logs/spotify-refresh.log 2>&1
 */

import * as spotify from './spotify.js';
import type { SyncedFestival } from './db/stores/artists.js';

/** The longest Spotify photo and genres stay in the database before they are read again. */
export const SPOTIFY_MAX_AGE_DAYS = 30;
/** Artists read per Spotify batch, and the default cap on one run. The rest wait for the next run. */
const PAGE = 50;
const DEFAULT_LIMIT = 1000;

export interface SpotifyRefreshResult {
  /** Why nothing ran, when nothing did. */
  skipped?: 'spotify_not_configured';
  checked: number;
  updated: number;
  unchanged: number;
  /** Spotify's lookup failed for the artist: its stored data is left as it is and it is tried again next run. */
  unavailable: number;
  failed: number;
  rateLimited: boolean;
  /** The festivals whose copies changed. The caller clears caches for these. */
  synced: SyncedFestival[];
}

interface RefreshDeps {
  stores: { artists: any };
  config: { SPOTIFY_CLIENT_ID?: string; SPOTIFY_CLIENT_SECRET?: string };
  log: { info?: Function; warn?: Function; error?: Function };
  maxAgeDays?: number;
  limit?: number;
  userId?: string | null;
  ip?: string | null;
  /** Replaces the Spotify lookup in tests. */
  lookup?: (ids: string[], clientId: string, clientSecret: string, opts: { log: unknown; gone: Set<string> }) => Promise<Map<string, any>>;
}

export async function refreshStaleSpotifyArtists({
  stores,
  config,
  log,
  maxAgeDays = SPOTIFY_MAX_AGE_DAYS,
  limit = DEFAULT_LIMIT,
  userId = null,
  ip = null,
  lookup = spotify.getArtistsByIds,
}: RefreshDeps): Promise<SpotifyRefreshResult> {
  const result: SpotifyRefreshResult = { checked: 0, updated: 0, unchanged: 0, unavailable: 0, failed: 0, rateLimited: false, synced: [] };
  if (!config.SPOTIFY_CLIENT_ID || !config.SPOTIFY_CLIENT_SECRET) return { ...result, skipped: 'spotify_not_configured' };

  const seen: string[] = [];
  const synced = new Map<string, SyncedFestival>();
  while (result.checked < limit) {
    const rows: Array<{ id: string; spotifyId: string }> = await stores.artists.listStaleSpotify(
      maxAgeDays,
      Math.min(PAGE, limit - result.checked),
      seen,
    );
    if (rows.length === 0) break;
    seen.push(...rows.map((row) => row.id));
    result.checked += rows.length;

    let details: Map<string, any>;
    const gone = new Set<string>();
    try {
      details = await lookup([...new Set(rows.map((row) => row.spotifyId))], config.SPOTIFY_CLIENT_ID, config.SPOTIFY_CLIENT_SECRET, { log, gone });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'SPOTIFY_RATE_LIMITED') throw error;
      result.rateLimited = true;
      log.warn?.('spotify stale refresh stopped: Spotify is rate limiting Festie', { checked: result.checked });
      break;
    }

    for (const row of rows) {
      const spotifyArtist = details.get(row.spotifyId);
      // An artist Spotify says it does not know keeps nothing of Spotify's; a failed lookup changes nothing.
      if (!spotifyArtist && !gone.has(row.spotifyId)) {
        result.unavailable++;
        continue;
      }
      try {
        const outcome = await stores.artists.renewSpotifyDetails(row.id, {
          photo: spotifyArtist?.imageUrl ?? null,
          genres: spotifyArtist?.genres ?? [],
          userId,
          ip,
        });
        if (outcome.status === 'unchanged') {
          result.unchanged++;
          continue;
        }
        result.updated++;
        for (const festival of outcome.synced as SyncedFestival[]) {
          const have = synced.get(festival.id);
          synced.set(festival.id, have ? { ...have, setIds: [...have.setIds, ...festival.setIds] } : festival);
        }
      } catch (error) {
        result.failed++;
        log.error?.('spotify stale refresh failed for an artist', { artistId: row.id, error: (error as Error)?.message });
      }
    }
  }
  result.synced = [...synced.values()];
  log.info?.('spotify stale refresh done', { ...result, synced: result.synced.length });
  return result;
}
