-- 069: finer crew notification types and must-see auto reminders.
--
-- Four crew opt-outs split the single crew_updates toggle by push type. send.ts's
-- PREF_MAP routes:
--   crew_meeting_point -> crew_meeting_points
--   crew_poll          -> crew_polls
--   crew_money         -> crew_money
--   crew_ride          -> crew_rides
-- must_see_reminder_minutes is the lead time for automatic reminders before every
-- set a user marks Must see. NULL means "off".
--
-- Additive and idempotent (ADD COLUMN IF NOT EXISTS). Booleans are INTEGER 0/1,
-- default 1 (opted in), like 048. The read path treats a NULL boolean as 1, so
-- existing rows need no backfill.

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS crew_meeting_points INTEGER DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS crew_polls INTEGER DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS crew_money INTEGER DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS crew_rides INTEGER DEFAULT 1;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS must_see_reminder_minutes INTEGER
  CHECK (must_see_reminder_minutes IN (5, 10, 15, 30, 60));
