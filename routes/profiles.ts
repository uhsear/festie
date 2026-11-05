// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { paginateArray } from '../lib/pagination.js';
import { ensureFestivalProfile } from '../lib/festival-profile.js';

export default function createProfilesRoutes(deps: any) {
  const {
    express, log,
    userAuth, adminAuth, setNoStore,
    sanitizeIdentifier, getFestivalById, getProfiles, getUserMap, getUserById,
    normalizePickPayload, normalizeNotePayload, normalizeReminderPayload,
    serializeProfileForViewer, serializeOwnProfile,
    _buildAvatarUrl,
    sendSuccess, sendError, ErrorCodes,
    rateLimit,
    removeProfileSockets,
    io, emitter,
    schemas, validate, validateParams, validateQuery,
    stores,
  } = deps;

  const router = express.Router();

  router.get('/:festivalId', userAuth, validateParams(schemas.festivalIdParams), validateQuery(schemas.paginationQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = req.validatedParams.festivalId;
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      const { getUserFestivalProfile } = deps;
      const ownProfile = await getUserFestivalProfile(req.user.userId, festivalId);
      if (!ownProfile) {
        // Not joined is not an error: an empty list keeps the client console quiet.
        return sendSuccess(res, [], { pickCounts: {} });
      }
      // listPicksByFestival leaves out notes and reminders, so the viewer's own row
      // comes from ownProfile. A row missing from the list (a delete race) stays missing.
      const rawProfiles = stores.profiles.listPicksByFestival
        ? (await stores.profiles.listPicksByFestival(festivalId)).map((profile: any) =>
          profile.id === ownProfile.id ? ownProfile : profile)
        : stores.profiles.getByFestival
          ? await stores.profiles.getByFestival(festivalId)
          : (await getProfiles()).filter((profile: any) => profile.festivalId === festivalId);
      const userIds = [...new Set(rawProfiles.map((p: any) => p.userId).filter(Boolean))];
      const usersById = stores.users.getByIds
        ? await stores.users.getByIds(userIds)
        : await getUserMap();
      // Other users' picks go only to people who share a crew with them on this
      // festival. Everyone else gets the profile with empty picks, plus anonymous
      // per-set counts (other attendees, no user ids) in meta.pickCounts.
      const userCrews = await stores.crews.listByUserAndFestival(req.user.userId, festivalId);
      const membersByCrew = await stores.crews.getMembersForCrews(userCrews.map((c: any) => c.id));
      const crewUserIds = new Set<string>();
      for (const members of membersByCrew.values()) {
        for (const m of members) crewUserIds.add(m.userId);
      }
      const pickCounts: Record<string, number> = {};
      for (const profile of rawProfiles) {
        if (profile.userId === req.user.userId) continue;
        for (const setId of Object.keys(profile.picks || {})) pickCounts[setId] = (pickCounts[setId] || 0) + 1;
      }
      const profiles = rawProfiles.map((profile: any) => {
        const visible = profile.userId === req.user.userId || crewUserIds.has(profile.userId);
        return serializeProfileForViewer(visible ? profile : { ...profile, picks: {} }, req.user.userId, usersById.get(profile.userId));
      });
      // Support paginated response when params present
      if (req.query.cursor || req.query.limit) {
        const { limit, cursor } = req.validatedQuery;
        const { items, pagination } = paginateArray(profiles, { limit, cursor });
        return sendSuccess(res, items, { pagination, pickCounts });
      }
      return sendSuccess(res, profiles, { pickCounts });
    } catch (error: any) {
      log.error('profile load failed', { error: error.message, festivalId: req.validatedParams?.festivalId });
      return sendError(res, 500, 'Failed to load profiles', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/', userAuth, rateLimit(10, 'profile-join'), validate(schemas.joinFestival), async (req: any, res: any) => {
    try {
      const festivalId = sanitizeIdentifier(req.validatedBody?.festivalId, 100);
      if (!festivalId) return sendError(res, 400, 'Festival ID required', ErrorCodes.MISSING_FIELD);
      const festival = await getFestivalById(festivalId);
      // A draft (no publishedAt) cannot be joined; it reads as missing, like the public detail route.
      if (!festival?.publishedAt) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      const result = await ensureFestivalProfile(deps, req.user, festivalId);
      if (result.error === 'limit') {
        return sendError(res, 400, 'Maximum profiles reached', ErrorCodes.MAX_LIMIT_REACHED);
      }
      if (result.error === 'user-missing') return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      return sendSuccess(res, serializeOwnProfile(result.profile, result.user));
    } catch (error: any) {
      log.error('profile create failed', { error: error.message });
      return sendError(res, 500, 'Failed to create/join profile', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // PUT and PATCH both accept partial payloads
  async function updateProfile(req: any, res: any) {
    try {
      setNoStore(res);
      const profileId = req.validatedParams.id;
      let nextPicks;
      if (req.validatedBody?.picks !== undefined) {
        const normalized = normalizePickPayload(req.validatedBody.picks);
        if (normalized.error) return sendError(res, 400, normalized.error, ErrorCodes.INVALID_INPUT);
        nextPicks = normalized.value;
      }

      let nextNotes;
      if (req.validatedBody?.notes !== undefined) {
        const normalized = normalizeNotePayload(req.validatedBody.notes);
        if (normalized.error) return sendError(res, 400, normalized.error, ErrorCodes.INVALID_INPUT);
        nextNotes = normalized.value;
        // Validate notes size limits
        if (Object.keys(nextNotes).length > 200) {
          return sendError(res, 400, 'Maximum 200 notes per profile', ErrorCodes.INVALID_INPUT);
        }
        for (const [setId, noteText] of Object.entries(nextNotes)) {
          if (typeof noteText === 'string' && noteText.length > 1000) {
            return sendError(res, 400, `Note text exceeds 1000 character limit for set ${setId}`, ErrorCodes.INVALID_INPUT);
          }
        }
      }

      let nextReminders;
      if (req.validatedBody?.reminders !== undefined) {
        const normalized = normalizeReminderPayload(req.validatedBody.reminders);
        if (normalized.error) return sendError(res, 400, normalized.error, ErrorCodes.INVALID_INPUT);
        nextReminders = normalized.value;
        // Validate reminders size limits
        if (Object.keys(nextReminders).length > 200) {
          return sendError(res, 400, 'Maximum 200 reminders per profile', ErrorCodes.INVALID_INPUT);
        }
        for (const [setId, reminderValue] of Object.entries(nextReminders)) {
          if (typeof reminderValue !== 'number' || reminderValue < 1) {
            return sendError(res, 400, `Reminder for set ${setId} must be a positive integer`, ErrorCodes.INVALID_INPUT);
          }
        }
      }

      // Optional optimistic concurrency: If-Match header contains expected updatedAt
      const ifMatch = req.headers['if-match'];

      // Fetch profile and festival data
      // Use direct lookup instead of full scan
      const currentProfile = stores.profiles.getById
        ? await stores.profiles.getById(profileId)
        : (await getProfiles()).find((p: any) => p.id === profileId);
      if (!currentProfile) return sendError(res, 404, 'Profile not found', ErrorCodes.NOT_FOUND);
      if (currentProfile.userId !== req.user.userId) {
        return sendError(res, 403, 'Not your profile', ErrorCodes.FORBIDDEN);
      }
      // Conflict detection: reject if client's version doesn't match
      if (ifMatch && currentProfile.updatedAt && ifMatch !== `"${currentProfile.updatedAt}"`) {
        const user = await getUserById(currentProfile.userId) || null;
        return sendError(res, 409, 'Profile was modified since your last fetch', ErrorCodes.VERSION_MISMATCH, {
          current: serializeOwnProfile(currentProfile, user),
        });
      }

      const festival = await getFestivalById(currentProfile.festivalId);
      const validSetIds = new Set((festival?.days || []).flatMap((day: any) => (day.sets || []).map((set: any) => set.id)));
      const _validStageIds = new Set((festival?.stages || []).map((stage: any) => stage.id));

      // Validate set references
      if (nextPicks !== undefined && Object.keys(nextPicks).some((setId) => !validSetIds.has(setId))) {
        return sendError(res, 400, 'Pick references an unknown set', ErrorCodes.INVALID_INPUT);
      }
      if (nextNotes !== undefined && Object.keys(nextNotes).some((key) => !validSetIds.has(key.startsWith('crew:') ? key.slice(5) : key))) {
        return sendError(res, 400, 'Note references an unknown set', ErrorCodes.INVALID_INPUT);
      }
      // Drop reminders for sets removed from the lineup; rejecting would make every later save fail.
      if (nextReminders !== undefined) {
        nextReminders = Object.fromEntries(Object.entries(nextReminders).filter(([setId]) => validSetIds.has(setId)));
      }

      // Build update fields
      const updateFields: any = {};
      if (nextPicks !== undefined) updateFields.picks = nextPicks;
      if (nextNotes !== undefined) updateFields.notes = nextNotes;
      if (nextReminders !== undefined) updateFields.reminders = nextReminders;

      // Update profile
      const profile = await stores.profiles.update(profileId, updateFields);
      if (!profile) return sendError(res, 500, 'Failed to update profile', ErrorCodes.INTERNAL_ERROR);

      log.info('profile:updated', { profileId, userId: req.user.userId, fields: Object.keys(updateFields) });
      emitter.profileUpdated({
        profile,
        user: await getUserById(profile.userId),
        changedFields: { picks: nextPicks !== undefined },
      });

      // Set ETag for optimistic concurrency on subsequent updates
      if (profile.updatedAt) res.setHeader('ETag', `"${profile.updatedAt}"`);
      return sendSuccess(res, serializeOwnProfile(profile, await getUserById(profile.userId)));
    } catch (error: any) {
      log.error('profile update failed', { error: error.message, profileId: req.validatedParams?.id });
      return sendError(res, 500, 'Failed to update profile', ErrorCodes.INTERNAL_ERROR);
    }
  }
  // Support both PUT and PATCH for compatibility with different HTTP clients. Both treat payloads as partial updates (merge semantics).
  router.put('/:id', userAuth, rateLimit(30, 'profile-update'), validateParams(schemas.profileIdParams), validate(schemas.profileUpdate), updateProfile);
  router.patch('/:id', userAuth, rateLimit(30, 'profile-update'), validateParams(schemas.profileIdParams), validate(schemas.profileUpdate), updateProfile);

  router.delete('/:id', adminAuth, rateLimit(5, 'profile-delete'), validateParams(schemas.profileIdParams), async (req: any, res: any) => {
    try {
      const profile = await stores.profiles.delete(req.validatedParams.id);

      if (!profile) return sendError(res, 404, 'Profile not found', ErrorCodes.NOT_FOUND);
      log.info('profile:deleted', { profileId: profile.id, festivalId: profile.festivalId, userId: profile.userId });
      removeProfileSockets(profile, io);
      emitter.profileDeleted({ festivalId: profile.festivalId, profileId: profile.id });
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      log.error('profile delete failed', { error: error.message, profileId: req.validatedParams?.id });
      return sendError(res, 500, 'Failed to delete profile', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
