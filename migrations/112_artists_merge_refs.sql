-- Merge duplicate artists. A merge makes the loser a tombstone (merged_into) and records on it the
-- set and lineup refs it moved and its own before-values (merge_refs), so the editor can re-pick
-- the artist on a slot later. No un-merge tool exists.
--   merge_refs: migration 107 already creates it on a fresh database. The guard below keeps a
--     database that skipped that definition correct.
--   idx_artists_merged_into: a merge re-points the older tombstones of the loser to the survivor.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS merge_refs JSONB;

CREATE INDEX IF NOT EXISTS idx_artists_merged_into ON artists (merged_into) WHERE merged_into IS NOT NULL;
