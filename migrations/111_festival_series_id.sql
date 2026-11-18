-- 111_festival_series_id.sql
-- Optional link between editions of one recurring festival, such as "forbidden-kingdom".
-- NULL means the festival is in no explicit series. Readers fall back to the name-minus-year match.
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS series_id TEXT;
CREATE INDEX IF NOT EXISTS idx_festivals_series_id ON festivals (series_id) WHERE series_id IS NOT NULL;
