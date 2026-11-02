-- 084_set_caught.sql
-- Whether a user saw a set: true means saw it, false means skipped it.
-- No row means unknown. Keyed like set_ratings, not a column on
-- festival_profile_picks, because a profile save deletes and re-inserts every
-- pick row (lib/db/stores/profiles.ts), which would wipe a column there.
-- Additive and idempotent. Old clients ignore it.

CREATE TABLE IF NOT EXISTS set_caught (
  user_id    text NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  set_id     text NOT NULL REFERENCES festival_sets(id) ON DELETE CASCADE,
  caught     boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, set_id)
);
CREATE INDEX IF NOT EXISTS idx_set_caught_set ON set_caught(set_id);
