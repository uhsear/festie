-- 092_set_moves.sql
-- T46: remember where a set was before an admin moved it, so the app can say
-- "Moved from Sat 10:00 PM, Sahara" for 48 hours. moved_from holds
-- {dayIndex, stageId, start, end}. Both are NULL until a published set moves.
-- Additive, no backfill, idempotent. Old clients ignore the new keys.
ALTER TABLE festival_sets ADD COLUMN IF NOT EXISTS moved_at TIMESTAMPTZ;
ALTER TABLE festival_sets ADD COLUMN IF NOT EXISTS moved_from JSONB;
