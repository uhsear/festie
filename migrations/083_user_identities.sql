-- 083_user_identities.sql
-- Sign in with Google and Apple (T45). user_identities links one provider
-- account (provider, subject) to one Festie user; a user has at most one
-- identity per provider. UNIQUE (user_id, provider) also serves lookups by
-- user_id, so no extra index. ON DELETE CASCADE drops identities when
-- purgeDeleted hard-deletes the user. apple_refresh_token_enc is sealed with
-- OAUTH_TOKEN_KEY (lib/oauth/secretbox.ts) and kept for Apple revocation.
-- Additive and idempotent. No transaction statements: the runner wraps each file.
CREATE TABLE IF NOT EXISTS user_identities (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  subject TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_private_email BOOLEAN NOT NULL DEFAULT FALSE,
  apple_refresh_token_enc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);

-- One-time server state: issued nonces, pending sign-ups, used ID tokens.
CREATE TABLE IF NOT EXISTS auth_oauth_states (
  key_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('nonce', 'signup', 'token')),
  payload JSONB,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_oauth_states_expires_at ON auth_oauth_states(expires_at);
