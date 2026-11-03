// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { RouteDeps } from '../lib/types';
import type { crewIdParams, liveLocationFixSchema } from '../lib/schemas';
import { LOCATION_UPDATE_LIMIT } from '../lib/rate-limiting.js';
import {
  MAX_SHARE_WINDOW_MS,
  clampCapturedAt,
  dropLivePosition,
  writeLivePosition,
} from '../lib/live-location-cache.js';
import { noteBatteryLevel } from '../lib/battery-low.js';

/**
 * Crew live location over HTTP (background sharing, T41).
 *
 * WHY HTTP: a phone that shares while locked has no socket. Mobile disconnects
 * the socket when the app goes to the background, and iOS suspends the app
 * between location wakes. The native background task posts each fix here. The
 * server relays it exactly like the socket `location:update` handler: a
 * `location:peer-update` to the crew room plus the Redis late-joiner cache.
 * This is the same choice SOS made (routes/crew-sos.ts).
 *
 * EPHEMERAL: nothing here touches Postgres. Live GPS lives only in the socket
 * broadcast and the short-TTL Redis cache (lib/live-location-cache.ts).
 *
 * The server enforces the share's time box: a fix after `expiresAt`, or with an
 * `expiresAt` more than MAX_SHARE_WINDOW_MS ahead, is refused.
 *
 *   POST   /:crewId/live-location — relay one fix
 *   DELETE /:crewId/live-location — stop sharing; peers drop the marker
 */
export default function createCrewLiveLocationRoutes(deps: RouteDeps) {
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
    io,
    redis,
    emitter,
  } = deps;

  const router = Router({ mergeParams: true });
  const FLAG_OFF_MESSAGE = 'Live location is turned off right now.';
  const FAILED_MESSAGE = "Couldn't update your live location. Try again.";
  // Clock-skew allowance on the far end of the share window.
  const EXPIRES_AT_SKEW_MS = 60_000;

  // ── POST /:crewId/live-location — relay one background fix ───────
  router.post(
    '/:crewId/live-location',
    userAuth,
    rateLimit(30, 'crew-live-location'),
    validateParams(schemas.crewIdParams),
    validate(schemas.liveLocationFix),
    async (req: Request, res: Response) => {
      try {
        if (config?.LIVE_LOCATION_ENABLED === false) {
          return sendError(res, 503, FLAG_OFF_MESSAGE, ErrorCodes.SERVICE_UNAVAILABLE);
        }
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof liveLocationFixSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const nowMs = Date.now();
        const exp = Date.parse(body.expiresAt);
        if (exp <= nowMs) {
          return sendError(res, 400, 'This share has ended. Turn sharing on again.', ErrorCodes.INVALID_INPUT);
        }
        if (exp > nowMs + MAX_SHARE_WINDOW_MS + EXPIRES_AT_SKEW_MS) {
          return sendError(res, 400, 'Pick a sharing time of 12 hours or less.', ErrorCodes.INVALID_INPUT);
        }

        // Same cluster-wide per-user cap as the socket path, so a user cannot
        // double their rate by mixing socket and HTTP fixes.
        const check = await LOCATION_UPDATE_LIMIT.consumeAsync(userId, redis);
        if (!check.allowed) {
          return sendError(res, 429, 'Too many location updates. Try again in a minute.', ErrorCodes.RATE_LIMITED);
        }

        const serverAt = new Date(nowMs).toISOString();
        const payload = {
          _v: 1 as const,
          crewId,
          userId,
          username: req.user.username,
          lat: body.lat,
          lng: body.lng,
          accuracy: body.accuracy,
          heading: body.heading,
          speed: body.speed,
          battery: body.battery,
          lowPower: body.lowPower,
          expiresAt: body.expiresAt,
          capturedAt: clampCapturedAt(body.capturedAt, nowMs, serverAt),
          serverAt,
        };
        if (io) io.to('crew:' + crewId).emit('location:peer-update', payload);
        void writeLivePosition(redis, crewId, payload);
        void noteBatteryLevel({ redis, stores, emitter, log }, payload);
        return sendSuccess(res, { serverAt });
      } catch (err) {
        log.error('live location fix failed', {
          error: (err as Error).message,
          crewId: (req.validatedParams as any)?.crewId,
        });
        return sendError(res, 500, FAILED_MESSAGE, ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/live-location — stop sharing ─────────────────
  router.delete(
    '/:crewId/live-location',
    userAuth,
    rateLimit(30, 'crew-live-location-stop'),
    validateParams(schemas.crewIdParams),
    async (req: Request, res: Response) => {
      try {
        if (config?.LIVE_LOCATION_ENABLED === false) {
          return sendError(res, 503, FLAG_OFF_MESSAGE, ErrorCodes.SERVICE_UNAVAILABLE);
        }
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;

        // Membership first, so a client cannot spray peer-stopped into other crews.
        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        void dropLivePosition(redis, crewId, userId);
        if (io) io.to('crew:' + crewId).emit('location:peer-stopped', { _v: 1, crewId, userId, reason: 'stop' });
        return sendSuccess(res, { stopped: true });
      } catch (err) {
        log.error('live location stop failed', {
          error: (err as Error).message,
          crewId: (req.validatedParams as any)?.crewId,
        });
        return sendError(res, 500, FAILED_MESSAGE, ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
