import { Router } from 'express';

/**
 * Crew days (090): which festival days each member attends.
 *
 * Answers are 'going' | 'maybe' | 'no'; no row means no answer, and clients
 * count a member as there unless they said 'no'. Crew data: members only, and
 * never part of an invite preview. Mounted by routes/crews.ts.
 *   GET /:crewId/days  — every current member's answers
 *   PUT /:crewId/days  — replace MY full answer set (idempotent, offline replay-safe)
 */
export default function createCrewDaysRoutes(deps: any) {
  const {
    log,
    userAuth,
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
  } = deps;

  const router = Router({ mergeParams: true });

  router.get(
    '/:crewId/days',
    userAuth,
    rateLimit(120, 'crew-days-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const membership = await stores.crews.getMember(crewId, req.user.userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const days = await stores.crewDays.listByCrew(crewId);
        return sendSuccess(res, { days });
      } catch (err: any) {
        log.error('get crew days error', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to load crew days', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.put(
    '/:crewId/days',
    userAuth,
    rateLimit(30, 'crew-days-update'),
    validateParams(schemas.crewIdParams),
    validate(schemas.crewDays),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;
        const { days: answers } = req.validatedBody;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const dayCount = await stores.crewDays.dayCount(crewId);
        if (answers.some((d: { dayIndex: number }) => d.dayIndex >= dayCount)) {
          return sendError(res, 400, 'That day is not part of this festival.', ErrorCodes.VALIDATION_ERROR);
        }

        const days = await stores.crewDays.replaceMine(crewId, userId, answers);
        io.to('crew:' + crewId).emit('crew:days-updated', { crewId, userId, days });
        return sendSuccess(res, { days });
      } catch (err: any) {
        log.error('update crew days error', { error: err.message });
        return sendError(res, 500, 'Failed to save crew days', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
