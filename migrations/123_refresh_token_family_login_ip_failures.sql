-- 123_refresh_token_family_login_ip_failures.sql
-- Two auth hardening changes. Idempotent, no BEGIN/COMMIT, per the repo migration convention.
--
-- 1. refresh_tokens.family_id: every refresh token minted by one sign-in shares a family id, and each
--    rotation inherits it. Reuse of an already-rotated token revokes the whole family. A pre-existing
--    token becomes its own family (family_id = token), so the backfill revokes nothing extra.
--
-- 2. login_failure_ips: failed password attempts per (account, client IP). Reaching the per-IP threshold
--    locks the account for that IP only. login_failures keeps the account-wide total for the global lock.
--    ip_hash is a SHA-256 hex digest of the client IP, so the table holds no raw addresses.

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id TEXT;

UPDATE refresh_tokens SET family_id = token WHERE family_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS login_failure_ips (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  PRIMARY KEY (user_id, ip_hash)
);
