-- Admin audit view filters on actor_type and pages by (created_at, id).
-- Old web-vitals rows are typed 'system'; the admin view hides them and the
-- 90-day retention removes them, so there is no data migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_actor_type_created ON audit_log (actor_type, created_at DESC, id DESC);
