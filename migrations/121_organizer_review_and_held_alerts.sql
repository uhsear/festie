-- 121_organizer_review_and_held_alerts.sql
-- Review of an organizer's publish request and the hold on attendee alerts that an organizer's save would send.
--   festivals.publish_requested_at   set while a submit-for-review waits for an admin
--   festivals.publish_review_note    the admin's note when a request was declined; cleared on submit and on publish
--   festival_held_schedule_changes   moved, removed and cancelled acts whose alert waits for an admin to release it
-- Idempotent and additive, no BEGIN/COMMIT, per the repo migration convention.

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS publish_requested_at TIMESTAMPTZ;
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS publish_review_note TEXT;

-- One row per set (or per announced entry for a cancelled act), merged on every later save: the first
-- before_slot stays, the latest kind, artist and after_slot win, and the people are united. picker_ids and
-- interest_holder_ids hold user ids, so a festival read can never return them by accident.
CREATE TABLE IF NOT EXISTS festival_held_schedule_changes (
  festival_id TEXT NOT NULL REFERENCES festivals (id) ON DELETE CASCADE,
  -- The set id, or the lineup entry id when kind is entry_cancelled.
  set_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('moved', 'removed', 'entry_cancelled')),
  artist TEXT NOT NULL,
  before_slot JSONB,
  after_slot JSONB,
  picker_ids TEXT[] NOT NULL DEFAULT '{}',
  interest_holder_ids TEXT[] NOT NULL DEFAULT '{}',
  -- For entry_cancelled: the stored sets that covered the act, so a person told about a removed set is not told twice.
  covered_set_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (festival_id, set_id)
);
