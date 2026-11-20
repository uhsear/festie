-- 110_artist_rules.sql
-- Artist rules for organizations (additive; the code that reads these columns ships with this file).
--   artists.verified: an artist an organizer created starts false. Existing rows, the backfill's included, are true.
--     Another tenant never gets an unverified artist linked by name or Spotify id; they pick it by hand.
--   artists.label_auto: true when the server chose the note ("unnamed 1") because a name and note clashed with
--     an artist the caller cannot see. Non-admins read such a note as empty.
--   artist_suggestions: an organizer's change to an artist that another organization or an admin-only festival
--     also uses, and every organizer Spotify change. An admin accepts or rejects it. festival_id cascades so
--     the retention job keeps purging festivals in place.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS label_auto BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS artist_suggestions (
  id TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE RESTRICT,
  festival_id TEXT REFERENCES festivals(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  changes JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_artist_suggestions_status ON artist_suggestions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_artist_suggestions_artist ON artist_suggestions (artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_suggestions_org ON artist_suggestions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artist_suggestions_festival ON artist_suggestions (festival_id) WHERE festival_id IS NOT NULL;
