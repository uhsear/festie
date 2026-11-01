-- 066_device_tokens_local_reminders.sql
-- A phone that schedules on-device set reminders reports the festival it covers.
-- The reminder scheduler skips the server push to that device for that festival,
-- so the user gets one reminder, not two. NULL keeps the server push (web, old builds).
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS local_reminders_festival_id TEXT;
