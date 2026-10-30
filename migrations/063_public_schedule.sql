-- 063_public_schedule.sql
-- Owner decision: the public share page festie.us/u/:username is opt-in.
-- Every existing user starts private (DEFAULT FALSE); GET /s/u/:username
-- answers a private user exactly like a nonexistent one.
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_schedule BOOLEAN NOT NULL DEFAULT FALSE;
