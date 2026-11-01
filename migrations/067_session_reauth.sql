-- 067: last password re-entry for a session.
--
-- Destructive admin actions (festival delete, user delete, role changes, a
-- festival save that loses picks) need a password typed within the last 15
-- minutes. POST /api/v1/auth/reauth stamps this column on the caller's session
-- row; lib/app-context/session.ts compares it with NOW(). NULL means "never
-- re-authenticated", so existing sessions need no backfill. A rotated session
-- token starts NULL, so the admin types the password again.
--
-- Additive, idempotent (ADD COLUMN IF NOT EXISTS). No backfill.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS reauth_at TIMESTAMPTZ;
