-- 119_retention_cleanup.sql
-- retention_cleanup() re-issued from 116 (paid-expense placeholder handling kept) with three additions:
--   * notification_log rows older than 90 days are purged, except eventKey dedup rows and news types;
--   * crew_member_status (GPS/ETA breadcrumbs, no FK to users), crew_packing_items and
--     crew_ride_offers (created_by TEXT, no FK) rows of a purged user are deleted. They
--     were orphaned because only the crew cascade removed them.
-- users.hardDelete() gets the same three deletes. policy_notice_sends and policy_notices are untouched.
-- Idempotent, no BEGIN/COMMIT, per the repo migration convention.

CREATE OR REPLACE FUNCTION retention_cleanup() RETURNS void AS $$
BEGIN
  -- Existing: metrics and audit log cleanup
  DELETE FROM metrics_rollups
  WHERE bucket_start < now() - interval '90 days';

  DELETE FROM audit_log
  WHERE created_at < now() - interval '1 year';

  -- notification_log: personal data, keep 90 days (the inbox reads the newest 50).
  -- Keep eventKey rows (once-per-event-per-user send dedup, uq_notification_log_event_key) and the
  -- news types the admin growth report counts over up to 365 days; purging them would allow a re-send.
  -- type is nullable and NULL NOT IN (...) is NULL, so a NULL type is matched explicitly.
  DELETE FROM notification_log
  WHERE created_at < now() - interval '90 days'
    AND data_json->>'eventKey' IS NULL
    AND (type IS NULL OR type NOT IN ('lineup_drop', 'set_times_out', 'days_out', 'wrap_ready', 'crew_reformed'));

  -- Purge soft-deleted festivals older than 90 days
  -- Mirror festivals.hardDelete(): child rows under FK RESTRICT
  -- must be deleted before the parent.
  -- Child rows of festival_sets (FK RESTRICT)
  DELETE FROM set_ratings WHERE set_id IN (
    SELECT id FROM festival_sets WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM festival_profile_picks WHERE set_id IN (
    SELECT id FROM festival_sets WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM festival_profile_notes WHERE set_id IN (
    SELECT id FROM festival_sets WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  -- Festival child tables
  DELETE FROM festival_sets WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM festival_stages WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM festival_days WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM festival_profiles WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM calendar_tokens WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM notification_counts WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  DELETE FROM notification_topic_subs WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  -- Crew child tables for crews belonging to deleted festivals
  DELETE FROM crew_poll_votes WHERE poll_id IN (
    SELECT id FROM crew_polls WHERE crew_id IN (
      SELECT id FROM crews WHERE festival_id IN (
        SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
      )
    )
  );
  DELETE FROM crew_polls WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crew_meeting_points WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crew_expenses WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crew_activity WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crew_members WHERE crew_id IN (
    SELECT id FROM crews WHERE festival_id IN (
      SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
    )
  );
  DELETE FROM crews WHERE festival_id IN (
    SELECT id FROM festivals WHERE deleted_at < now() - interval '90 days'
  );
  -- Finally delete the festival rows themselves
  DELETE FROM festivals WHERE deleted_at < now() - interval '90 days';

  -- Purge soft-deleted users older than 30 days
  -- Mirror users.hardDelete(): all child rows under FK RESTRICT
  DELETE FROM set_ratings WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM notification_topic_subs WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM notification_preferences WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM notification_log WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM notification_counts WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM device_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM calendar_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM festival_profiles WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_poll_votes WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_polls WHERE created_by IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_meeting_points WHERE created_by IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_members WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_member_status WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_packing_items WHERE created_by IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_ride_offers WHERE created_by IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  UPDATE crew_expenses SET paid_by = 'deleted-user' WHERE paid_by IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM crew_activity WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM login_failures WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM email_verification_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM password_reset_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM refresh_tokens WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM user_sessions WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM user_roles WHERE user_id IN (
    SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
  );

  -- Crews created by a purged user (crews.created_by is ON DELETE RESTRICT since
  -- migration 031). Transfer ownership to the longest-standing member who is NOT
  -- also being purged in this batch; delete the crew only if no such member
  -- exists. Without this the DELETE FROM users below aborts on the FK.
  DECLARE
    _crew_id TEXT;
    _heir TEXT;
  BEGIN
    FOR _crew_id IN
      SELECT id FROM crews WHERE created_by IN (
        SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
      )
    LOOP
      SELECT user_id INTO _heir
      FROM crew_members
      WHERE crew_id = _crew_id
        AND user_id NOT IN (
          SELECT id FROM users WHERE deleted_at < now() - interval '30 days'
        )
      ORDER BY joined_at ASC
      LIMIT 1;

      IF _heir IS NOT NULL THEN
        UPDATE crews SET created_by = _heir, updated_at = NOW() WHERE id = _crew_id;
        UPDATE crew_members SET role = 'owner' WHERE crew_id = _crew_id AND user_id = _heir;
      ELSE
        DELETE FROM crews WHERE id = _crew_id;
      END IF;
    END LOOP;
  END;

  -- Finally delete the user rows themselves
  DELETE FROM users WHERE deleted_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;
