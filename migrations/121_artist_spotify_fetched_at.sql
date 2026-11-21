-- 121_artist_spotify_fetched_at.sql
-- artists.spotify_fetched_at: when artists.photo and artists.genres were last read from Spotify.
-- The Spotify Developer Terms (IV.3.1.1) forbid keeping Spotify content indefinitely. The scheduled
-- refresh (lib/spotify-refresh.ts) re-reads every artist with a Spotify id whose value is NULL or older
-- than 30 days, so existing rows count as stale and are read once on the first run.
-- Idempotent, no BEGIN/COMMIT, per the repo migration convention.

ALTER TABLE artists ADD COLUMN IF NOT EXISTS spotify_fetched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_artists_spotify_stale
  ON artists (spotify_fetched_at NULLS FIRST)
  WHERE spotify_id IS NOT NULL AND merged_into IS NULL;
