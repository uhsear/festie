-- Rename audit actions to the dotted names in lib/audit-actions.ts.
-- Idempotent: each statement matches only old names.
UPDATE audit_log SET action = CASE action
  WHEN 'festival:create' THEN 'festival.created'
  WHEN 'festival:update' THEN 'festival.updated'
  WHEN 'festival:soft-delete' THEN 'festival.deleted'
  WHEN 'festival:hard-delete' THEN 'festival.purged'
  WHEN 'bulk_archive' THEN 'festival.archived'
  WHEN 'festival:publish' THEN 'festival.published'
  WHEN 'festival:restore' THEN 'festival.restored'
  WHEN 'festival:siteplan-upload' THEN 'festival.siteplan.uploaded'
  WHEN 'festival_announcement_send' THEN 'festival.announcement.sent'
  WHEN 'festival_announcement_cancel' THEN 'festival.announcement.cancelled'
  WHEN 'lineup_import' THEN 'festival.lineup.imported'
  WHEN 'lineup_import_undo' THEN 'festival.lineup.import_undone'
  WHEN 'lineup_announce' THEN 'festival.lineup.announced'
  WHEN 'spotify_backfill' THEN 'festival.spotify.backfilled'
  WHEN 'set:link-update' THEN 'set.link.updated'
  WHEN 'role_grant' THEN 'user.role.granted'
  WHEN 'role_revoke' THEN 'user.role.revoked'
  WHEN 'admin_reset_link' THEN 'user.password_reset_link.created'
  WHEN 'admin_reset_password' THEN 'user.password.reset'
  WHEN 'admin_delete_user' THEN 'user.deleted'
  WHEN 'force_logout' THEN 'user.sessions.revoked'
  WHEN 'crew_add_member' THEN 'crew.member.added'
  WHEN 'crew_remove_member' THEN 'crew.member.removed'
  WHEN 'crew_delete' THEN 'crew.deleted'
END
WHERE action IN (
  'festival:create','festival:update','festival:soft-delete','festival:hard-delete',
  'bulk_archive','festival:publish','festival:restore','festival:siteplan-upload',
  'festival_announcement_send','festival_announcement_cancel','lineup_import',
  'lineup_import_undo','lineup_announce','spotify_backfill','set:link-update',
  'role_grant','role_revoke','admin_reset_link','admin_reset_password',
  'admin_delete_user','force_logout','crew_add_member','crew_remove_member','crew_delete'
);

-- Generic middleware rows: 'create:crews' becomes 'crews.created'.
UPDATE audit_log
SET action = split_part(action, ':', 2) || '.' || CASE split_part(action, ':', 1)
  WHEN 'create' THEN 'created'
  WHEN 'replace' THEN 'replaced'
  WHEN 'update' THEN 'updated'
  WHEN 'delete' THEN 'deleted'
END
WHERE action ~ '^(create|replace|update|delete):[a-z0-9_-]+$';
