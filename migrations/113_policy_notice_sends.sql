-- Ledger for the admin policy-notice email: one row per user per notice, so a re-run never
-- sends the same notice to the same user twice. Additive and forward-only.
-- ON DELETE CASCADE: the retention job and the account purge hard-delete users, and a send
-- record has no meaning once its user is gone. A plain REFERENCES would block those deletes.
CREATE TABLE IF NOT EXISTS policy_notice_sends (
  notice_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

-- The PK leads with notice_id; the cascade from a user delete looks rows up by user_id.
CREATE INDEX IF NOT EXISTS idx_policy_notice_sends_user ON policy_notice_sends (user_id);
