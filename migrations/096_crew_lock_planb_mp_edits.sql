-- 096_crew_lock_planb_mp_edits.sql
-- T54: owner "Lock crew" (invite joins refused while set; the code is kept),
-- an optional Home Base "Plan B" line, and the last time or place edit of a
-- meeting point ("Edited by ana, was North gate"). Additive and idempotent.

ALTER TABLE crews ADD COLUMN IF NOT EXISTS invite_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_base_plan_b TEXT;

-- edited_by is cleared, not cascaded, when the editor's account is hard-deleted
-- (retention_cleanup, migration 060), so the point and its "was" text stay.
ALTER TABLE crew_meeting_points ADD COLUMN IF NOT EXISTS edited_by TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE crew_meeting_points ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE crew_meeting_points ADD COLUMN IF NOT EXISTS edit_was JSONB;
