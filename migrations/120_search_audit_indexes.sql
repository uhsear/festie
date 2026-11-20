-- 120_search_audit_indexes.sql
-- Three queries had no index that could serve them:
--   artists.list search     name_key LIKE '%key%' (leading wildcard, a plain btree cannot help)
--   users.findDeletedByEmail LOWER(email) = $1 AND deleted_at IS NOT NULL (idx_users_email only holds live rows)
--   audit.listForUser       target_id = $1 and the crew_member split_part(target_id, ':', 2) = $1 branch
-- findDeletedByUsername already uses the unique index on the citext username column.
--
-- pg_trgm is a trusted extension, so the database owner can create it.
-- CONCURRENTLY cannot run in a transaction, so this file has no BEGIN/COMMIT.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_artists_name_key_trgm
  ON artists USING gin (name_key gin_trgm_ops) WHERE merged_into IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_deleted_email
  ON users (LOWER(email)) WHERE email IS NOT NULL AND deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_target_id
  ON audit_log (target_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_crew_member_user
  ON audit_log ((split_part(target_id, ':', 2))) WHERE target_type = 'crew_member';
