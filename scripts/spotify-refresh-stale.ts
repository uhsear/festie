// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Re-reads stored Spotify photos and genres that are older than the refresh limit (30 days).
 * Run by cron once a day; see lib/spotify-refresh.ts for the crontab line and scripts/backup-cron.example.
 *
 *   node --import tsx/esm scripts/spotify-refresh-stale.ts [--max-age-days 30] [--limit 1000]
 *
 * Reads DATABASE_URL, SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET from the environment or .env, like the
 * app. It cannot clear the running app's festival cache: a changed photo shows within a minute at most.
 * The admin route POST /api/v1/admin/artists/spotify-refresh-stale does the same and clears the cache.
 * Exit 0 when the run finished, 1 on an error.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { loadConfig } from '../lib/config';
import { createArtistsStore } from '../lib/db/stores/artists';
import { refreshStaleSpotifyArtists, SPOTIFY_MAX_AGE_DAYS } from '../lib/spotify-refresh';

function readArgs(argv: string[]) {
  const options = { maxAgeDays: SPOTIFY_MAX_AGE_DAYS, limit: 1000 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = Number(argv[++i]);
    if (!Number.isInteger(value) || value < 1) throw new Error(`${key} needs a whole number of at least 1`);
    if (key === '--max-age-days') options.maxAgeDays = value;
    else if (key === '--limit') options.limit = value;
    else throw new Error(`Unknown argument "${key}". Use --max-age-days and --limit.`);
  }
  return options;
}

async function main() {
  const options = readArgs(process.argv.slice(2));
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const log = {
    info: (message: string, meta?: unknown) => console.log(message, JSON.stringify(meta ?? {})),
    warn: (message: string, meta?: unknown) => console.warn(message, JSON.stringify(meta ?? {})),
    error: (message: string, meta?: unknown) => console.error(message, JSON.stringify(meta ?? {})),
  };
  try {
    const result = await refreshStaleSpotifyArtists({ stores: { artists: createArtistsStore(pool) }, config, log, ...options });
    if (result.skipped) console.warn(`Nothing ran: ${result.skipped}. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
