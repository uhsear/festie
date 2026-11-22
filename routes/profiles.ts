// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { paginateArray } from '../lib/pagination.js';
import { ensureFestivalProfile } from '../lib/festival-profile.js';
import { coverLineup } from '../lib/lineup.js';
import type { RouteDeps } from '../lib/types';

export default function createProfilesRoutes(deps: RouteDeps) {
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
      // Only the viewer and the people who share a crew with them on this festival are
      // listed. Everyone else stays out of the response (no attendee directory); they
      // reach the viewer only as anonymous per-set counts in meta.pickCounts.
      const userCrews = await stores.crews.listByUserAndFestival(req.user.userId, festivalId);
      const membersByCrew = await stores.crews.getMembersForCrews(userCrews.map((c: any) => c.id));
      const visibleUserIds = new Set<string>([req.user.userId]);
      for (const members of membersByCrew.values()) {
        for (const m of members) visibleUserIds.add(m.userId);
      }
      // listPicksByFestival leaves out notes and reminders, so the viewer's own row
      // comes from ownProfile. A row missing from the list (a delete race) stays missing.
      const paginated = Boolean(req.query.cursor || req.query.limit);
      // The paged read slices in SQL, so a large festival costs one page of rows, not all of them.
      const page = paginated && stores.profiles.listPicksPageByFestival
        ? await stores.profiles.listPicksPageByFestival(festivalId, { ...req.validatedQuery, userIds: [...visibleUserIds] })
        : null;
      const swapOwn = (profile: any) => (profile.id === ownProfile.id ? ownProfile : profile);
      const rawProfiles = page
        ? page.profiles.map(swapOwn)
        : stores.profiles.listPicksByFestival
          ? (await stores.profiles.listPicksByFestival(festivalId)).map(swapOwn)
          : stores.profiles.getByFestival
            ? await stores.profiles.getByFestival(festivalId)
            : (await getProfiles()).filter((profile: any) => profile.festivalId === festivalId);
      // Counts cover every other attendee, so take them before the list narrows to the visible users.
      let pickCounts: Record<string, number> = {};
      if (page) {
        pickCounts = await stores.profiles.pickCountsByFestival(festivalId, req.user.userId);
      } else {
        for (const profile of rawProfiles) {
          if (profile.userId === req.user.userId) continue;
          for (const setId of Object.keys(profile.picks || {})) pickCounts[setId] = (pickCounts[setId] || 0) + 1;
        }
      }
      const visibleProfiles = rawProfiles.filter((p: any) => visibleUserIds.has(p.userId));
      const userIds = [...new Set(visibleProfiles.map((p: any) => p.userId).filter(Boolean))];
      const usersById = stores.users.getByIds
        ? await stores.users.getByIds(userIds)
        : await getUserMap();
      const profiles = visibleProfiles.map((profile: any) =>
        serializeProfileForViewer(profile, req.user.userId, usersById.get(profile.userId)),
      );
      // Support paginated response when params present
      if (page) return sendSuccess(res, profiles, { pagination: page.pagination, pickCounts });
      if (paginated) {
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
      if (result.error === 'festival-unavailable') return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
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

  async function sendVersionConflict(res: any, current: any) {
    const user = (await getUserById(current.userId)) || null;
    return sendError(res, 409, 'Profile was modified since your last fetch', ErrorCodes.VERSION_MISMATCH, {
      current: serializeOwnProfile(current, user),
    });
  }

  // PUT and PATCH both accept partial payloads. `picks` replaces the whole map (old app builds
  // still send it); `pickDeltas` changes only the sets it names, so a replayed offline write
  // cannot clobber picks it never saw. A client that wants conflict detection sends If-Match.
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

      // Deltas: { setId: priority | null }, null removing the pick. Every key runs through the
      // same checks and cap as a full map; a removal rides through as a placeholder priority.
      let pickDeltas;
      if (req.validatedBody?.pickDeltas !== undefined) {
        const requested = req.validatedBody.pickDeltas;
        const normalized = normalizePickPayload(
          Object.fromEntries(Object.entries(requested).map(([setId, priority]) => [setId, priority ?? 'maybe'])),
        );
        if (normalized.error) return sendError(res, 400, normalized.error, ErrorCodes.INVALID_INPUT);
        const removals = Object.keys(normalized.value).filter((setId) => requested[setId] === null);
        const additions = Object.fromEntries(Object.entries(normalized.value).filter(([setId]) => requested[setId] !== null));
        pickDeltas = { set: additions, remove: removals };
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
      // This early check only saves work; the store repeats it under the row lock.
      if (ifMatch && currentProfile.updatedAt && ifMatch !== `"${currentProfile.updatedAt}"`) {
        return sendVersionConflict(res, currentProfile);
      }

      const festival = await getFestivalById(currentProfile.festivalId);
      const validSetIds = new Set((festival?.days || []).flatMap((day: any) => (day.sets || []).map((set: any) => set.id)));
      const _validStageIds = new Set((festival?.stages || []).map((stage: any) => stage.id));

      // Validate set references
      if (nextPicks !== undefined && Object.keys(nextPicks).some((setId) => !validSetIds.has(setId))) {
        return sendError(res, 400, 'Pick references an unknown set', ErrorCodes.INVALID_INPUT);
      }
      // Removals skip this check: clearing a pick for a set that left the lineup is a harmless no-op.
      if (pickDeltas && Object.keys(pickDeltas.set).some((setId) => !validSetIds.has(setId))) {
        return sendError(res, 400, 'Pick references an unknown set', ErrorCodes.INVALID_INPUT);
      }
      if (nextNotes !== undefined && Object.keys(nextNotes).some((key) => !validSetIds.has(key.startsWith('crew:') ? key.slice(5) : key))) {
        return sendError(res, 400, 'Note references an unknown set', ErrorCodes.INVALID_INPUT);
      }
      // Drop reminders for sets removed from the lineup; rejecting would make every later save fail.
      if (nextReminders !== undefined) {
        nextReminders = Object.fromEntries(Object.entries(nextReminders).filter(([setId]) => validSetIds.has(setId)));
      }

      // Interest marks are deltas. Ids outside the festival's lineup are dropped, like reminders: a lineup
      // entry that was removed must not break every later save.
      const lineupIds = new Set((festival?.lineup || []).map((entry: any) => entry.id));
      const interestIds = (ids: string[] | undefined) =>
        ids === undefined ? undefined : [...new Set(ids)].filter((id) => lineupIds.has(id));
      const interestAdd = interestIds(req.validatedBody?.interestAdd);
      const interestRemove = interestIds(req.validatedBody?.interestRemove);

      // Build update fields
      const updateFields: any = {};
      if (nextPicks !== undefined) updateFields.picks = nextPicks;
      if (pickDeltas) updateFields.pickDeltas = pickDeltas;
      if (nextPicks !== undefined && req.validatedBody?.pickRemove) updateFields.pickRemove = req.validatedBody.pickRemove;
      if (nextNotes !== undefined) updateFields.notes = nextNotes;
      if (nextReminders !== undefined) updateFields.reminders = nextReminders;
      if (interestAdd !== undefined) updateFields.interestAdd = interestAdd;
      if (interestRemove !== undefined) updateFields.interestRemove = interestRemove;

      // Update profile
      const profile = await stores.profiles.update(profileId, updateFields, {
        expectedEtag: ifMatch || undefined,
        maxPicks: deps.config?.MAX_PICKS,
      });
      if (!profile) return sendError(res, 500, 'Failed to update profile', ErrorCodes.INTERNAL_ERROR);

      log.info('profile:updated', { profileId, userId: req.user.userId, fields: Object.keys(updateFields) });
      emitter.profileUpdated({
        profile,
        user: await getUserById(profile.userId),
        changedFields: {
          picks: nextPicks !== undefined || pickDeltas !== undefined,
          interests: interestAdd !== undefined || interestRemove !== undefined,
        },
      });

      // Set ETag for optimistic concurrency on subsequent updates
      if (profile.updatedAt) res.setHeader('ETag', `"${profile.updatedAt}"`);
      sendSuccess(res, serializeOwnProfile(profile, await getUserById(profile.userId)));
      // A mark on an act that sets already cover converts at once, after the response.
      if (interestAdd?.length && festival) {
        const cover = coverLineup(festival.lineup, festival.days || [], festival.b2bSeparator || 'b2b');
        // Nothing to convert when every scheduled act the writer added is already converted.
        const needsConversion = interestAdd.some((id) => cover[id]?.state === 'scheduled' && profile.interests?.[id]?.state !== 'converted');
        if (needsConversion) await deps.interestConversion?.convert(festival.id);
      }
      return;
    } catch (error: any) {
      if (error.code === 'VERSION_MISMATCH') return sendVersionConflict(res, error.current);
      if (error.code === 'TOO_MANY_PICKS') return sendError(res, 400, 'Too many picks', ErrorCodes.INVALID_INPUT);
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
      await removeProfileSockets(profile, io);
      emitter.profileDeleted({ festivalId: profile.festivalId, profileId: profile.id });
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      log.error('profile delete failed', { error: error.message, profileId: req.validatedParams?.id });
      return sendError(res, 500, 'Failed to delete profile', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
