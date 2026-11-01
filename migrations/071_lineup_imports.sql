-- 071_lineup_imports.sql
-- One row per committed lineup import, so the newest import can be undone.
-- The set ids live here, not in a festival_sets column: the festival editor save
-- deletes and re-inserts every set row (keeping ids), which would wipe such a column.
CREATE TABLE IF NOT EXISTS lineup_imports (
  id                  TEXT PRIMARY KEY,
  festival_id         TEXT NOT NULL REFERENCES festivals(id) ON DELETE RESTRICT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  counts              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_set_ids     TEXT[] NOT NULL DEFAULT '{}',
  created_stage_ids   TEXT[] NOT NULL DEFAULT '{}',
  created_day_indexes INTEGER[] NOT NULL DEFAULT '{}',
  -- [{ id, before: {...}, after: {...} }] for each set the import changed
  updated_sets        JSONB NOT NULL DEFAULT '[]'::jsonb,
  undone_at           TIMESTAMPTZ,
  undo_summary        JSONB
);
CREATE INDEX IF NOT EXISTS idx_lineup_imports_festival ON lineup_imports (festival_id, created_at DESC);
