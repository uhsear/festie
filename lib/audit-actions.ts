// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Audit action names, written as `subject.object.verb_past`.
 * The display labels live in packages/shared/src/utils/auditActions.ts, because the
 * backend cannot import @festie/shared at run time. tests/audit-actions.test.ts keeps
 * the two lists in step and checks that migrations/082_audit_action_names.sql renames
 * every legacy value.
 */

export const AUDIT_ACTIONS = {
  FESTIVAL_CREATED: 'festival.created',
  FESTIVAL_UPDATED: 'festival.updated',
  FESTIVAL_DELETED: 'festival.deleted',
  FESTIVAL_PURGED: 'festival.purged',
  FESTIVAL_ARCHIVED: 'festival.archived',
  FESTIVAL_PUBLISHED: 'festival.published',
  FESTIVAL_RESTORED: 'festival.restored',
  FESTIVAL_SITEPLAN_UPLOADED: 'festival.siteplan.uploaded',
  FESTIVAL_ANNOUNCEMENT_SENT: 'festival.announcement.sent',
  FESTIVAL_ANNOUNCEMENT_CANCELLED: 'festival.announcement.cancelled',
  LINEUP_IMPORTED: 'festival.lineup.imported',
  LINEUP_IMPORT_UNDONE: 'festival.lineup.import_undone',
  LINEUP_ANNOUNCED: 'festival.lineup.announced',
  SPOTIFY_BACKFILLED: 'festival.spotify.backfilled',
  SET_LINK_UPDATED: 'set.link.updated',
  USER_ROLE_GRANTED: 'user.role.granted',
  USER_ROLE_REVOKED: 'user.role.revoked',
  USER_RESET_LINK_CREATED: 'user.password_reset_link.created',
  USER_PASSWORD_RESET: 'user.password.reset',
  USER_DELETED: 'user.deleted',
  USER_SESSIONS_REVOKED: 'user.sessions.revoked',
  USER_PRIVATE_DATA_VIEWED: 'user.private_data.viewed',
  CREW_MEMBER_ADDED: 'crew.member.added',
  CREW_MEMBER_REMOVED: 'crew.member.removed',
  CREW_DELETED: 'crew.deleted',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

// Old value written before the rename, mapped to its dotted value.
export const LEGACY_AUDIT_ACTIONS: Record<string, string> = {
  'festival:create': AUDIT_ACTIONS.FESTIVAL_CREATED,
  'festival:update': AUDIT_ACTIONS.FESTIVAL_UPDATED,
  'festival:soft-delete': AUDIT_ACTIONS.FESTIVAL_DELETED,
  'festival:hard-delete': AUDIT_ACTIONS.FESTIVAL_PURGED,
  bulk_archive: AUDIT_ACTIONS.FESTIVAL_ARCHIVED,
  'festival:publish': AUDIT_ACTIONS.FESTIVAL_PUBLISHED,
  'festival:restore': AUDIT_ACTIONS.FESTIVAL_RESTORED,
  'festival:siteplan-upload': AUDIT_ACTIONS.FESTIVAL_SITEPLAN_UPLOADED,
  festival_announcement_send: AUDIT_ACTIONS.FESTIVAL_ANNOUNCEMENT_SENT,
  festival_announcement_cancel: AUDIT_ACTIONS.FESTIVAL_ANNOUNCEMENT_CANCELLED,
  lineup_import: AUDIT_ACTIONS.LINEUP_IMPORTED,
  lineup_import_undo: AUDIT_ACTIONS.LINEUP_IMPORT_UNDONE,
  lineup_announce: AUDIT_ACTIONS.LINEUP_ANNOUNCED,
  spotify_backfill: AUDIT_ACTIONS.SPOTIFY_BACKFILLED,
  'set:link-update': AUDIT_ACTIONS.SET_LINK_UPDATED,
  role_grant: AUDIT_ACTIONS.USER_ROLE_GRANTED,
  role_revoke: AUDIT_ACTIONS.USER_ROLE_REVOKED,
  admin_reset_link: AUDIT_ACTIONS.USER_RESET_LINK_CREATED,
  admin_reset_password: AUDIT_ACTIONS.USER_PASSWORD_RESET,
  admin_delete_user: AUDIT_ACTIONS.USER_DELETED,
  force_logout: AUDIT_ACTIONS.USER_SESSIONS_REVOKED,
  crew_add_member: AUDIT_ACTIONS.CREW_MEMBER_ADDED,
  crew_remove_member: AUDIT_ACTIONS.CREW_MEMBER_REMOVED,
  crew_delete: AUDIT_ACTIONS.CREW_DELETED,
};

const PAST_TENSE: Record<string, string> = {
  POST: 'created',
  PUT: 'replaced',
  PATCH: 'updated',
  DELETE: 'deleted',
};

// Name for a row the generic audit middleware writes: `crews.created`.
export function genericAuditAction(method: string, resource: string): string {
  const verb = PAST_TENSE[method.toUpperCase()] ?? method.toLowerCase();
  return `${resource}.${verb}`.toLowerCase();
}
