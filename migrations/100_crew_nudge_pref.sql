-- 100: an own opt-out for crew nudges ("Looking for you", push type crew_nudge).
--
-- Nudges shared the crew_updates switch until now. send.ts's PREF_MAP routes
-- crew_nudge -> crew_nudges. Booleans are INTEGER 0/1, default 1, like 048 and 069.
--
-- Someone who turned crew_updates off had also turned nudges off, and nudges skip
-- quiet hours. So the first run copies that opt-out into the new column. The copy
-- runs only when the column is added, so a re-run never overwrites a later choice.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_preferences' AND column_name = 'crew_nudges'
  ) THEN
    ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS crew_nudges INTEGER DEFAULT 1;
    UPDATE notification_preferences SET crew_nudges = 0 WHERE crew_updates = 0;
  END IF;
END $$;
