import type { RouteDeps } from '../lib/types';
/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Lineup interest counts for the admin demand view.
 *
 * GET /api/v1/admin/festivals/:id/lineup-interest  -> { counts: { [entryId]: { open, converted } } }
 *
 * Counts only: the marks themselves are private to their owner and never leave the profile serializer.
 */

export default function createLineupInterestRoute(deps: RouteDeps) {
  const { express, log, festivalAccess, setNoStore, sanitizeIdentifier, sendSuccess, sendError, ErrorCodes, stores } = deps;

  const router = express.Router();

  router.get('/:id/lineup-interest', festivalAccess({ action: 'festival.impact' }), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await stores.festivals.getById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      return sendSuccess(res, { counts: await stores.profiles.interestCounts(festivalId) });
    } catch (error: any) {
      log.error('lineup interest counts failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to load interest counts', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
