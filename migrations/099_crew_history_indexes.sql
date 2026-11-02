-- 099_crew_history_indexes.sql
-- T58: the decided-polls branch of polls.listByCrew and the past
-- meeting-points list filter on rows that the partial indexes from
-- 017 and 018 leave out (closed polls, inactive points).
-- Plain build, not concurrent: both tables are crew-scale, and the
-- runner cannot roll back a concurrent build (see 062).

CREATE INDEX IF NOT EXISTS idx_crew_polls_crew
  ON crew_polls (crew_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cmp_crew_inactive
  ON crew_meeting_points (crew_id, expires_at DESC)
  WHERE active = FALSE;
