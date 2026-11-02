-- 090_crew_days_coming.sql
-- T43: which festival days each crew member attends, and who taps "I'll be there"
-- on a meeting point. Both tables key on crew_members (crew_id, user_id) with
-- ON DELETE CASCADE, so leaving, being removed, account hard delete and crew
-- delete all clear the rows with no route code. Additive and idempotent.

CREATE TABLE IF NOT EXISTS crew_member_days (
  crew_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  day_index  INTEGER NOT NULL CHECK (day_index >= 0),
  answer     TEXT NOT NULL CHECK (answer IN ('going', 'maybe', 'no')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (crew_id, user_id, day_index),
  FOREIGN KEY (crew_id, user_id) REFERENCES crew_members (crew_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crew_meeting_point_coming (
  meeting_point_id TEXT NOT NULL REFERENCES crew_meeting_points (id) ON DELETE CASCADE,
  crew_id          TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (meeting_point_id, user_id),
  FOREIGN KEY (crew_id, user_id) REFERENCES crew_members (crew_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS crew_meeting_point_coming_member_idx
  ON crew_meeting_point_coming (crew_id, user_id);
