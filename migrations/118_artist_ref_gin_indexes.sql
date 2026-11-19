-- 118_artist_ref_gin_indexes.sql
-- Index the artist ids that live inside festival_sets.artists and festivals.lineup.
--
-- Every artist use lookup (artists.list, edit, merge) expanded the JSONB of every set and
-- lineup row. The queries in lib/db/stores/artists.ts now pre-filter with a containment
-- test (@>) that these jsonb_path_ops indexes serve, then keep the exact id match.
--
-- CONCURRENTLY cannot run in a transaction, so this file has no BEGIN/COMMIT.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_festival_sets_artists_gin
  ON festival_sets USING gin (artists jsonb_path_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_festivals_lineup_gin
  ON festivals USING gin (lineup jsonb_path_ops);
