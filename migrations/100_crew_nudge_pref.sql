-- 100: an own opt-out for crew nudges ("Looking for you", push type crew_nudge).
--
-- Nudges shared the crew_updates switch until now. send.ts's PREF_MAP routes
-- crew_nudge -> crew_nudges.
--
-- Additive and idempotent (ADD COLUMN IF NOT EXISTS). Booleans are INTEGER 0/1,
-- default 1 (opted in), like 048 and 069. The read path treats a NULL boolean
-- as 1, so existing rows need no backfill.

ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS crew_nudges INTEGER DEFAULT 1;
