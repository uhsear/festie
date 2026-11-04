-- 101_device_tokens_local_covers_until.sql
-- A phone holds at most 64 local set reminders. It reports the fire time (epoch ms) of the
-- last one it scheduled, so the reminder scheduler skips only the pushes the phone already
-- covers and still pushes later ones. NULL keeps the whole-festival skip (old builds).
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS local_reminders_covers_until BIGINT;
