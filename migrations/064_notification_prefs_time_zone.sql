-- 064: IANA time zone for the quiet-hours (DND) window.
--
-- dnd_start / dnd_end are wall-clock HH:MM strings. The server compared them with
-- its own clock, so a user in another zone got the window shifted. This column
-- records the zone the user set the window in; lib/notifications/dnd.ts reads the
-- wall clock in that zone. NULL means "use the server clock" (the old behavior),
-- so existing rows need no backfill.
--
-- Additive, idempotent (ADD COLUMN IF NOT EXISTS). No backfill.

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS dnd_time_zone TEXT;
