// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { RouteDeps } from '../lib/types';
import type { crewIdParams, sosClearSchema, sosRaiseSchema, sosSeenSchema } from '../lib/schemas';
import {
  SOS_RAISE_LIMIT,
  SOS_RAISE_MIN_GAP,
  clearSosActive,
  listActiveSos,
  isSosActive,
  markSosSeen,
  listSosSeen,
  clearSosSeen,
} from '../lib/rate-limiting.js';
import { sanitizeString } from '../lib/helpers/sanitize.js';
import { coarse, createSosRaiser } from '../lib/sos-raise.js';

/**
 * Crew SOS (Live Location + SOS, safety-critical path).
 *
 * DESIGN DEVIATION (justified): SOS raise/clear are HTTP POSTs, NOT socket
 * events. A safety feature must not be a fire-and-forget emit — it must be
 * reliable, validated, offline-detectable, and produce the durable side-effects
 * transactionally: one crew_activity row + a crew-wide socket broadcast + a
 * best-effort push fan-out. The socket only carries the resulting
 * `sos:raised` / `sos:cleared` broadcasts (clients never emit these).
 *
 * Ephemerality exception: live GPS is never persisted, but an SOS MAY attach a
 * single coarse coordinate (≈4 decimals, ~11m) to the activity row + push so the
 * crew can actually find the person. This is the only location datum that becomes
 * durable; it is opt-in (the user pressed SOS), capped, and crew-scoped.
 * A check-in timer (routes/crew-checkin.ts) also keeps one coarse position in
 * Redis until the timer ends plus one hour, so a missed timer can raise an SOS.
 *
 * Four endpoints, mounted by routes/crews.ts alongside status/meeting-point:
 *   POST /:crewId/sos        — raise an SOS (side effects in lib/sos-raise.ts)
 *   POST /:crewId/sos/clear  — clear one raiser's SOS ("I'm safe" or any crew member)
 *   POST /:crewId/sos/seen   — ack that the caller saw a raiser's SOS; broadcasts `sos:seen`
 *   GET  /:crewId/sos        — the active SOS entries with `seenBy`, for clients that join late
 */
export default function createCrewSosRoutes(deps: RouteDeps) {
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
  const sosRaiser = createSosRaiser(deps);

  // ── POST /:crewId/sos — raise an SOS ─────────────────────────────
  router.post(
    '/:crewId/sos',
    userAuth,
    rateLimit(10, 'crew-sos-raise'),
    validateParams(schemas.crewIdParams),
    validate(schemas.sosRaise),
    async (req: Request, res: Response) => {
      try {
        if (config?.SOS_ENABLED === false) {
          return sendError(res, 503, 'SOS is currently unavailable', ErrorCodes.SERVICE_UNAVAILABLE);
        }
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof sosRaiseSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;
        const username = req.user.username || 'A crew member';

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        // Precise per-user-per-crew throttle (1 per 120s), reset when the SOS is
        // cleared. Defense-in-depth on top of the coarse Redis-backed rateLimit()
        // middleware above.
        // The bucket is per PM2 worker, so a clear handled by another worker
        // cannot reset it; Redis is the cluster-wide source of truth.
        if ((await isSosActive(redis, crewId, userId)) === false) {
          SOS_RAISE_LIMIT.release(`${crewId}:${userId}`);
        }
        const gap = SOS_RAISE_MIN_GAP.consume(userId);
        const limit = gap.allowed ? SOS_RAISE_LIMIT.consume(`${crewId}:${userId}`) : gap;
        if (!limit.allowed) {
          const waitSeconds = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
          res.setHeader('Retry-After', String(waitSeconds));
          return sendError(
            res,
            429,
            `You just sent an SOS. Wait ${waitSeconds} seconds before sending another.`,
            ErrorCodes.RATE_LIMITED,
          );
        }

        // L1: run the SOS message through sanitizeString (NFC + strip control/
        // bidi/zero-width chars + cap) — matching every other crew free-text
        // field — before it reaches crew_activity.detail, the socket payload, and
        // the push body. Prevents RTL-override / zero-width spoofing on a
        // safety-critical surface.
        const message = sanitizeString(body.message, 280) || undefined;
        const position = body.position
          ? {
              lat: coarse(body.position.lat),
              lng: coarse(body.position.lng),
              accuracy: body.position.accuracy,
              capturedAt: body.position.capturedAt,
            }
          : undefined;

        const { activityId, raisedAt } = await sosRaiser.raise({ crewId, userId, username, message, position });
        return sendSuccess(res, { code: 'OK', activityId: activityId || null, raisedAt });
      } catch (err) {
        log.error('sos raise failed', { error: (err as Error).message, crewId: (req.validatedParams as any)?.crewId });
        return sendError(res, 500, 'Failed to raise SOS', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/sos/clear — clear an SOS ───────────────────────
  router.post(
    '/:crewId/sos/clear',
    userAuth,
    rateLimit(20, 'crew-sos-clear'),
    validateParams(schemas.crewIdParams),
    validate(schemas.sosClear),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof sosClearSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;
        const username = req.user.username || 'A crew member';
        const raiserId = body.raiserId ?? userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        // Clearing someone else's SOS: they must be in this crew, and their
        // username goes on the activity row so the feed shows who cleared it.
        let raiserUsername: string | null = null;
        if (raiserId !== userId) {
          const members = await stores.crews.getMembers(crewId);
          const raiser = members.find((m: any) => m.userId === raiserId);
          if (raiser) {
            raiserUsername = raiser.username || 'A crew member';
          } else {
            // A raiser who left, was kicked or deleted their account keeps the
            // hash field until its TTL; still let the crew dismiss that SOS.
            const stale = (await listActiveSos(redis, crewId, Date.now())).find((e: any) => e.userId === raiserId);
            if (!stale) return sendError(res, 404, 'That person is not in this crew', ErrorCodes.NOT_FOUND);
            raiserUsername = stale.username || 'A crew member';
          }
        }

        // L3: only clear if this raiser's SOS is actually active. This blocks
        // clear-spam (each clear is a DND-adjacent crew-wide broadcast). The
        // check is atomic per raiser (HDEL returns whether the field existed).
        // When Redis is unavailable (`unknown`) we fail-open and proceed — a
        // safety-critical "I'm safe" must never be silently swallowed by a
        // degraded cache.
        const cleared = await clearSosActive(redis, crewId, raiserId);
        if (cleared.wasActive === false) {
          return sendError(res, 409, 'No active SOS to clear', ErrorCodes.ALREADY_EXISTS);
        }
        await clearSosSeen(redis, crewId, raiserId);
        // Cleared SOS: the raiser may raise again right away (e.g. a false alarm).
        SOS_RAISE_LIMIT.release(`${crewId}:${raiserId}`);

        // user_id = the clearer; detail = the raiser's username when someone
        // else cleared it, null for a self-clear.
        const detail = raiserId === userId ? null : raiserUsername;

        let activityId: string | null = null;
        try {
          activityId = (await stores.activity.log({ crewId, userId, type: 'sos_cleared', detail })) as string;
        } catch (err: any) {
          log.error('sos clear activity log failed', { error: err?.message, crewId, userId });
        }

        const clearedAt = new Date().toISOString();
        if (io) {
          io.to('crew:' + crewId).emit('sos:cleared', {
            _v: 1,
            crewId,
            userId: raiserId,
            clearedBy: username,
            activityId: activityId || undefined,
            clearedAt,
          });
        }

        if (activityId) {
          try {
            emitter.crewActivityLogged({
              crewId,
              item: { id: activityId, crewId, userId, type: 'sos_cleared', detail },
            });
          } catch {
            // As above: the clear is already broadcast; the feed must not fail it.
          }
        }

        log.info('crew:sos-cleared', { crewId, userId, raiserId });
        return sendSuccess(res, { code: 'OK', activityId: activityId || null, clearedAt });
      } catch (err) {
        log.error('sos clear failed', { error: (err as Error).message, crewId: (req.validatedParams as any)?.crewId });
        return sendError(res, 500, 'Failed to clear SOS', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/sos/seen — "seen by" ack ───────────────────────
  router.post(
    '/:crewId/sos/seen',
    userAuth,
    rateLimit(60, 'crew-sos-seen'),
    validateParams(schemas.crewIdParams),
    validate(schemas.sosSeen),
    async (req: Request, res: Response) => {
      try {
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const body = req.validatedBody as z.infer<typeof sosSeenSchema>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;
        const username = req.user.username || 'A crew member';
        const { raiserId } = body;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        // The raiser never counts as a viewer of their own SOS.
        if (raiserId === userId) return sendSuccess(res, { seenBy: await listSosSeen(redis, crewId, raiserId) });

        // `null` = Redis down: carry on so the raiser still hears the ack live.
        if ((await isSosActive(redis, crewId, raiserId)) === false) {
          return sendError(res, 404, 'That SOS is no longer active.', ErrorCodes.NOT_FOUND);
        }

        const seenBy = (await markSosSeen(redis, crewId, raiserId, { userId, username })) ?? [{ userId, username }];
        if (io) io.to('crew:' + crewId).emit('sos:seen', { _v: 1, crewId, raiserId, seenBy });
        return sendSuccess(res, { seenBy });
      } catch (err) {
        log.error('sos seen failed', { error: (err as Error).message, crewId: (req.validatedParams as any)?.crewId });
        return sendError(res, 500, 'Failed to mark SOS seen', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /:crewId/sos — active SOS entries (late-joiner read) ─────
  router.get(
    '/:crewId/sos',
    userAuth,
    rateLimit(60, 'crew-sos-list'),
    validateParams(schemas.crewIdParams),
    async (req: Request, res: Response) => {
      try {
        // SOS positions must never be cached (browser, proxy or service worker).
        res.setHeader('Cache-Control', 'no-store');
        if (config?.SOS_ENABLED === false) return sendSuccess(res, { sos: [] });
        const params = req.validatedParams as z.infer<typeof crewIdParams>;
        const crewId = sanitizeIdentifier(params.crewId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const entries = await listActiveSos(redis, crewId, Date.now());
        const sos = await Promise.all(
          entries.map(async (entry: any) => ({ ...entry, seenBy: await listSosSeen(redis, crewId, entry.userId) })),
        );
        return sendSuccess(res, { sos });
      } catch (err) {
        log.error('sos list failed', { error: (err as Error).message, crewId: (req.validatedParams as any)?.crewId });
        return sendError(res, 500, 'Failed to load SOS', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
