-- Row-count sidecar for backup-pg.sh: one row per table, "name|count|newest write".
-- Run with: psql -X -A -t -F '|' -v ON_ERROR_STOP=1 -f scripts/sql/backup-counts.sql
-- The drill (scripts/backup-restore-drill.sh) compares a restored copy with these rows.
-- Tables without a write-time column report count only (empty third field).
-- GREATEST ignores NULLs in Postgres. Counts and timestamps only, no PII.
SELECT 'users' AS table_name, count(*) AS row_count, max(GREATEST(created_at, updated_at)) AS newest_write FROM users
UNION ALL SELECT 'festivals', count(*), max(GREATEST(created_at, updated_at)) FROM festivals
UNION ALL SELECT 'festival_sets', count(*), NULL FROM festival_sets
UNION ALL SELECT 'crews', count(*), max(GREATEST(created_at, updated_at)) FROM crews
UNION ALL SELECT 'crew_members', count(*), max(joined_at) FROM crew_members
UNION ALL SELECT 'festival_profiles', count(*), max(GREATEST(created_at, updated_at)) FROM festival_profiles
UNION ALL SELECT 'festival_profile_picks', count(*), NULL FROM festival_profile_picks
UNION ALL SELECT 'festival_profile_notes', count(*), NULL FROM festival_profile_notes
UNION ALL SELECT 'crew_expenses', count(*), max(GREATEST(created_at, updated_at)) FROM crew_expenses
UNION ALL SELECT 'festival_announcements', count(*), max(created_at) FROM festival_announcements;
