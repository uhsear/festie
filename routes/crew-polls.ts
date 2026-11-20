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
import { crewMembership } from '../lib/app-context/session';
import { MAX_OPEN_POLLS_PER_CREW } from '../lib/constants';
import { createPollCloser } from '../lib/poll-close';
import { isCreatorOrOwner } from '../lib/helpers/creator-or-owner';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { RouteDeps } from '../lib/types';
import type { Params } from '../lib/types/app-context';

export default function createCrewPollRoutes(deps: RouteDeps) {
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
    emitter,
    crewNotify,
  } = deps;
  const crewMember = crewMembership(deps);
  const pollCloser = deps.pollCloser ?? createPollCloser({ stores, emitter, crewNotify, createOpaqueId, log });

  const isEnded = (poll: any) => poll.closed || (poll.closes_at && new Date(poll.closes_at) <= new Date());

  const router = Router({ mergeParams: true });

  // ── GET /:crewId/polls ─────────────────────────────────────────
  router.get(
    '/:crewId/polls',
    userAuth,
    rateLimit(120, 'crew-poll-list'),
    validateParams(schemas.crewIdParams),
    crewMember,
    async (req: Request, res: Response) => {
      try {
        const crewId = sanitizeIdentifier((req.validatedParams as Params).crewId);
        const polls = await stores.polls.listByCrew(crewId);
        return sendSuccess(res, { polls });
      } catch (err) {
        log.error('get polls error', { error: (err as NodeJS.ErrnoException).message, crewId: (req.validatedParams as Params)?.crewId });
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
    crewMember,
    async (req: Request, res: Response) => {
      try {
        const crewId = sanitizeIdentifier((req.validatedParams as Params).crewId);
        const { question, options, closesAt, setRefs, multiAnswer } = req.validatedBody as z.infer<typeof schemas.pollCreate>;
        const userId = req.user.userId;
        if (closesAt && new Date(closesAt).getTime() <= Date.now())
          return sendError(res, 400, 'Pick an end time in the future.', ErrorCodes.INVALID_INPUT);


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
          multiAnswer: multiAnswer === true,
        });

        emitter.toCrew(crewId, 'crew:poll-created', {
          pollId: poll.id,
          question: poll.question,
          options: poll.options,
          createdBy: userId,
        });
        const activity = { crewId, userId, type: 'poll-created', detail: poll.question.slice(0, 100) };
        await stores.activity
          .log(activity)
          .then((id: string) => emitter.crewActivityLogged({ crewId, item: { id, ...activity } }))
          .catch((err: Error) => log.warn('poll-created activity log failed', { crewId, error: err.message }));
        crewNotify?.queue({ crewId, actorId: userId, kind: 'poll', text: 'New poll: ' + poll.question.slice(0, 80) });
        return sendSuccess(res, { poll });
      } catch (err) {
        log.error('create poll error', { error: (err as NodeJS.ErrnoException).message });
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
    crewMember,
    async (req: Request, res: Response) => {
      try {
        const crewId = sanitizeIdentifier((req.validatedParams as Params).crewId);
        const pollId = sanitizeIdentifier((req.validatedParams as Params).pollId);
        const { optionIndex, optionIndexes } = req.validatedBody as z.infer<typeof schemas.pollVote>;
        const userId = req.user.userId;
        // Old clients send one optionIndex; an empty optionIndexes takes the vote back.
        const indexes: number[] = [...new Set<number>(optionIndexes ?? [optionIndex as number])].sort((a, b) => a - b);


        const poll = await stores.polls.getById(pollId);
        if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
        if (indexes.some((i) => i >= poll.options.length))
          return sendError(res, 400, 'Invalid option index', ErrorCodes.INVALID_INPUT);
        if (indexes.length > 1 && !poll.multi_answer)
          return sendError(res, 400, 'This poll takes one answer.', ErrorCodes.INVALID_INPUT);
        if (isEnded(poll)) return sendError(res, 409, 'Poll is closed', ErrorCodes.CONFLICT);

        if (indexes.length) await stores.polls.vote(pollId, userId, indexes);
        else await stores.polls.removeVote(pollId, userId);
        emitter.toCrew(crewId, 'crew:poll-voted', {
          pollId,
          userId,
          optionIndex: indexes[0] ?? -1,
          optionIndexes: indexes,
        });
        return sendSuccess(res, { voted: true });
      } catch (err) {
        log.error('vote error', { error: (err as NodeJS.ErrnoException).message });
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
    crewMember,
    async (req: Request, res: Response) => {
      try {
        const crewId = sanitizeIdentifier((req.validatedParams as Params).crewId);
        const pollId = sanitizeIdentifier((req.validatedParams as Params).pollId);
        const userId = req.user.userId;


        const poll = await stores.polls.getById(pollId);
        if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
        if (!isCreatorOrOwner(poll, userId, req.membership.role)) {
          return sendError(res, 403, 'Only creator or owner can close poll', ErrorCodes.FORBIDDEN);
        }

        // close() is a no-op (undefined) when the poll was already closed, so a racing close announces nothing.
        const closed = await stores.polls.close(pollId);
        const { meetingPoint, winningSetId } = closed
          ? await pollCloser.announce(closed, userId)
          : { meetingPoint: null, winningSetId: null };
        return sendSuccess(res, { closed: closed ?? null, meetingPoint, winningSetId });
      } catch (err) {
        log.error('close poll error', { error: (err as NodeJS.ErrnoException).message });
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
    crewMember,
    async (req: Request, res: Response) => {
      try {
        const crewId = sanitizeIdentifier((req.validatedParams as Params).crewId);
        const pollId = sanitizeIdentifier((req.validatedParams as Params).pollId);
        const userId = req.user.userId;


        const poll = await stores.polls.getById(pollId);
        if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
        if (!isCreatorOrOwner(poll, userId, req.membership.role))
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
      } catch (err) {
        log.error('nudge poll error', { error: (err as NodeJS.ErrnoException).message });
        return sendError(res, 500, 'Failed to send reminder', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
