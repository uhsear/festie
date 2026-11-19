import { Router } from 'express';
import { crewMembership } from '../lib/app-context/session';

export default function createActivityRoutes(deps: any) {
  const router = Router();
  const { stores, userAuth, sendSuccess, sendError, ErrorCodes, log, sanitizeIdentifier, rateLimit, schemas, validateQuery, validateParams } = deps;
  const crewMember = crewMembership(deps);
  const readLimit = rateLimit(120, 'activity-read');

  // GET /crew/:crewId/activity
  router.get('/crews/:crewId/activity', userAuth, readLimit, validateParams(schemas.crewIdParams), validateQuery(schemas.paginationQuery), crewMember, async (req: any, res: any) => {
    try {
      const crewId = sanitizeIdentifier(req.validatedParams.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const { cursor, limit } = req.validatedQuery;
      const result = await stores.activity.getByCrew(crewId, { cursor, limit });
      return sendSuccess(res, { items: result.items, nextCursor: result.nextCursor });
    } catch (err: any) {
      log.error('get activity failed', { error: err.message });
      return sendError(res, 500, 'Failed to load activity', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
