/**
 * Crew polls.
 *
 *   GET    /:crewId/polls                 open polls plus the 10 most recently ended
 *   POST   /:crewId/polls                 create (optional end time, multi-answer, set links)
 *   POST   /:crewId/polls/:pollId/vote    vote, change a vote, or take it back (empty optionIndexes)
 *   DELETE /:crewId/polls/:pollId         end a poll (creator or owner) and announce the result
 *   POST   /:crewId/polls/:pollId/nudge   one reminder to the members who have not voted
 */
import { Router } from 'express';
import { createPollCloser } from '../lib/poll-close';

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
    crewNotify,
  } = deps;
  const pollCloser = deps.pollCloser ?? createPollCloser({ stores, io, emitter, crewNotify, createOpaqueId, log });

  const isEnded = (poll: any) => poll.closed || (poll.closes_at && new Date(poll.closes_at) <= new Date());

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
        const { question, options, closesAt, setRefs, multiAnswer } = req.validatedBody;
        const userId = req.user.userId;
        if (closesAt && new Date(closesAt).getTime() <= Date.now())
          return sendError(res, 400, 'Pick an end time in the future.', ErrorCodes.INVALID_INPUT);

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const activePollCount = await stores.polls.countActiveByCrew(crewId);
        if (activePollCount >= 3) return sendError(res, 409, 'Max 3 active polls per crew', ErrorCodes.CONFLICT);

        const poll = await stores.polls.create({
          crewId,
          createdBy: userId,
          question,
          options,
          closesAt: closesAt ? new Date(closesAt) : null,
          setRefs: setRefs ?? null,
          multiAnswer: multiAnswer === true,
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
        crewNotify?.queue({ crewId, actorId: userId, kind: 'poll', text: 'New poll: ' + poll.question.slice(0, 80) });
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
        const { optionIndex, optionIndexes } = req.validatedBody;
        const userId = req.user.userId;
        // Old clients send one optionIndex; an empty optionIndexes takes the vote back.
        const indexes: number[] = [...new Set<number>(optionIndexes ?? [optionIndex])].sort((a, b) => a - b);

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const poll = await stores.polls.getById(pollId);
        if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
        if (indexes.some((i) => i >= poll.options.length))
          return sendError(res, 400, 'Invalid option index', ErrorCodes.INVALID_INPUT);
        if (indexes.length > 1 && !poll.multi_answer)
          return sendError(res, 400, 'This poll takes one answer.', ErrorCodes.INVALID_INPUT);
        if (isEnded(poll)) return sendError(res, 409, 'Poll is closed', ErrorCodes.CONFLICT);

        if (indexes.length) await stores.polls.vote(pollId, userId, indexes);
        else await stores.polls.removeVote(pollId, userId);
        io.to('crew:' + crewId).emit('crew:poll-voted', {
          pollId,
          userId,
          optionIndex: indexes[0] ?? -1,
          optionIndexes: indexes,
        });
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

        // close() is a no-op (undefined) when the poll was already closed, so a racing close announces nothing.
        const closed = await stores.polls.close(pollId);
        const { meetingPoint, winningSetId } = closed
          ? await pollCloser.announce(closed, userId)
          : { meetingPoint: null, winningSetId: null };
        return sendSuccess(res, { closed: closed ?? null, meetingPoint, winningSetId });
      } catch (err: any) {
        log.error('close poll error', { error: err.message });
        return sendError(res, 500, 'Failed to close poll', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/polls/:pollId/nudge — one reminder to non-voters ──
  router.post(
    '/:crewId/polls/:pollId/nudge',
    userAuth,
    rateLimit(10, 'crew-poll-nudge'),
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
        if (poll.created_by !== userId && membership.role !== 'owner')
          return sendError(res, 403, 'Only the poll creator or crew owner can send a reminder.', ErrorCodes.FORBIDDEN);
        if (isEnded(poll)) return sendError(res, 409, 'This poll has ended.', ErrorCodes.CONFLICT);

        const userIds = (await stores.polls.nonVoterIds(pollId, crewId)).filter((id: string) => id !== userId);
        if (!userIds.length) return sendError(res, 409, 'Everyone has voted.', ErrorCodes.CONFLICT);
        if (!(await stores.polls.markNudged(pollId)))
          return sendError(res, 409, 'A reminder was already sent for this poll.', ErrorCodes.CONFLICT);

        await crewNotify?.toUsers({
          crewId,
          userIds,
          kind: 'poll',
          text: `${req.user.username} is waiting for your vote: ${poll.question.slice(0, 80)}`,
        });
        return sendSuccess(res, { nudged: userIds.length });
      } catch (err: any) {
        log.error('nudge poll error', { error: err.message });
        return sendError(res, 500, 'Failed to send reminder', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
