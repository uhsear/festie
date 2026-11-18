-- 104_festival_lineup.sql
-- The announced lineup: one JSON array per festival, saved through the festival PUT. Each entry holds
-- id, artists, displayName, tier, dayDate, status, announcedAt and linkedSetIds. Whether an entry is
-- scheduled is derived from the sets, so nothing here points at festival_sets.
-- A constant default adds the column without a table rewrite. Old builds ignore it.
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS lineup JSONB NOT NULL DEFAULT '[]'::jsonb;
