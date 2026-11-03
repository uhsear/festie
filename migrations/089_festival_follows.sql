-- 089_festival_follows.sql
-- T42: people can follow a festival to hear about its lineup and set times.
-- Both foreign keys cascade on purpose: retention_cleanup() (migration 060)
-- hard-deletes users after 30 days and festivals after 90 days, and it does
-- not know this table. A RESTRICT key would abort the whole cleanup, as 060
-- documents for crews.
CREATE TABLE IF NOT EXISTS festival_follows (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, festival_id)
);
CREATE INDEX IF NOT EXISTS idx_festival_follows_festival ON festival_follows (festival_id);

-- When the "set times are out" alert went out. NULL = not yet. Set once.
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS set_times_out_at TIMESTAMPTZ;

-- Festivals that already have times must never send the alert.
UPDATE festivals f
SET set_times_out_at = COALESCE(f.published_at, NOW())
WHERE f.set_times_out_at IS NULL
  AND EXISTS (
    SELECT 1 FROM festival_sets s
    WHERE s.festival_id = f.id AND s.start_time IS NOT NULL AND s.start_time <> ''
  );
