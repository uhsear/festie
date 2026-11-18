-- 106_festival_time_releases.sql
-- One row per festival date whose "set times are out" alert an admin released. The row is the claim:
-- the release route inserts it before anything is sent, so two requests for one date send once.
-- sent_at says the fan-out finished, and recipients counts the people it reached. Keyed by date, not
-- day index, because a festival save deletes and re-inserts its days. ON DELETE CASCADE keeps
-- retention_cleanup() working. A silent save or import never writes a row.
CREATE TABLE IF NOT EXISTS festival_time_releases (
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  day_date    TEXT NOT NULL CHECK (day_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  event_key   TEXT NOT NULL,
  note        TEXT NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ NULL,
  recipients  INTEGER NULL,
  PRIMARY KEY (festival_id, day_date)
);

-- A festival that already sent its one-time alert keeps that fact: every dated day that has a timed
-- set counts as released and sent, with the old key times:<id>. New keys carry a request uuid, so they
-- never equal a backfilled key. A dated day with no timed set gets no row. Re-running changes nothing.
INSERT INTO festival_time_releases (festival_id, day_date, event_key, claimed_at, sent_at)
SELECT DISTINCT f.id, d.date, 'times:' || f.id, f.set_times_out_at, f.set_times_out_at
FROM festivals f
JOIN festival_days d ON d.festival_id = f.id
WHERE f.set_times_out_at IS NOT NULL
  AND d.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND EXISTS (
    SELECT 1 FROM festival_sets s
    WHERE s.festival_id = f.id AND s.day_index = d.day_index
      AND s.start_time IS NOT NULL AND s.start_time <> '')
ON CONFLICT DO NOTHING;
