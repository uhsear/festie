import { Router } from 'express';
import { generateUniqueInviteCode, inviteExpiryFor } from '../lib/invite-code.js';
import { ensureFestivalProfile } from '../lib/festival-profile.js';
import { logCrewActivity } from '../lib/db/stores/activity.js';

export default function createCrewInviteRoutes(deps: any) {
  const {
    log,
    userAuth,
    sanitizeIdentifier,
    getFestivalById,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    stores,
    schemas,
    validate,
    validateParams,
    io,
    crewNotify,
  } = deps;

  const { resolveCrewOwnership, serializeCrewWithMembers, MAX_CREWS_PER_USER_PER_FESTIVAL } = deps._crewHelpers;

  const router = Router({ mergeParams: true });

  // ── POST /join — Join a crew via invite code ────────────────────
  router.post('/join', userAuth, rateLimit(10, 'crew-join'), validate(schemas.crewJoin), async (req: any, res: any) => {
    try {
      const code = req.validatedBody.inviteCode.toUpperCase().trim();

      const crew = await stores.crews.getByInviteCode(code);
      if (!crew) {
        // Check if code exists but is expired
        const expiredCrew = await stores.crews.getExpiredByInviteCode(code);
        if (expiredCrew)
          return sendError(
            res,
            410,
            'This invite has expired. Ask the crew owner for a new link.',
            ErrorCodes.NOT_FOUND,
          );
        return sendError(res, 404, 'Invalid invite code', ErrorCodes.NOT_FOUND);
      }

      // Already a member: succeed so a retried or replayed offline join is
      // idempotent. No crew:member-joined broadcast, since nothing changed.
      const existing = await stores.crews.getMember(crew.id, req.user.userId);
      if (existing) {
        const members = await stores.crews.getMembers(crew.id);
        return sendSuccess(res, { ...serializeCrewWithMembers(crew, members, req.user.userId), alreadyMember: true });
      }

      // Limit crews per user per festival
      const userCrews = await stores.crews.listByUserAndFestival(req.user.userId, crew.festivalId);
      if (userCrews.length >= MAX_CREWS_PER_USER_PER_FESTIVAL) {
        return sendError(
          res,
          400,
          `You're already in ${MAX_CREWS_PER_USER_PER_FESTIVAL} crews for this festival. Leave one to join this crew.`,
          ErrorCodes.MAX_LIMIT_REACHED,
        );
      }

      // Check member cap (fast pre-check; addMember enforces it atomically below).
      const memberCount = await stores.crews.getMemberCount(crew.id);
      if (memberCount >= crew.maxMembers) {
        return sendError(res, 400, 'Crew is full', ErrorCodes.MAX_LIMIT_REACHED);
      }

      // Create the caller's profile in the crew's festival if it is missing.
      // Runs after the cap checks so a refused join leaves no stray profile.
      const profileResult = await ensureFestivalProfile(deps, req.user, crew.festivalId);
      if (profileResult.error === 'limit') {
        return sendError(
          res,
          400,
          'This festival has reached its member limit on Festie.',
          ErrorCodes.MAX_LIMIT_REACHED,
        );
      }
      if (profileResult.error === 'user-missing') {
        return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      }

      // Pass the cap so the insert closes the count-then-insert race under a row lock.
      const joinResult = await stores.crews.addMember(
        { crewId: crew.id, userId: req.user.userId, role: 'member' },
        crew.maxMembers,
      );
      if (joinResult === 'full') {
        return sendError(res, 400, 'Crew is full', ErrorCodes.MAX_LIMIT_REACHED);
      }

      const members = await stores.crews.getMembers(crew.id);

      // Broadcast new member to crew room
      if (io) {
        io.to(`crew:${crew.id}`).emit('crew:member-joined', {
          crewId: crew.id,
          userId: req.user.userId,
          username: req.user.username,
        });
      }

      await logCrewActivity(deps, { crewId: crew.id, userId: req.user.userId, type: 'member-joined' });
      crewNotify?.queue({
        crewId: crew.id,
        actorId: req.user.userId,
        kind: 'member',
        text: `${req.user.username} joined`,
      });

      log.info('crew:joined', { crewId: crew.id, festivalId: crew.festivalId, userId: req.user.userId });
      return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
    } catch (error: any) {
      log.error('crew join failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to join crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /:crewId/invite — Regenerate invite code (owner only) ─
  router.post(
    '/:crewId/invite',
    userAuth,
    rateLimit(5, 'crew-invite'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'regenerate invite codes');
        if (!resolved) return;

        const newCode = await generateUniqueInviteCode(stores);
        const inviteExpiresAt = inviteExpiryFor(await getFestivalById(resolved.crew.festivalId));
        await stores.crews.regenerateInviteCode(crewId, newCode, inviteExpiresAt);

        log.info('crew:invite-regenerated', { crewId, userId: req.user.userId });
        return sendSuccess(res, { inviteCode: newCode, inviteExpiresAt });
      } catch (error: any) {
        log.error('crew invite regen failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to regenerate invite code', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /join/:inviteCode — Moved to the /join/:code invite page ─
  router.get('/join/:inviteCode', rateLimit(30, 'crew-invite-page'), (req: any, res: any) => {
    const code = String(req.params.inviteCode || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    return res.redirect(301, code ? `/join/${encodeURIComponent(code)}` : '/');
  });

  return router;
}
