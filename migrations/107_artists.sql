-- 107_artists.sql
-- Artist identity groundwork. Nothing reads these objects yet.
--   artists: one global row per artist. name_key comes from lib/artist-key.ts. Two live artists
--     with the same key need different notes (label). A merge makes a tombstone (merged_into), and
--     merge_refs records what the merge moved. No hard delete, so an id in a copy never dangles.
--   artist_backfill_runs: the before-values of each festival that a backfill run rewrote.
--   festivals.edited_at: the festival form's conflict token. Writers that change what the form
--     saves set it to the same value as updated_at. Publish, restore and artist syncs do not.
CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  name_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '' CHECK (char_length(label) <= 40),
  spotify_id TEXT,
  links JSONB NOT NULL DEFAULT '{}'::jsonb,
  photo TEXT,
  genres JSONB NOT NULL DEFAULT '[]'::jsonb,
  merged_into TEXT REFERENCES artists(id) ON DELETE RESTRICT,
  merge_refs JSONB,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_live_key_label
  ON artists (name_key, lower(label)) WHERE merged_into IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_live_spotify_id
  ON artists (spotify_id) WHERE spotify_id IS NOT NULL AND merged_into IS NULL;
CREATE INDEX IF NOT EXISTS idx_artists_name_key ON artists (name_key);

CREATE TABLE IF NOT EXISTS artist_backfill_runs (
  run_id TEXT NOT NULL,
  festival_id TEXT NOT NULL,
  before JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, festival_id)
);

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
UPDATE festivals SET edited_at = updated_at WHERE edited_at IS NULL;
