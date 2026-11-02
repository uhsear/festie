// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { RouteDeps } from '../lib/types';
import type { checkinStartSchema, crewIdParams } from '../lib/schemas';
import { clearCheckin, getCheckin, startCheckin } from '../lib/checkin.js';
import { coarse } from '../lib/sos-raise.js';

/**
 * Crew check-in timers. A member starts a timer before walking somewhere alone;
 * if they do not tap "I'm OK" in time, the scheduler in lib/checkin.ts raises a
 * normal SOS for them. Like SOS, these are online-only HTTP calls.
 *
 *   POST /:crewId/checkin       — start (or restart) the caller's timer
 *   POST /:crewId/checkin/done  — "I'm OK": cancel the caller's timer
 *   GET  /:crewId/checkin       — the caller's active timer, or null
 */
export default function createCrewCheckinRoutes(deps: RouteDeps) {
  const {
    log,
    config,
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
    redis,
    emitter,
  } = deps;

  const router = Router({ mergeParams: true });
  const UNAVAILABLE = 'Check-in timers are not available right now.';

  async function logActivity(crewId: string, userId: string, type: string, detail: string | null) {
    try {
      const id = (await stores.activity.log({ crewId, userId, type, detail })) as string;
      if (id) emitter.crewActivityLogged({ crewId, item: { id, crewId, userId, type, detail } });
    } catch (err: any) {
      // The timer state is already saved; the feed row is a nicety.
      log.warn('checkin activity log failed', { error: err?.message, crewId, type });
    }
  }

  router.post(
    '/:crewId/checkin',
    userAuth,
    rateLimit(20, 'crew-checkin'),
    validateParams(schemas.crewIdParams),
    validate(schemas.checkinStart),
    async (req: Request, res: Response) => {
      try {
        if (config?.SOS_ENABLED === false || !redis) {
          return sendError(res, 503, UNAVAILABLE, ErrorCodes.SERVICE_UNAVAILABLE);
        }
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof checkinStartSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;
        const username = req.user.username || 'A crew member';

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const position = body.position
          ? {
              lat: coarse(body.position.lat),
              lng: coarse(body.position.lng),
              accuracy: body.position.accuracy,
              capturedAt: body.position.capturedAt,
            }
          : undefined;

        const started = await startCheckin(redis, { crewId, userId, username, minutes: body.minutes, position });
        if (!started) return sendError(res, 503, UNAVAILABLE, ErrorCodes.SERVICE_UNAVAILABLE);

        await logActivity(crewId, userId, 'checkin-started', `${body.minutes} min`);
        return sendSuccess(res, { dueAt: new Date(started.dueAt).toISOString(), minutes: body.minutes });
      } catch (err) {
        log.error('checkin start failed', {
          error: (err as Error).message,
          crewId: (req.validatedParams as any)?.crewId,
        });
        return sendError(res, 500, 'Failed to start the check-in timer', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.post(
    '/:crewId/checkin/done',
    userAuth,
    rateLimit(20, 'crew-checkin'),
    validateParams(schemas.crewIdParams),
    async (req: Request, res: Response) => {
      try {
        // No SOS_ENABLED gate: cancelling a running timer must always work, or
        // flipping the flag off would strand timers that still fire.
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const cleared = await clearCheckin(redis, crewId, userId);
        if (cleared) await logActivity(crewId, userId, 'checkin-done', null);
        return sendSuccess(res, { cleared });
      } catch (err) {
        log.error('checkin done failed', {
          error: (err as Error).message,
          crewId: (req.validatedParams as any)?.crewId,
        });
        return sendError(res, 500, 'Failed to stop the check-in timer', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.get(
    '/:crewId/checkin',
    userAuth,
    rateLimit(60, 'crew-checkin-read'),
    validateParams(schemas.crewIdParams),
    async (req: Request, res: Response) => {
      try {
        res.setHeader('Cache-Control', 'no-store');
        if (config?.SOS_ENABLED === false) {
          return sendError(res, 503, UNAVAILABLE, ErrorCodes.SERVICE_UNAVAILABLE);
        }
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const timer = await getCheckin(redis, crewId, userId);
        return sendSuccess(res, {
          checkin: timer ? { dueAt: new Date(timer.dueAt).toISOString(), minutes: timer.minutes } : null,
        });
      } catch (err) {
        log.error('checkin read failed', {
          error: (err as Error).message,
          crewId: (req.validatedParams as any)?.crewId,
        });
        return sendError(res, 500, 'Failed to load the check-in timer', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
