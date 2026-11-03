-- 094_festival_slug.sql
-- T50: public festival page at /f/<slug>. A festival gets a slug when it is
-- published; drafts have none. The slug is stable once set: renames, date
-- changes, archive and restore keep it. One SQL function holds the rule, so
-- this backfill, stores.festivals.publish() and create() always agree.
-- normalize() needs a UTF8 database (production is UTF8, checked 2026-11-02).
-- Keep this file ASCII: the test harness strips other bytes. The combining
-- mark range is written as the ARE escape \u0300-\u036f for that reason.

ALTER TABLE festivals ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_festivals_slug ON festivals (slug);

-- name + first day year, ASCII, lower case, hyphens.
CREATE OR REPLACE FUNCTION festival_slug_base(p_name TEXT, p_first_date TEXT) RETURNS TEXT AS $$
DECLARE
  base TEXT;
  yr TEXT;
BEGIN
  base := lower(regexp_replace(normalize(coalesce(p_name, ''), NFKD), '[\u0300-\u036f]', '', 'g'));
  base := trim(both '-' from regexp_replace(base, '[^a-z0-9]+', '-', 'g'));
  base := trim(both '-' from left(base, 60));
  IF base = '' THEN
    base := 'festival';
  END IF;
  yr := substring(coalesce(p_first_date, '') from '^(\d{4})-\d{2}-\d{2}');
  IF yr IS NOT NULL AND base !~ ('(^|-)' || yr || '(-|$)') THEN
    base := base || '-' || yr;
  END IF;
  RETURN base;
END;
$$ LANGUAGE plpgsql;

-- The first free slug for one festival: base, base-2, base-3, ...
-- Archived festivals keep theirs, so they count as taken.
CREATE OR REPLACE FUNCTION festival_next_slug(p_festival_id TEXT) RETURNS TEXT AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INT := 1;
BEGIN
  SELECT festival_slug_base(
           f.name,
           (SELECT MIN(d.date) FROM festival_days d
             WHERE d.festival_id = f.id AND d.date ~ '^\d{4}-\d{2}-\d{2}'))
    INTO base
    FROM festivals f
   WHERE f.id = p_festival_id;
  IF base IS NULL THEN
    RETURN NULL;
  END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM festivals WHERE slug = candidate AND id <> p_festival_id) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- Backfill published festivals, archived ones included, oldest first so the
-- earliest festival keeps the plain slug. Row by row, so each sees the last.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM festivals
     WHERE slug IS NULL AND published_at IS NOT NULL
     ORDER BY published_at, created_at, id
  LOOP
    UPDATE festivals SET slug = festival_next_slug(r.id) WHERE id = r.id;
  END LOOP;
END $$;
