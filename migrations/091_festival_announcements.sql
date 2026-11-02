-- 091_festival_announcements.sql
-- Admin announcements to everyone who joined a festival (T44). One row per
-- announcement. send_at is when it goes out; sent_at is set when a worker claims
-- it, so a row is sent at most once. cancelled_at hides the banner and stops an
-- unsent row. created_by has no foreign key: deleting that admin must not block.
-- Additive and idempotent. Plain index builds (not CONCURRENTLY) because the
-- runner may wrap migrations in a transaction (see 057).
CREATE TABLE IF NOT EXISTS festival_announcements (
  id              TEXT PRIMARY KEY,
  festival_id     TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  severity        TEXT NOT NULL CHECK (severity IN ('info', 'urgent')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  screen          TEXT NOT NULL DEFAULT 'home'
                  CHECK (screen IN ('home', 'map', 'timeline', 'picks', 'festival-mode', 'crew')),
  send_at         TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  recipient_count INTEGER,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_festival_announcements_festival
  ON festival_announcements (festival_id, send_at DESC);
CREATE INDEX IF NOT EXISTS idx_festival_announcements_due
  ON festival_announcements (send_at) WHERE sent_at IS NULL AND cancelled_at IS NULL;
-- Push budget (T44 P3) and the T33 inbox list both read a user's recent inbox rows.
CREATE INDEX IF NOT EXISTS idx_notification_log_inbox_recent
  ON notification_log (user_id, created_at DESC) WHERE platform = 'inbox';
