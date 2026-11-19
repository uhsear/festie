-- 116_notification_dedup_unique.sql
-- Make the once-per-event-per-user notification dedup a database guarantee.
--
-- existsForEvent / existsForEvents check notification_log, then the send logs a row in a
-- separate statement, so two workers could both pass the check. Migration 057 indexed the
-- (user_id, type, eventKey) tuple but not uniquely.
--
-- Only the inbox row and the email row are once per user per event. Push rows are logged
-- once per device, so they share an eventKey and stay outside the index.
--
-- Repeat rows already in the table would make the unique index fail, so the extra copies
-- are removed first (the earliest row stays). Idempotent per the repo migration convention.
DELETE FROM notification_log
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY user_id, type, platform, (data_json->>'eventKey')
             ORDER BY created_at, id
           ) AS rn
    FROM notification_log
    WHERE platform IN ('inbox', 'email') AND data_json->>'eventKey' IS NOT NULL
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_log_event_key
  ON notification_log (user_id, type, platform, (data_json->>'eventKey'))
  WHERE platform IN ('inbox', 'email') AND data_json->>'eventKey' IS NOT NULL;
