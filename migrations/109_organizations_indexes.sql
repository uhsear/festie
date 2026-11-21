-- 109_organizations_indexes.sql
-- Indexes for the organizer platform tables from 108.
--   organization_members(user_id)   the membership lookup on every manage request
--   organization_pending_members    the claim by email in GET /manage/me
--   festivals(organization_id)      the organization's festival list
--   audit_log(organization_id, ...) the per-organization audit filter
--   festival_announcements(organization_id, ...) the organization's daily announcement cap
-- CONCURRENTLY cannot run in a transaction, so this file has no BEGIN/COMMIT.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_members_user
  ON organization_members (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_pending_email
  ON organization_pending_members (email);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_festivals_org
  ON festivals (organization_id) WHERE organization_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_org
  ON audit_log (organization_id, created_at) WHERE organization_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_festival_announcements_org
  ON festival_announcements (organization_id, created_at) WHERE organization_id IS NOT NULL;
