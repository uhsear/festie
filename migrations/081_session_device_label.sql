-- 081: a readable device name for each session.
--
-- GET /api/v1/auth/sessions lists signed-in devices. routes/auth.ts works out
-- a label such as "Chrome on Windows" or "Festie app on iOS" from the
-- User-Agent (lib/helpers/device-label.ts) when it creates a session. The raw
-- User-Agent is never stored. NULL means "Unknown device"; existing sessions
-- keep NULL until the next sign-in or token refresh.
--
-- Additive, idempotent (ADD COLUMN IF NOT EXISTS). No backfill.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_label TEXT;
