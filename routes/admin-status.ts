// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// Admin status & analytics routes (split from routes/health.js on 2026-04-14):
//   GET /admin/health              — JSON system status (admin-auth)
//   GET /admin/status              — HTML dashboard (admin-auth, strict nonce CSP)
//   GET /admin/analytics           — aggregated festival analytics JSON (admin-auth)
//   GET /admin/analytics/festivals/:festivalId/picks — per-set pick counts and clashing pairs (admin-auth)
//
// The strict nonce CSP helper lives here because the HTML status route in
// this file needs it. If another file ever needs the same policy, promote it
// to lib/csp-helpers.js.
import { randomBytes } from 'node:crypto';
import { adminAnalyticsQuery, festivalIdParams, validateParams, validateQuery } from '../lib/schemas.js';
import { renderStatusPage } from '../lib/helpers/status-template.js';
import { overlappingClashes } from '../lib/helpers/pick-clashes.js';
import type { Router } from 'express';
import type { RouteDeps } from '../lib/types';

// Admin-only floor for clash pairs (T36 addendum); the public also-picked floor is stricter.
const CLASH_PAIR_MIN_PEOPLE = 5;

export default function createAdminStatusRoutes(deps: RouteDeps): { router: Router } {
  const {
    express,
    adminAuth, setNoStore,
    getUsers: _getUsers, getFestivals, getProfiles, io, stores, state, pool,
    sendSuccess, sendError, ErrorCodes, log, config,
  } = deps;

  const router = express.Router();

  router.get('/admin/env', adminAuth, (_req: any, res: any) => {
    setNoStore(res);
    return sendSuccess(res, { label: config.FESTIE_ENV_LABEL || null });
  });

  // Strict nonce-based CSP for HTML routes served from this module. Replaces
  // an earlier per-route CSP that whitelisted 'unsafe-inline' and silently
  // undermined the global nonce policy (audit fix 2026-04-14). Any inline
  // <style>/<script> in these handlers must carry `nonce="${cspNonce}"`.
  function buildStrictNonceCSP(nonce: string) {
    const nonceDir = nonce ? `'nonce-${nonce}'` : "'self'";
    return [
      "default-src 'self'",
      `script-src 'self' ${nonceDir}`,
      `style-src 'self' ${nonceDir}`,
      "img-src 'self' data: https:",
      "connect-src 'self' wss: https:",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ].join('; ');
  }

  router.get('/admin/health', adminAuth, async (req: any, res: any) => {
    try {
    setNoStore(res);
    const mem = process.memoryUsage();

    const metrics = deps.metrics;

    // PostgreSQL connection pool stats
    const pgPool = pool || stores?.pool;
    const poolStats = pgPool ? {
      totalCount: pgPool.totalCount,
      idleCount: pgPool.idleCount,
      waitingCount: pgPool.waitingCount,
    } : null;

    return sendSuccess(res, {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      },
      connections: io.engine?.clientsCount || 0,
      users: await stores.users.countActive(),
      festivals: (await getFestivals()).length,
      profiles: (await getProfiles()).length,
      onlineRooms: state.onlineUsers.size,
      rateLimits: {
        api: state.rateLimits.size,
        auth: state.authRateLimits.size,
        adminAuth: state.adminAuthRateLimits.size,
        socketConnect: state.socketConnectRateLimits?.size || 0,
      },
      database: poolStats,
      requests: metrics ? {
        total: metrics.totalRequests,
        errors: metrics.totalErrors,
        avgDurationMs: metrics.requestCount > 0
          ? Math.round(metrics.totalDuration / metrics.requestCount)
          : 0,
        statusCodes: { ...metrics.statusCodes },
      } : null,
      sockets: metrics ? {
        totalConnections: metrics.socketConnections || 0,
        totalDisconnections: metrics.socketDisconnections || 0,
        transportErrors: metrics.socketErrors || 0,
        peakConcurrent: metrics.peakConnections || 0,
      } : null,
      startedAt: metrics?.startedAt || null,
    });
    } catch (error: any) {
      log.error('admin health failed', { error: error.message });
      return sendError(res, 500, 'Failed to generate health data', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Admin status page — HTML dashboard view
  router.get('/admin/status', adminAuth, async (req: any, res: any) => {
    try {
      setNoStore(res);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      const cspNonce = res.locals.cspNonce || randomBytes(16).toString('base64');
      res.setHeader('Content-Security-Policy', buildStrictNonceCSP(cspNonce));

      const uptime = Math.round(process.uptime());
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const mins = Math.floor((uptime % 3600) / 60);
      const secs = uptime % 60;
      let uptimeStr;
      if (days > 0) uptimeStr = `${days}d ${hours}h ${mins}m`;
      else if (hours > 0) uptimeStr = `${hours}h ${mins}m ${secs}s`;
      else if (mins > 0) uptimeStr = `${mins}m ${secs}s`;
      else uptimeStr = `${secs}s`;

      const html = renderStatusPage({
        nonceAttr: cspNonce ? ` nonce="${cspNonce}"` : '',
        uptimeStr,
        workerId: process.pid,
        mem: process.memoryUsage(),
        connections: io.engine?.clientsCount || 0,
        onlineUsers: state.onlineUsers.size,
        totalUsers: await stores.users.countActive(),
        totalFestivals: (await getFestivals()).length,
        totalProfiles: (await getProfiles()).length,
        metrics: deps.metrics,
      });

      return res.send(html);
    } catch (error: any) {
      log.error('admin status page failed', { error: error.message });
      return sendError(res, 500, 'Failed to generate status page', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Admin analytics: true totals plus clearly sampled lists (top 20 sets,
  // latest 50 people, largest 20 crews). Every query takes $1 = the festival
  // id or NULL; signedUp, festivalStats and install ignore the filter.
  router.get('/admin/analytics', adminAuth, validateQuery(adminAnalyticsQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);

      const analytics = stores?.analytics;
      if (!analytics) return sendError(res, 503, 'Database not available', ErrorCodes.SERVICE_UNAVAILABLE);

      const festivalId: string | null = req.validatedQuery?.festivalId ?? null;
      let festivalName: string | null = null;
      if (festivalId) {
        festivalName = await analytics.festivalName(festivalId);
        if (festivalName === null) return sendError(res, 404, 'Festival not found.', ErrorCodes.NOT_FOUND);
      }

      const report = await analytics.dashboard(festivalId);
      const { must, want, maybe, ...totals } = report.totals[0];
      const installCounts = Object.fromEntries(report.install.map((r: any) => [r.event, r.n]));
      const install = {
        days: 30,
        shown: installCounts.shown ?? 0,
        accepted: installCounts.accepted ?? 0,
        dismissed: installCounts.dismissed ?? 0,
      };

      return sendSuccess(res, {
        scope: { festivalId, festivalName },
        totals,
        pickDistribution: { must, want, maybe },
        install,
        topSets: report.topSets,
        activeUsers: report.activeUsers.map((u: any) => ({
          ...u,
          avatarKey: undefined, // don't expose avatar keys
        })),
        crews: report.crews,
        festivalStats: report.festivalStats,
        generatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      log.error('analytics query failed', { error: error.message });
      return sendError(res, 500, 'Failed to load analytics', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Pick insight for one festival: every set with its pick counts, and the
  // overlapping set pairs that at least CLASH_PAIR_MIN_PEOPLE people picked.
  // Counts only; no user, username or profile id leaves this route.
  router.get(
    '/admin/analytics/festivals/:festivalId/picks',
    adminAuth,
    validateParams(festivalIdParams),
    async (req: any, res: any) => {
      try {
        setNoStore(res);

        const analytics = stores?.analytics;
        if (!analytics) return sendError(res, 503, 'Database not available', ErrorCodes.SERVICE_UNAVAILABLE);

        const { festivalId } = req.validatedParams;
        const festival = await stores.festivals.getById(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found.', ErrorCodes.NOT_FOUND);

        const insight = await analytics.pickInsight(festivalId, CLASH_PAIR_MIN_PEOPLE);

        const counts = new Map<string, any>(insight.counts.map((r: any) => [r.setId, r]));
        const stageNames = new Map<string, string>((festival.stages ?? []).map((s: any) => [s.id, s.name]));
        const sets = (festival.days ?? []).flatMap((day: any, position: number) =>
          (day.sets ?? []).map((set: any) => {
            const c = counts.get(set.id);
            return {
              setId: set.id,
              dayIndex: day.dayIndex,
              dayLabel: day.label || `Day ${position + 1}`,
              date: day.date ?? '',
              stageName: stageNames.get(set.stageId) ?? '',
              artist: set.artist ?? '',
              startTime: set.startTime || null,
              endTime: set.endTime || null,
              picks: c?.picks ?? 0,
              must: c?.must ?? 0,
              want: c?.want ?? 0,
              maybe: c?.maybe ?? 0,
            };
          }),
        );

        return sendSuccess(res, {
          festivalId: festival.id,
          festivalName: festival.name,
          minPairPeople: CLASH_PAIR_MIN_PEOPLE,
          sets,
          clashes: overlappingClashes(festival, insight.pairs),
          generatedAt: new Date().toISOString(),
        });
      } catch (error: any) {
        log.error('pick insight query failed', { error: error.message });
        return sendError(res, 500, 'Failed to load pick insight', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Satisfy lint — express is destructured for parity with siblings but only
  // express.Router() is consumed directly above.
  void express;

  return { router };
}
