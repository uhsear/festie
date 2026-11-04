-- 102_festival_sets_display_name.sql
-- Optional billed name for a set, such as "Skull Machine (Black Tiger Sex Machine x Kai Wachi)".
-- The artists array keeps each artist and their links. NULL shows the artists joined by the
-- festival's B2B separator, as before.
ALTER TABLE festival_sets ADD COLUMN IF NOT EXISTS display_name TEXT;
