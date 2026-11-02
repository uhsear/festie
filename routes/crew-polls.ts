import { Router } from 'express';
import { MAX_MEETING_POINTS_PER_CREW, MAX_OPEN_POLLS_PER_CREW } from '../lib/constants';

export default function createCrewPollRoutes(deps: any) {
  const {
    log,
    userAuth,
    createOpaqueId,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    stores,
    schemas,
    validate,
    validateParams,
    io,
    emitter,
  } = deps;

  const router = Router({ mergeParams: true });

  // ── GET /:crewId/polls ─────────────────────────────────────────
  router.get(
    '/:crewId/polls',
    userAuth,
    rateLimit(120, 'crew-poll-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;
        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const polls = await stores.polls.listByCrew(crewId);
        return sendSuccess(res, { polls });
      } catch (err: any) {
        log.error('get polls error', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to list polls', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/polls ────────────────────────────────────────
  router.post(
    '/:crewId/polls',
    userAuth,
    rateLimit(10, 'crew-poll-create'),
    validateParams(schemas.crewIdParams),
    validate(schemas.pollCreate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const { question, options, closesAt, setRefs } = req.validatedBody;
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const activePollCount = await stores.polls.countActiveByCrew(crewId);
        if (activePollCount >= MAX_OPEN_POLLS_PER_CREW) {
          return sendError(
            res,
            409,
            `This crew already has ${MAX_OPEN_POLLS_PER_CREW} open polls. Close one to start another.`,
            ErrorCodes.CONFLICT,
          );
        }

        const poll = await stores.polls.create({
          crewId,
          createdBy: userId,
          question,
          options,
          closesAt: closesAt ? new Date(closesAt) : null,
          setRefs: setRefs ?? null,
        });

        io.to('crew:' + crewId).emit('crew:poll-created', {
          pollId: poll.id,
          question: poll.question,
          options: poll.options,
          createdBy: userId,
        });
        const activity = { crewId, userId, type: 'poll-created', detail: poll.question.slice(0, 100) };
        await stores.activity
          .log(activity)
          .then((id: string) => emitter.crewActivityLogged({ crewId, item: { id, ...activity } }))
          .catch(() => {});
        return sendSuccess(res, { poll });
      } catch (err: any) {
        log.error('create poll error', { error: err.message });
        return sendError(res, 500, 'Failed to create poll', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/polls/:pollId/vote ───────────────────────────
  router.post(
    '/:crewId/polls/:pollId/vote',
    userAuth,
    rateLimit(60, 'crew-poll-vote'),
    validateParams(schemas.crewIdPollIdParams),
    validate(schemas.pollVote),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const pollId = sanitizeIdentifier(req.validatedParams.pollId);
        const { optionIndex } = req.validatedBody;
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const poll = await stores.polls.getById(pollId);
        if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
        if (optionIndex >= poll.options.length)
          return sendError(res, 400, 'Invalid option index', ErrorCodes.INVALID_INPUT);
        if (poll.closed || (poll.closes_at && new Date(poll.closes_at) <= new Date()))
          return sendError(res, 409, 'Poll is closed', ErrorCodes.CONFLICT);

        await stores.polls.vote(pollId, userId, optionIndex);
        io.to('crew:' + crewId).emit('crew:poll-voted', { pollId, userId, optionIndex });
        const activity = { crewId, userId, type: 'poll-voted', detail: poll.options[optionIndex] || null };
        await stores.activity
          .log(activity)
          .then((id: string) => emitter.crewActivityLogged({ crewId, item: { id, ...activity } }))
          .catch(() => {});
        return sendSuccess(res, { voted: true });
      } catch (err: any) {
        log.error('vote error', { error: err.message });
        return sendError(res, 500, 'Failed to vote', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/polls/:pollId — Close a poll ───────────────
  router.delete(
    '/:crewId/polls/:pollId',
    userAuth,
    rateLimit(10, 'crew-poll-delete'),
    validateParams(schemas.crewIdPollIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const pollId = sanitizeIdentifier(req.validatedParams.pollId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const poll = await stores.polls.getById(pollId);
        if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
        if (poll.created_by !== userId && membership.role !== 'owner') {
          return sendError(res, 403, 'Only creator or owner can close poll', ErrorCodes.FORBIDDEN);
        }

        // close() is a no-op (undefined) when the poll was already closed, so a racing close creates nothing.
        const closed = await stores.polls.close(pollId);
        let point: any = null;
        let ref: any = null;
        if (closed) {
          io.to('crew:' + crewId).emit('crew:poll-closed', { pollId });
          const setRefs = Array.isArray(poll.set_refs) ? poll.set_refs : [];
          if (setRefs.some((r: any) => r)) {
            try {
              const counts: number[] = await stores.polls.tallyVotes(pollId);
              let winner = -1;
              counts.forEach((n, i) => {
                if (n > 0 && (winner < 0 || n > counts[winner]!)) winner = i;
              });
              ref = winner >= 0 ? (setRefs[winner] ?? null) : null;
              if (ref) {
                const count = await stores.crews.meetingPoints.countByCrew(crewId);
                if (count < MAX_MEETING_POINTS_PER_CREW) {
                  const meetAt = ref.meetAt ?? null;
                  point = await stores.crews.meetingPoints.create({
                    id: createOpaqueId('mp'),
                    crewId,
                    createdBy: userId,
                    label: String(ref.label).slice(0, 100),
                    location: ref.stageReference || ref.label,
                    type: 'set',
                    meetAt,
                    stageReference: ref.stageReference ?? null,
                    expiresAt: meetAt ? new Date(new Date(meetAt).getTime() + 30 * 60_000).toISOString() : null,
                    latitude: null,
                    longitude: null,
                    recursDaily: false,
                  });
                  io.to('crew:' + crewId).emit('crew:meeting-point-created', point);
                }
              }
            } catch (mpErr: any) {
              log.warn('poll close meeting point failed', { error: mpErr.message, pollId });
            }
          }
        }
        return sendSuccess(res, { closed: closed ?? null, meetingPoint: point ?? null, winningSetId: ref?.setId ?? null });
      } catch (err: any) {
        log.error('close poll error', { error: err.message });
        return sendError(res, 500, 'Failed to close poll', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
