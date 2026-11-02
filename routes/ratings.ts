import { Router } from 'express';

export function createRatingsRoutes({
  stores,
  userAuth,
  log,
  sendSuccess,
  sendError,
  ErrorCodes,
  rateLimit,
  schemas,
  validate,
  validateParams,
  validateQuery,
}: any) {
  const router = Router();
  const noopLimit = (_req: any, _res: any, next: any) => next();
  const writeLimit = typeof rateLimit === 'function' ? rateLimit(60, 'rating-write') : noopLimit;
  const readLimit = typeof rateLimit === 'function' ? rateLimit(120, 'rating-read') : noopLimit;

  // Rate a set (upsert)
  router.post(
    '/:setId',
    userAuth,
    writeLimit,
    validateParams(schemas.setIdParams),
    validate(schemas.ratingCreate),
    async (req: any, res: any) => {
      try {
        const { setId } = req.validatedParams;
        const { rating, note } = req.validatedBody;

        // Verify set exists
        const setCheck = await stores.pool.query(
          `
  SELECT
    fs.id,
    fs.festival_id
  FROM
    festival_sets fs
    JOIN festivals f ON fs.festival_id = f.id
    AND f.deleted_at IS NULL
  WHERE
    fs.id = $1
`,
          [setId],
        );
        if (setCheck.rows.length === 0) {
          return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
        }

        // A missing note keeps the stored one; '' clears it.
        const result = await stores.ratings.upsert(
          req.user.userId,
          setId,
          rating,
          note === undefined ? null : note.slice(0, 500),
        );
        return sendSuccess(res, result);
      } catch (err: any) {
        log.error('rate set failed', { error: err.message, setId: req.validatedParams?.setId });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Mark a set as seen (true), skipped (false) or unknown (null)
  router.put(
    '/:setId/caught',
    userAuth,
    writeLimit,
    validateParams(schemas.setIdParams),
    validate(schemas.caughtUpdate),
    async (req: any, res: any) => {
      try {
        const { setId } = req.validatedParams;
        const setCheck = await stores.pool.query(
          `
  SELECT
    fs.id
  FROM
    festival_sets fs
    JOIN festivals f ON fs.festival_id = f.id
    AND f.deleted_at IS NULL
  WHERE
    fs.id = $1
`,
          [setId],
        );
        if (setCheck.rows.length === 0) {
          return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
        }
        const result = await stores.ratings.setCaught(req.user.userId, setId, req.validatedBody.caught);
        return sendSuccess(res, result);
      } catch (err: any) {
        log.error('mark set caught failed', { error: err.message, setId: req.validatedParams?.setId });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Delete a rating
  router.delete('/:setId', userAuth, writeLimit, validateParams(schemas.setIdParams), async (req: any, res: any) => {
    try {
      await stores.ratings.delete(req.user.userId, req.validatedParams.setId);
      return sendSuccess(res, { deleted: true });
    } catch (err: any) {
      log.error('delete rating failed', { error: err.message, setId: req.validatedParams?.setId });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get my ratings for a festival
  router.get(
    '/festival/:festivalId',
    userAuth,
    readLimit,
    validateParams(schemas.festivalIdParams),
    async (req: any, res: any) => {
      try {
        const ratings = await stores.ratings.getByUser(req.user.userId, req.validatedParams.festivalId);
        return sendSuccess(res, { ratings });
      } catch (err: any) {
        log.error('get user ratings failed', { error: err.message, festivalId: req.validatedParams?.festivalId });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Get aggregate ratings for a festival (public — intentionally unauthenticated).
  // This endpoint returns read-only aggregate data (average rating, count per set)
  // with no PII. Keeping it public allows share pages and unauthenticated festival
  // browsers to display community sentiment without requiring login.
  router.get(
    '/festival/:festivalId/all',
    readLimit,
    validateParams(schemas.festivalIdParams),
    validateQuery(schemas.paginationQuery),
    async (req: any, res: any) => {
      try {
        const { cursor, limit } = req.validatedQuery;
        const result = await stores.ratings.getByFestival(req.validatedParams.festivalId, { cursor, limit });
        return sendSuccess(res, { ratings: result.items, nextCursor: result.nextCursor });
      } catch (err: any) {
        log.error('get festival ratings failed', { error: err.message, festivalId: req.validatedParams?.festivalId });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Get crew ratings for a festival
  router.get(
    '/crew/:crewId/festival/:festivalId',
    userAuth,
    readLimit,
    validateParams(schemas.crewIdFestivalIdParams),
    validateQuery(schemas.paginationQuery),
    async (req: any, res: any) => {
      try {
        const member = await stores.crews.getMember(req.validatedParams.crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const { cursor, limit } = req.validatedQuery;
        const result = await stores.ratings.getCrewRatings(req.validatedParams.crewId, req.validatedParams.festivalId, {
          cursor,
          limit,
        });
        return sendSuccess(res, { ratings: result.items, nextCursor: result.nextCursor });
      } catch (err: any) {
        log.error('get crew ratings failed', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Get crew-aware wrap superlatives (M3). Auth + crew-membership gated,
  // mirroring the crew-ratings handler — only crew members can see crew data.
  router.get(
    '/crew-wrap/:crewId/:festivalId',
    userAuth,
    readLimit,
    validateParams(schemas.crewIdFestivalIdParams),
    async (req: any, res: any) => {
      try {
        const { crewId, festivalId } = req.validatedParams;
        const member = await stores.crews.getMember(crewId, req.user.userId);
        if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        // The wrap derives totalSplit/biggestSpender from the expense rows, not
        // balances: settling up zeroes every balance.
        const expenses = await stores.expenses.getByCrew(crewId);
        const wrap = await stores.ratings.getCrewWrap(crewId, festivalId, { expenses });
        return sendSuccess(res, { wrap });
      } catch (err: any) {
        log.error('get crew wrap failed', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Cross-festival year-over-year history (M3). No festival param — aggregates
  // the user's entire rating archive across every festival. userAuth-gated;
  // only ever returns the requester's own data. Empty (zero ratings) returns
  // clean zeroed totals + empty arrays, never a 500.
  router.get('/lifetime', userAuth, readLimit, async (req: any, res: any) => {
    try {
      const result = await stores.ratings.getLifetimeStats(req.user.userId);
      return sendSuccess(res, {
        totals: result.totals,
        byFestival: result.byFestival,
        topArtists: result.topArtists,
      });
    } catch (err: any) {
      log.error('get lifetime stats failed', { error: err.message, userId: req.user?.userId });
      return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Get the current user's wrap: rating stats, picks and their crew. The crew
  // is the one named by ?crewId= when the user is in it, else their oldest
  // crew in this festival. crewAlso is a count only, never names or ids.
  router.get(
    '/wrap/:festivalId',
    userAuth,
    readLimit,
    validateParams(schemas.festivalIdParams),
    validateQuery(schemas.wrapQuery),
    async (req: any, res: any) => {
      try {
        const userId = req.user.userId;
        const { festivalId } = req.validatedParams;
        const festival = await stores.ratings.getWrapFestival(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

        const crews = await stores.crews.listByUserAndFestival(userId, festivalId);
        const crewRow = crews.find((c: any) => c.id === req.validatedQuery.crewId) ?? crews[0] ?? null;
        const crew = crewRow
          ? {
              id: crewRow.id,
              name: crewRow.name,
              memberCount: Number(await stores.crews.getMemberCount(crewRow.id)),
              photoAlbumUrl: crewRow.photoAlbumUrl ?? null,
            }
          : null;

        const [stats, ratings, planned] = await Promise.all([
          stores.ratings.getWrapStats(userId, festivalId),
          stores.ratings.getByUser(userId, festivalId),
          stores.ratings.getPlannedForWrap(userId, festivalId, crew ? crew.id : null),
        ]);
        const topSets = ratings.filter((r: any) => r.rating >= 4).slice(0, 5);
        return sendSuccess(res, { stats, topSets, allRatings: ratings, festival, planned, crew });
      } catch (err: any) {
        log.error('get wrap stats failed', { error: err.message, festivalId: req.validatedParams?.festivalId });
        return sendError(res, 500, 'Internal server error', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
