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
import { adminAnalyticsQuery, festivalIdParams, validateParams, validateQuery } from '../lib/schemas.js';
import { renderStatusPage } from '../lib/helpers/status-template.js';
import { overlappingClashes } from '../lib/helpers/pick-clashes.js';
import type { Router } from 'express';

// "In scope": festival not deleted, plan not deleted, user not deleted, and the
// festival equals $1 when $1 is not NULL. Crew members count only live users.
const TOTALS_SQL = `
  WITH
    f AS (
      SELECT id FROM festivals
      WHERE deleted_at IS NULL AND ($1::TEXT IS NULL OR id = $1::TEXT)
    ),
    p AS (
      SELECT fp.id, fp.user_id
      FROM festival_profiles fp
        JOIN f ON f.id = fp.festival_id
        JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
      WHERE fp.deleted_at IS NULL
    ),
    pk AS (
      SELECT fpp.profile_id, fpp.priority, p.user_id
      FROM festival_profile_picks fpp JOIN p ON p.id = fpp.profile_id
    ),
    c AS (SELECT cr.id FROM crews cr JOIN f ON f.id = cr.festival_id),
    cm AS (
      SELECT m.crew_id, m.user_id
      FROM crew_members m
        JOIN c ON c.id = m.crew_id
        JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
    )
  SELECT
    (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL) AS "signedUp",
    (SELECT COUNT(DISTINCT user_id)::int FROM p) AS "usersWithPlan",
    (SELECT COUNT(*)::int FROM p) AS "plans",
    (SELECT COUNT(DISTINCT profile_id)::int FROM pk) AS "plansWithPicks",
    (SELECT COUNT(DISTINCT user_id)::int FROM pk) AS "usersWithPick",
    (SELECT COUNT(*)::int FROM pk) AS "picks",
    (SELECT COUNT(*)::int FROM c) AS "crews",
    (SELECT COUNT(*)::int FROM cm) AS "crewMembers",
    (SELECT COUNT(DISTINCT user_id)::int FROM cm) AS "usersInCrews",
    (SELECT COUNT(*)::int FROM (SELECT crew_id FROM cm GROUP BY crew_id HAVING COUNT(*) >= 2) big) AS "crewsWithTwoPlus",
    (SELECT COUNT(*)::int FROM pk WHERE priority = 'must') AS "must",
    (SELECT COUNT(*)::int FROM pk WHERE priority = 'want-to-see') AS "want",
    (SELECT COUNT(*)::int FROM pk WHERE priority = 'maybe') AS "maybe"
`;

const TOP_SETS_SQL = `
  SELECT
    fs.artist,
    fs.stage_id AS "stageId",
    fs.start_time AS "startTime",
    fs.end_time AS "endTime",
    fs.day_index AS "dayIndex",
    fs.festival_id AS "festivalId",
    f.name AS "festivalName",
    fd.label AS "dayLabel",
    COUNT(*)::int AS "pickCount",
    (COUNT(*) FILTER (WHERE fpp.priority = 'must'))::int AS "mustCount",
    (COUNT(*) FILTER (WHERE fpp.priority = 'want-to-see'))::int AS "wantCount",
    (COUNT(*) FILTER (WHERE fpp.priority = 'maybe'))::int AS "maybeCount"
  FROM
    festival_profile_picks fpp
    JOIN festival_sets fs ON fpp.set_id = fs.id
    JOIN festival_profiles fp ON fpp.profile_id = fp.id AND fp.deleted_at IS NULL
    JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
    JOIN festivals f ON f.id = fs.festival_id AND f.deleted_at IS NULL
    LEFT JOIN festival_days fd ON fd.festival_id = fs.festival_id AND fd.day_index = fs.day_index
  WHERE $1::TEXT IS NULL OR fs.festival_id = $1::TEXT
  GROUP BY
    fs.id, fs.artist, fs.stage_id, fs.start_time, fs.end_time, fs.day_index, fs.festival_id, f.name, fd.label
  ORDER BY "pickCount" DESC
  LIMIT 20
`;

// Per-set pick counts for one festival ($1), same scope as TOP_SETS_SQL.
const SET_PICK_COUNTS_SQL = `
  SELECT
    fpp.set_id AS "setId",
    COUNT(*)::int AS picks,
    (COUNT(*) FILTER (WHERE fpp.priority = 'must'))::int AS must,
    (COUNT(*) FILTER (WHERE fpp.priority = 'want-to-see'))::int AS want,
    (COUNT(*) FILTER (WHERE fpp.priority = 'maybe'))::int AS maybe
  FROM festival_profile_picks fpp
    JOIN festival_profiles fp ON fp.id = fpp.profile_id AND fp.festival_id = $1 AND fp.deleted_at IS NULL
    JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
  GROUP BY fpp.set_id
`;

// Same-day set pairs that $2 or more distinct users picked. The floor is applied
// here so no client ever receives a smaller pair; overlap is checked in the route.
const CO_PICKED_PAIRS_SQL = `
  WITH pk AS (
    SELECT DISTINCT fp.user_id, fs.id AS set_id, fs.day_index
    FROM festival_profile_picks fpp
      JOIN festival_profiles fp ON fp.id = fpp.profile_id AND fp.festival_id = $1 AND fp.deleted_at IS NULL
      JOIN users u ON u.id = fp.user_id AND u.deleted_at IS NULL
      JOIN festival_sets fs ON fs.id = fpp.set_id AND fs.festival_id = $1
    WHERE fs.start_time IS NOT NULL AND fs.end_time IS NOT NULL
  )
  SELECT a.set_id AS "aId", b.set_id AS "bId", COUNT(*)::int AS people
  FROM pk a
    JOIN pk b ON b.user_id = a.user_id AND b.day_index = a.day_index AND b.set_id > a.set_id
  GROUP BY a.set_id, b.set_id
  HAVING COUNT(*) >= $2
`;

// Admin-only floor for clash pairs (T36 addendum); the public also-picked floor is stricter.
const CLASH_PAIR_MIN_PEOPLE = 5;

const ACTIVE_USERS_SQL = `
  SELECT
    u.id,
    u.username,
    u.avatar_key AS "avatarKey",
    COUNT(DISTINCT fp.id)::int AS "profileCount",
    COUNT(fpp.set_id)::int AS "totalPicks",
    MAX(fp.updated_at) AS "lastActive"
  FROM
    users u
    JOIN festival_profiles fp ON fp.user_id = u.id AND fp.deleted_at IS NULL
    JOIN festivals f ON f.id = fp.festival_id AND f.deleted_at IS NULL
    LEFT JOIN festival_profile_picks fpp ON fpp.profile_id = fp.id
  WHERE u.deleted_at IS NULL AND ($1::TEXT IS NULL OR fp.festival_id = $1::TEXT)
  GROUP BY u.id, u.username, u.avatar_key
  ORDER BY "lastActive" DESC NULLS LAST
  LIMIT 50
`;

const CREWS_SQL = `
  SELECT
    c.id,
    c.name,
    c.festival_id AS "festivalId",
    f.name AS "festivalName",
    COUNT(u.id)::int AS "memberCount",
    c.created_at AS "createdAt"
  FROM
    crews c
    JOIN festivals f ON f.id = c.festival_id AND f.deleted_at IS NULL
    LEFT JOIN crew_members cm ON cm.crew_id = c.id
    LEFT JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
  WHERE $1::TEXT IS NULL OR c.festival_id = $1::TEXT
  GROUP BY c.id, c.name, c.festival_id, f.name, c.created_at
  ORDER BY "memberCount" DESC
  LIMIT 20
`;

const INSTALL_SQL = `
  SELECT
    event,
    COUNT(*)::int AS n
  FROM
    install_events
  WHERE
    created_at >= NOW() - INTERVAL '30 days'
  GROUP BY
    event
`;

const FESTIVAL_STATS_SQL = `
  SELECT
    f.id,
    f.name,
    COUNT(DISTINCT fp.id)::int AS "profileCount",
    COUNT(DISTINCT fpp.set_id)::int AS "uniqueSetsPicked",
    COUNT(fpp.*)::int AS "totalPicks"
  FROM
    festivals f
    LEFT JOIN festival_profiles fp ON fp.festival_id = f.id AND fp.deleted_at IS NULL
    LEFT JOIN festival_profile_picks fpp ON fpp.profile_id = fp.id
  WHERE f.deleted_at IS NULL
  GROUP BY f.id, f.name
  ORDER BY "profileCount" DESC
`;

export default function createAdminStatusRoutes(deps: any): { router: Router } {
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

      const cspNonce = res.locals.cspNonce || '';
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

      const analyticsPool = deps.pool || stores?.pool;
      if (!analyticsPool) return res.json({ data: null, error: { message: 'Database not available' } });

      const festivalId: string | null = req.validatedQuery?.festivalId ?? null;
      let festivalName: string | null = null;
      if (festivalId) {
        const found = await analyticsPool.query(
          'SELECT name FROM festivals WHERE id = $1 AND deleted_at IS NULL',
          [festivalId],
        );
        if (found.rows.length === 0) return sendError(res, 404, 'Festival not found.', ErrorCodes.NOT_FOUND);
        festivalName = found.rows[0].name;
      }

      const params = [festivalId];
      const [totalsResult, topSetsResult, activeUsersResult, crewsResult, installResult, festivalStatsResult] =
        await Promise.all([
          analyticsPool.query(TOTALS_SQL, params),
          analyticsPool.query(TOP_SETS_SQL, params),
          analyticsPool.query(ACTIVE_USERS_SQL, params),
          analyticsPool.query(CREWS_SQL, params),
          analyticsPool.query(INSTALL_SQL),
          analyticsPool.query(FESTIVAL_STATS_SQL),
        ]);

      const { must, want, maybe, ...totals } = totalsResult.rows[0];
      const installCounts = Object.fromEntries(installResult.rows.map((r: any) => [r.event, r.n]));
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
        topSets: topSetsResult.rows,
        activeUsers: activeUsersResult.rows.map((u: any) => ({
          ...u,
          avatarKey: undefined, // don't expose avatar keys
        })),
        crews: crewsResult.rows,
        festivalStats: festivalStatsResult.rows,
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

        const insightPool = deps.pool || stores?.pool;
        if (!insightPool) return sendError(res, 503, 'Database not available', ErrorCodes.SERVICE_UNAVAILABLE);

        const { festivalId } = req.validatedParams;
        const festival = await stores.festivals.getById(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found.', ErrorCodes.NOT_FOUND);

        const [countsResult, pairsResult] = await Promise.all([
          insightPool.query(SET_PICK_COUNTS_SQL, [festivalId]),
          insightPool.query(CO_PICKED_PAIRS_SQL, [festivalId, CLASH_PAIR_MIN_PEOPLE]),
        ]);

        const counts = new Map<string, any>(countsResult.rows.map((r: any) => [r.setId, r]));
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
          clashes: overlappingClashes(festival, pairsResult.rows),
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
