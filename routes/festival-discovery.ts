import { Router } from 'express';
import { CO_PICK_MIN_USERS } from '../lib/constants';

// Mounted at /api/v1/festivals BEFORE festivalRoutes: its GET /:id would
// otherwise catch GET /follows.
export function createFestivalDiscoveryRoutes({
  stores,
  userAuth,
  log,
  sendSuccess,
  sendError,
  ErrorCodes,
  rateLimit,
  schemas,
  validateParams,
}: any) {
  const router = Router();
  const noopLimit = (_req: any, _res: any, next: any) => next();
  const followWriteLimit = typeof rateLimit === 'function' ? rateLimit(30, 'festival-follow') : noopLimit;
  const followReadLimit = typeof rateLimit === 'function' ? rateLimit(120, 'festival-follow-read') : noopLimit;
  const alsoPickedLimit = typeof rateLimit === 'function' ? rateLimit(120, 'festival-also-picked') : noopLimit;

  router.get('/follows', userAuth, followReadLimit, async (req: any, res: any) => {
    try {
      const festivalIds = await stores.follows.list(req.user.userId);
      return sendSuccess(res, { festivalIds });
    } catch (err: any) {
      log.error('list festival follows failed', { error: err.message });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.put(
    '/:id/follow',
    userAuth,
    followWriteLimit,
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const festivalId = req.validatedParams.id;
        const { rows } = await stores.pool.query(
          'SELECT 1 FROM festivals WHERE id = $1 AND deleted_at IS NULL AND published_at IS NOT NULL',
          [festivalId],
        );
        if (rows.length === 0) {
          return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        }
        await stores.follows.follow(req.user.userId, festivalId);
        return sendSuccess(res, { festivalId, following: true });
      } catch (err: any) {
        log.error('follow festival failed', { error: err.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // No festival check: a user can unfollow a festival that was deleted since.
  router.delete(
    '/:id/follow',
    userAuth,
    followWriteLimit,
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const festivalId = req.validatedParams.id;
        await stores.follows.unfollow(req.user.userId, festivalId);
        return sendSuccess(res, { festivalId, following: false });
      } catch (err: any) {
        log.error('unfollow festival failed', { error: err.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Public on purpose: anonymous set ids only, behind a 20-user floor (CO_PICK_MIN_USERS).
  router.get(
    '/:festivalId/sets/:setId/also-picked',
    alsoPickedLimit,
    validateParams(schemas.alsoPickedParams),
    async (req: any, res: any) => {
      try {
        const { festivalId, setId } = req.validatedParams;
        const { rows } = await stores.pool.query(
          `
  SELECT
    1
  FROM
    festival_sets s
    JOIN festivals f ON f.id = s.festival_id
    AND f.deleted_at IS NULL
    AND f.published_at IS NOT NULL
  WHERE
    s.id = $2
    AND s.festival_id = $1
`,
          [festivalId, setId],
        );
        if (rows.length === 0) {
          return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
        }
        const setIds = await stores.follows.alsoPicked(festivalId, setId, CO_PICK_MIN_USERS);
        res.setHeader('Cache-Control', 'public, max-age=600');
        return sendSuccess(res, { setIds });
      } catch (err: any) {
        log.error('also-picked failed', { error: err.message, setId: req.validatedParams?.setId });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
