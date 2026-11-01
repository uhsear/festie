-- 065_poll_set_refs.sql
-- crew_polls.set_refs: index-aligned with options, each entry a set link or null.
ALTER TABLE crew_polls ADD COLUMN IF NOT EXISTS set_refs JSONB;
