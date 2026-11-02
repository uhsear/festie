// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { RouteDeps } from '../lib/types';
import type { crewIdUserIdParams } from '../lib/schemas';

const LIMIT_MS = 5 * 60_000;

/**
 * "Looking for you": one crew member tells another, by push, that they are
 * looking for them.
 *
 * ONLINE-ONLY: a nudge delivered an hour late is wrong, so clients never queue
 * it offline. NO LOCATION: the push holds the sender's name and a fixed
 * sentence, and nothing here reads or writes a position, a socket event or a
 * feed row.
 *
 * The limit is one nudge per directed pair (crew, sender, receiver) per
 * 5 minutes. Per pair, so Ana and Ben can each nudge the other, and one person
 * cannot flood a friend from several taps or devices. The Redis key is the
 * limiter: without Redis the route fails closed with 503.
 *
 *   POST /:crewId/members/:userId/nudge
 */
export default function createCrewNudgeRoutes(deps: RouteDeps) {
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
    validateParams,
    redis,
    crewNotify,
  } = deps;

  const router = Router({ mergeParams: true });
  const UNAVAILABLE = '"Looking for you" is not available right now.';

  router.post(
    '/:crewId/members/:userId/nudge',
    userAuth,
    rateLimit(20, 'crew-nudge'),
    validateParams(schemas.crewIdUserIdParams),
    async (req: Request, res: Response) => {
      try {
        if (!redis) return sendError(res, 503, UNAVAILABLE, ErrorCodes.SERVICE_UNAVAILABLE);
        const params = req.validatedParams as z.infer<typeof crewIdUserIdParams>;
        const crewId = sanitizeIdentifier(params.crewId);
        const toId = sanitizeIdentifier(params.userId);
        const fromId = req.user.userId;

        if (toId === fromId) {
          return sendError(res, 400, "You can't send this to yourself.", ErrorCodes.INVALID_INPUT);
        }

        // getMembers skips deleted accounts. The caller check runs first, so a
        // non-member learns nothing about who is in the crew.
        const members: Array<{ userId: string }> = await stores.crews.getMembers(crewId);
        if (!members.some((m) => m.userId === fromId)) {
          return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        }
        if (!members.some((m) => m.userId === toId)) {
          return sendError(res, 404, 'That person is not in this crew.', ErrorCodes.NOT_FOUND);
        }

        const key = `nudge:${crewId}:${fromId}:${toId}`;
        let ok: unknown;
        let pttl = 0;
        try {
          ok = await redis.set(key, '1', 'PX', LIMIT_MS, 'NX');
          if (ok !== 'OK') pttl = Number(await redis.pttl(key));
        } catch (err) {
          log.warn('crew nudge limit failed', { error: (err as Error).message, crewId });
          return sendError(res, 503, UNAVAILABLE, ErrorCodes.SERVICE_UNAVAILABLE);
        }
        if (ok !== 'OK') {
          res.set('Retry-After', String(Math.max(1, Math.ceil((Number.isFinite(pttl) ? pttl : 0) / 1000))));
          return sendError(res, 429, 'You sent this in the last 5 minutes.', ErrorCodes.RATE_LIMITED);
        }

        // Fire-and-forget: a slow push transport must not hold the request.
        // T47: exempt from push budget
        void crewNotify?.toUsers({
          crewId,
          userIds: [toId],
          kind: 'member',
          type: 'crew_nudge',
          text: `${req.user.username || 'A crewmate'} is looking for you.`,
        });
        return sendSuccess(res, { nudged: true });
      } catch (err) {
        log.error('crew nudge failed', {
          error: (err as Error).message,
          crewId: (req.validatedParams as any)?.crewId,
        });
        return sendError(res, 500, "Couldn't send it. Try again.", ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
