/**
 * Install funnel analytics — lightweight event capture for PWA install events.
 * POST /api/v1/analytics/install  { platform, event, reason?, engagement_ms? }
 *
 * Events: shown | accepted | dismissed | native_fired | inapp_blocked
 * Platform: ios | android | desktop
 *
 * Rate-limited per IP via the shared rateLimit middleware. No auth required
 * (captures anon first-visit events).
 */

import { Router } from 'express';
import { installEventSchema, validate } from '../lib/schemas.js';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { RouteDeps } from '../lib/types';

export default function createAnalyticsInstallRoutes(deps: RouteDeps) {
  const { log, stores, rateLimit } = deps;
  const router = Router();

  const limiter = rateLimit(60, 'install-analytics');

  router.post('/install', limiter, validate(installEventSchema), async (req: Request, res: Response) => {
    try {
      const { platform, event, reason, engagement_ms } = req.validatedBody as z.infer<typeof installEventSchema>;

      const ua = (req.get('user-agent') || '').slice(0, 500);
      const reasonClean = reason === undefined ? null : reason.trim().slice(0, 64);
      const engagementMs = engagement_ms !== undefined && Number.isFinite(engagement_ms)
        ? Math.min(Math.max(0, engagement_ms | 0), 86_400_000)
        : null;

      // Prefer store if available, else raw pool query via deps
      const pool = deps.pool || (stores && stores.pool) || null;
      if (!pool) {
        // No persistence available — silently accept to avoid breaking client
        return res.status(204).end();
      }

      await pool.query(
        `
  INSERT INTO
    install_events (
      platform,
      event,
      reason,
      engagement_ms,
      user_agent,
      created_at
    )
  VALUES
    ($1, $2, $3, $4, $5, NOW())
`,
        [platform, event, reasonClean, engagementMs, ua]
      );

      res.status(204).end();
    } catch (err) {
      // Never fail the request path on analytics errors
      if (log && log.warn) log.warn('install analytics error', { message: err && (err as NodeJS.ErrnoException).message, code: err && (err as NodeJS.ErrnoException).code });
      res.status(204).end();
    }
  });

  return router;
}
