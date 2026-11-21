-- 121_artist_match_reviews.sql
-- The admin "Artist review" queue: researched link, merge and rename proposals that an admin approves one by one.
-- Additive. artist_suggestions is not reused: it holds an organizer's change to one artist, with no candidates,
-- confidence or evidence, and it cannot hold a merge.
--   item_key: a hash of the item's kind, name, festival, artist ids and proposed change. It is UNIQUE, so importing
--     the same batch twice adds nothing, and a decided item is never reopened by a later import.
--   artist_ids: for link and rename, the artist the change applies to (empty: found by name when approved).
--     For merge, the artist merged away first, then the survivor when the batch names it.
--   seq: the order the items arrived in, so a batch reads in the order its author wrote it.
--   chosen_url: the link an admin approved (a candidate, or one typed over it).
CREATE TABLE IF NOT EXISTS artist_match_reviews (
  id TEXT PRIMARY KEY,
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  item_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'merge', 'rename')),
  artist_name TEXT NOT NULL,
  festival TEXT NOT NULL DEFAULT '',
  artist_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  chosen_url TEXT,
  decision_note TEXT CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  batch_generated_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_artist_match_reviews_status ON artist_match_reviews (status, seq);
