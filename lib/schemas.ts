// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Zod Validation Schemas for All API Endpoints
 *
 * Usage:
 *   const validation = schemas.registerSchema.safeParse(req.body);
 *   if (!validation.success) return sendError(res, 400, validation.error.message);
 *
 * Coverage:
 *   - Authentication (register, login, password change, admin)
 *   - Profiles (picks, notes, reminders, live status)
 *   - Notifications (push tokens, preferences, marks)
 *   - Festivals (creation via routes/festivals.js)
 *   - Socket events (validated in routes/socket.js)
 *   - Crews (create, update, join, transfer operations)
 *
 * Validation flow: Express route → schema.safeParse() → sendError() or processData()
 *
 * NOTE: Inline validation in routes (checks for length, type, range) should use
 * schema validation instead. Patterns to consolidate in future:
 *   • Array.isArray() + length checks → zod.array()
 *   • String length checks → z.string().min().max()
 *   • Regex patterns → z.string().regex()
 *   • Numeric bounds → z.number().min().max()
 * This keeps validation rules centralized and ensures consistency.
 */

import { sanitizeLinkRecord } from './helpers';
import { changePasswordSchema, loginSchema, oauthCompleteSchema, oauthProviderParams, oauthSignInSchema, registerSchema, setPasswordSchema } from './schemas/auth';
import { joinFestivalSchema, profileUpdateSchema } from './schemas/profile';
import { accountDeleteSchema, deleteTokenSchema, displayNameChangeSchema, forgotPasswordSchema, markReadSchema, notificationPrefsSchema, paymentHandlesSchema, publicScheduleSchema, pushTokenSchema, reauthSchema, resetPasswordPublicSchema, resetPasswordSchema, topicSubscriptionSchema, updateEmailSchema, usernameChangeSchema } from './schemas/account';
import { festivalAnnouncementSchema, festivalCreateSchema, festivalMapConfigSchema, festivalUpdateSchema, timeReleaseSendSchema } from './schemas/festival';
import { organizationCreateSchema, organizationFestivalParams, organizationIdParams, organizationListQuery, organizationMemberAddSchema, organizationMemberParams, organizationMemberRoleSchema, organizationPendingParams, organizationProfileSchema, organizationStatusSchema, organizationTransferSchema, organizationVerifiedSchema, organizerAuditQuery, organizerFestivalCreateSchema, heldAlertParams, publishDeclineSchema } from './schemas/organization';
import { crewAddMemberSchema, crewCreateSchema, crewDaysSchema, crewInviteCodeParams, crewJoinSchema, crewReformSchema, crewTransferSchema, crewUpdateSchema, meetingPointComingSchema, meetingPointCreateSchema, meetingPointUpdateSchema } from './schemas/crew';
import { artistBackfillSchema, artistCreateSchema, artistListQuerySchema, artistMatchSchema, artistMergeSchema, artistSpotifyCandidatesSchema, artistSpotifyPicksSchema, artistSpotifyRefreshSchema, artistSuggestionDecisionSchema, artistSuggestionListQuerySchema, artistUpdateSchema, organizerArtistCreateSchema, organizerArtistListQuerySchema, organizerArtistUpdateSchema, policyNoticeSchema, setLinkSchema, spotifyBackfillSchema } from './schemas/artist';
import { caughtUpdateSchema, checkinStartSchema, crewHomeBaseSchema, crewPhotoAlbumSchema, crewStatusSchema, liveLocationFixSchema, locationShareSchema, locationStopSchema, locationSyncSchema, locationUpdateSchema, packingBatchSchema, packingCreateSchema, packingUpdateSchema, pollCreateSchema, pollVoteSchema, ratingCreateSchema, refreshTokenSchema, rideCreateSchema, rideUpdateSchema, sosClearSchema, sosRaiseSchema, sosSeenSchema, wrapQuery } from './schemas/crew-activity';
import { expenseConfirmSchema, expenseCreateSchema, expenseCurrencySchema, expenseRemindSchema } from './schemas/expenses';
import { adminAddRoleSchema, adminAnalyticsQuery, adminAuditQuery, adminBulkArchiveSchema, adminBulkDeactivateSchema, adminRefCountsQuery, adminUserSearchQuery, crewListQuery, crewUserSearchQuery, expenseSettleFullSchema, festivalDeleteQuery, festivalDepthQuery, paginationQuery } from './schemas/query';
import { alsoPickedParams, crewIdExpenseIdParams, crewIdFestivalIdParams, crewIdItemIdParams, crewIdMpIdParams, crewIdParams, crewIdPollIdParams, crewIdUserIdParams, festivalIdParams, genericIdParams, idRoleParams, idUserIdParams, profileIdParams, setIdParams } from './schemas/params';

export { sanitizeLinkRecord };
export { registerSchema, loginSchema } from './schemas/auth';
export { pushTokenSchema, displayNameChangeSchema, paymentHandlesSchema, publicScheduleSchema, accountDeleteSchema, updateEmailSchema } from './schemas/account';
export { festivalMapConfigSchema, lineupImportRequestSchema, festivalAnnouncementSchema, timeReleaseSendSchema } from './schemas/festival';
export type { LineupImportRowInput } from './schemas/festival';
export { crewCreateSchema, crewUpdateSchema, crewInviteCodeParams, meetingPointCreateSchema, meetingPointUpdateSchema, meetingPointComingSchema, crewDaysSchema } from './schemas/crew';
export { artistBackfillSchema, policyNoticeSchema, spotifyBackfillSchema } from './schemas/artist';
export { installEventSchema, clientPerfBeaconSchema, webVitalsBeaconSchema } from './schemas/beacons';
export { validate, validateQuery, validateParams } from './schemas/middleware';
export { artistDisplayName, normalizeSetArtists, resolveSetArtists, normalizePickPayload, normalizeNotePayload, normalizeReminderPayload, sanitizeFestivalPayload } from './schemas/payload-normalizers';
export { crewHomeBaseSchema, crewPhotoAlbumSchema, liveLocationFixSchema, sosRaiseSchema, sosClearSchema, sosSeenSchema, checkinStartSchema, refreshTokenSchema, caughtUpdateSchema, wrapQuery } from './schemas/crew-activity';
export { CREW_CURRENCIES } from './schemas/expenses';
export { adminBulkDeactivateSchema, paginationQuery, adminAuditQuery, adminAnalyticsQuery, adminRefCountsQuery, festivalDepthQuery } from './schemas/query';
export { crewIdParams, crewIdMpIdParams, crewIdUserIdParams, festivalIdParams } from './schemas/params';

// ════════════════════════════════════════════════════════════════════════════════
// Bundled schemas export (preserves the original `schemas` namespace for
// consumers that import as `const { schemas } = require('./schemas')`)
// ════════════════════════════════════════════════════════════════════════════════

export const schemas = {
  register: registerSchema,
  login: loginSchema,
  changePassword: changePasswordSchema,
  profileUpdate: profileUpdateSchema,
  joinFestival: joinFestivalSchema,
  resetPassword: resetPasswordSchema,
  resetPasswordPublic: resetPasswordPublicSchema,
  notificationPrefs: notificationPrefsSchema,
  pushToken: pushTokenSchema,
  deleteToken: deleteTokenSchema,
  markRead: markReadSchema,
  usernameChange: usernameChangeSchema,
  displayNameChange: displayNameChangeSchema,
  paymentHandles: paymentHandlesSchema,
  publicSchedule: publicScheduleSchema,
  accountDelete: accountDeleteSchema,
  reauth: reauthSchema,
  oauthSignIn: oauthSignInSchema,
  oauthComplete: oauthCompleteSchema,
  oauthProviderParams,
  setPassword: setPasswordSchema,
  topicSubscription: topicSubscriptionSchema,
  festivalCreate: festivalCreateSchema,
  festivalUpdate: festivalUpdateSchema,
  organizerFestivalCreate: organizerFestivalCreateSchema,
  publishDecline: publishDeclineSchema,
  heldAlertParams,
  organizationCreate: organizationCreateSchema,
  organizationList: organizationListQuery,
  organizationStatus: organizationStatusSchema,
  organizationTransfer: organizationTransferSchema,
  organizationVerified: organizationVerifiedSchema,
  organizationMemberAdd: organizationMemberAddSchema,
  organizationMemberRole: organizationMemberRoleSchema,
  organizationProfile: organizationProfileSchema,
  organizerAuditQuery,
  organizationIdParams,
  organizationFestivalParams,
  organizationMemberParams,
  organizationPendingParams,
  festivalMapConfig: festivalMapConfigSchema,
  crewCreate: crewCreateSchema,
  crewUpdate: crewUpdateSchema,
  crewJoin: crewJoinSchema,
  crewInviteCodeParams,
  crewReform: crewReformSchema,
  crewTransfer: crewTransferSchema,
  crewAddMember: crewAddMemberSchema,
  setLink: setLinkSchema,
  artistMatch: artistMatchSchema,
  artistCreate: artistCreateSchema,
  artistUpdate: artistUpdateSchema,
  artistMerge: artistMergeSchema,
  artistBackfill: artistBackfillSchema,
  policyNotice: policyNoticeSchema,
  artistListQuery: artistListQuerySchema,
  artistSuggestionListQuery: artistSuggestionListQuerySchema,
  artistSuggestionDecision: artistSuggestionDecisionSchema,
  organizerArtistCreate: organizerArtistCreateSchema,
  organizerArtistUpdate: organizerArtistUpdateSchema,
  organizerArtistListQuery: organizerArtistListQuerySchema,
  artistSpotifyCandidates: artistSpotifyCandidatesSchema,
  artistSpotifyPicks: artistSpotifyPicksSchema,
  artistSpotifyRefresh: artistSpotifyRefreshSchema,
  spotifyBackfill: spotifyBackfillSchema,
  festivalAnnouncement: festivalAnnouncementSchema,
  timeReleaseSend: timeReleaseSendSchema,
  crewHomeBase: crewHomeBaseSchema,
  crewPhotoAlbum: crewPhotoAlbumSchema,
  meetingPointCreate: meetingPointCreateSchema,
  meetingPointUpdate: meetingPointUpdateSchema,
  meetingPointComing: meetingPointComingSchema,
  crewDays: crewDaysSchema,
  pollCreate: pollCreateSchema,
  pollVote: pollVoteSchema,
  packingCreate: packingCreateSchema,
  packingUpdate: packingUpdateSchema,
  packingBatch: packingBatchSchema,
  crewStatus: crewStatusSchema,
  locationShare: locationShareSchema,
  locationUpdate: locationUpdateSchema,
  locationStop: locationStopSchema,
  liveLocationFix: liveLocationFixSchema,
  locationSync: locationSyncSchema,
  sosRaise: sosRaiseSchema,
  sosClear: sosClearSchema,
  sosSeen: sosSeenSchema,
  checkinStart: checkinStartSchema,
  rideCreate: rideCreateSchema,
  rideUpdate: rideUpdateSchema,
  forgotPassword: forgotPasswordSchema,
  updateEmail: updateEmailSchema,
  refreshToken: refreshTokenSchema,
  ratingCreate: ratingCreateSchema,
  caughtUpdate: caughtUpdateSchema,
  wrapQuery,
  expenseCreate: expenseCreateSchema,
  // PUT is a full replacement: the edit form sends every field, so it reuses the
  // create schema (one validation path, last-write-wins offline replay).
  expenseUpdate: expenseCreateSchema,
  expenseCurrency: expenseCurrencySchema,
  expenseConfirm: expenseConfirmSchema,
  expenseRemind: expenseRemindSchema,
  adminBulkDeactivate: adminBulkDeactivateSchema,
  adminBulkArchive: adminBulkArchiveSchema,
  adminAddRole: adminAddRoleSchema,
  paginationQuery,
  adminAuditQuery,
  adminAnalyticsQuery,
  adminRefCountsQuery,
  adminUserSearchQuery,
  festivalDepthQuery,
  festivalDeleteQuery,
  crewUserSearchQuery,
  crewListQuery,
  expenseSettleFull: expenseSettleFullSchema,
  crewIdParams,
  crewIdExpenseIdParams,
  crewIdPollIdParams,
  crewIdMpIdParams,
  crewIdUserIdParams,
  crewIdItemIdParams,
  setIdParams,
  crewIdFestivalIdParams,
  festivalIdParams,
  genericIdParams,
  idUserIdParams,
  idRoleParams,
  alsoPickedParams,
  profileIdParams,
};
