-- 075_share_link_revocation.sql
-- Revocable share links (T22). New links are /s/<share_token>. Old
-- /s/<profileId> links work until the user resets (share_links_reset_at).
-- Every value is NULL at create time, so the index build is instant.
ALTER TABLE festival_profiles ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_festival_profiles_share_token
  ON festival_profiles (share_token) WHERE share_token IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS share_links_reset_at TIMESTAMPTZ;
