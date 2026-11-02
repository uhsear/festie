// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// AUDIT FIX (2026-04-14, DEFERRED FIX AGENT 1):
//   Added per-email password-reset limiter (`passwordResetRateLimit`) to
//   `/users/:id/reset-link` alongside the existing `adminWriteLimit`. Preserves
//   Agent E's earlier edits:
//     - PUBLIC_ORIGIN throw on /users/:id/reset-link (lines guarded below)
//     - SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET config reads on
//       /festivals/:id/backfill-spotify
//   Also owns GET /festivals/:id/set-engagement (per-set picks and reminders).
//
// AUDIT FIX (2026-04-14, DEFERRED FIX AGENT 6):
//   Split 716-line file into four modules. This file now owns the dashboard +
//   Spotify-backfill routes and delegates user/role, audit, and bulk/crew
//   moderation routes to sibling modules. Factory signature, deps contract,
//   and resulting router shape are byte-identical to the pre-split version.
//
//   Sub-routers mounted here (in original declaration order):
//     ./admin-users.js   → /users, /users/:id/roles, /users/:id/reset-link,
//                          /users/:id/reset-password, /users/:id
//     ./admin-audit.js   → /audit
//     ./admin-bulk.js    → /bulk/*, /crews, /crews/:id(/members(/:userId)?)?
//
//   Agent 1's passwordResetRateLimit is constructed here and passed via `ctx`
//   so admin-users.js can attach it to the reset routes.
import crypto from 'crypto';
import { createPasswordResetRateLimit } from '../lib/rate-limiting.js';
import { parsePageParams, paginateArray } from '../lib/pagination.js';
import mountAdminUserRoutes from './admin-users.js';
import mountAdminAuditRoutes from './admin-audit.js';
import mountAdminBulkRoutes from './admin-bulk.js';
import * as spotify from '../lib/spotify.js';
import { sanitizeLinkRecord, spotifyBackfillSchema } from '../lib/schemas.js';
import { AUDIT_ACTION_CREW_ADD_MEMBER, AUDIT_ACTION_USER_PRIVATE_DATA_VIEWED } from '../lib/db/stores/audit.js';
import type { Router } from 'express';

export default function createAdminRoutes(deps: any): Router {
  const {
    express,
    config,
    log,
    getUsers,
    getProfiles,
    getFestivals,
    setNoStore,
    sendSuccess,
    sendError,
    ErrorCodes,
    adminAuth,
    getRequestIp,
    io,
    stores,
    _invalidateFestivalCache,
    rateLimit,
    schemas,
    validateQuery,
  } = deps;

  const router = express.Router();
  const adminWriteLimit = rateLimit(config.ADMIN_WRITE_RATE_LIMIT_MAX, 'admin-write');
  const passwordResetRateLimit = createPasswordResetRateLimit(config, {
    log,
    sendError,
    ErrorCodes,
    redis: deps.redis,
  });

  // Audit action name normalization map
  const ACTION_FRIENDLY_MAP: Record<string, string> = {
    admin_delete_user: 'Delete User',
    admin_reset_link: 'Reset Password Link',
    admin_reset_password: 'Reset Password',
    role_grant: 'Grant Role',
    role_revoke: 'Revoke Role',
    bulk_deactivate: 'Bulk Deactivate',
    force_logout: 'Force Logout',
    bulk_archive: 'Bulk Archive Festivals',
    'create:token': 'Create Token',
    'create:verify': 'Verify Email',
    register: 'User Registered',
    login: 'User Logged In',
    festival_create: 'Festival Created',
    festival_update: 'Festival Updated',
    festival_delete: 'Festival Deleted',
    'festival:create': 'Festival Created',
    'festival:update': 'Festival Updated',
    'festival:soft-delete': 'Festival Deleted',
    'festival:hard-delete': 'Festival Deleted Permanently',
    'festival:publish': 'Festival Published',
    'festival:restore': 'Festival Restored',
    'set:link-update': 'Set Link Changed',
    lineup_import: 'Lineup Imported',
    spotify_backfill: 'Spotify Backfill',
    'delete:users': 'Delete User',
    [AUDIT_ACTION_USER_PRIVATE_DATA_VIEWED]: 'View User Details',
    [AUDIT_ACTION_CREW_ADD_MEMBER]: 'Add Crew Member',
    crew_remove_member: 'Remove Crew Member',
    crew_delete: 'Delete Crew',
  };

  const getFriendlyAction = (action: string) => ACTION_FRIENDLY_MAP[action] || action;

  // One place adds the display fields to audit rows, so the audit list and the
  // user detail page show the same actor names. An unknown actor falls back to its id.
  const enrichAuditEntries = async (rows: any[]) => {
    const users = await getUsers();
    const usernameById = new Map<string, string>(users.map((u: any) => [u.id, u.username]));
    return rows.map((row: any) => ({
      ...row,
      friendlyAction: getFriendlyAction(row.action),
      actorUsername: usernameById.get(row.actorId) || row.actorId,
      targetLabel: row.details?.targetUsername || row.details?.name || `${row.targetType} ${row.targetId ?? ''}`.trim(),
    }));
  };

  // Collapse consecutive audit entries with same action+actorId within 5-minute window
  const groupAuditActivity = (entries: any[]) => {
    if (!entries || entries.length === 0) return [];
    const grouped: any[] = [];
    let current: any = null;

    for (const entry of entries) {
      if (
        current &&
        current.action === entry.action &&
        current.actorId === entry.actorId &&
        new Date(entry.createdAt).getTime() - new Date(current.createdAt).getTime() < 5 * 60 * 1000
      ) {
        current.count = (current.count || 1) + 1;
        current.createdAt = entry.createdAt; // Update to most recent
      } else {
        if (current) grouped.push(current);
        current = { ...entry, count: 1 };
      }
    }
    if (current) grouped.push(current);
    return grouped;
  };

  // POST /login, /verify, /logout removed — admin auth is role-based via user session (v2.1)

  // ── GET /dashboard — aggregated stats for admin dashboard ────────────
  router.get('/dashboard', adminAuth, async (req: any, res: any) => {
    try {
      setNoStore(res);
      const mem = process.memoryUsage();
      const pgPool = stores.pool;
      const poolStats = pgPool
        ? {
            totalCount: pgPool.totalCount,
            idleCount: pgPool.idleCount,
            waitingCount: pgPool.waitingCount,
          }
        : null;

      const [users, festivals, profiles, recentActivity] = await Promise.all([
        getUsers(),
        getFestivals(),
        getProfiles(),
        stores.auditLog.query({ limit: 20, actorType: 'admin' }).then(({ rows }: any) => rows),
      ]);

      // Build username map from users for activity resolution
      const userMap = new Map();
      for (const user of users) {
        userMap.set(user.id, user.username);
      }

      // Count total picks across all profiles
      let totalPicks = 0;
      for (const profile of profiles) {
        totalPicks += Object.keys(profile.picks || {}).length;
      }

      // Resolve actorId to username and add friendlyAction for each activity entry
      const enrichedActivity = recentActivity.map((a: any) => ({
        id: a.id,
        action: a.action,
        friendlyAction: getFriendlyAction(a.action),
        actorType: a.actorType,
        actorId: a.actorId,
        actorUsername: userMap.get(a.actorId) || a.actorId,
        targetType: a.targetType,
        targetId: a.targetId,
        details: a.details,
        createdAt: a.createdAt,
      }));

      // Group activity for frontend aggregation support
      const groupedActivity = groupAuditActivity(
        enrichedActivity.map((a: any) => ({
          ...a,
          count: 1,
        })),
      );

      return sendSuccess(res, {
        stats: {
          users: users.length,
          festivals: festivals.length,
          profiles: profiles.length,
          picks: totalPicks,
        },
        health: {
          uptime: Math.round(process.uptime()),
          memory: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          },
          database: poolStats,
          connections: io.engine?.clientsCount || 0,
          onlineRooms: deps.state.onlineUsers.size,
        },
        recentActivity: enrichedActivity,
        groupedActivity,
      });
    } catch (error: any) {
      log.error('admin dashboard load failed', { error: error.message });
      return sendError(res, 500, 'Failed to load dashboard', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Mount sibling route modules in original declaration order.
  // Declaration order matters only because Express matches in the order
  // registered — all paths here are unique so order-reshuffling within a
  // single router is safe, but we preserve the original order to make diffs
  // trivial to audit.
  const ctx = {
    adminWriteLimit,
    passwordResetRateLimit,
    crypto,
    parsePageParams,
    paginateArray,
    getFriendlyAction,
    enrichAuditEntries,
  };
  mountAdminUserRoutes({ router, deps, ctx }); // /users, /users/:id/*
  mountAdminAuditRoutes({ router, deps, ctx }); // /audit
  mountAdminBulkRoutes({ router, deps, ctx }); // /bulk/*, /crews*

  // ── GET /ref-counts — anonymous sign-ups per ?ref= source (migration 070) ──
  router.get('/ref-counts', adminAuth, validateQuery(schemas.adminRefCountsQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const { rows } = await stores.pool.query(
        `
  SELECT
    to_char(day, 'YYYY-MM-DD') AS day,
    ref,
    signups
  FROM
    signup_ref_counts
  WHERE
    day > CURRENT_DATE - $1::int
  ORDER BY
    day DESC,
    signups DESC,
    ref ASC
`,
        [req.validatedQuery.days],
      );
      return sendSuccess(res, rows);
    } catch (error: any) {
      log.error('admin ref counts failed', { error: error.message });
      return sendError(res, 500, 'Failed to load sign-up ref counts', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /festivals/:id/backfill-spotify — auto-populate link_url via Spotify ──
  // Preserves Agent E's SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET config reads.
  router.post('/festivals/:id/backfill-spotify', adminAuth, adminWriteLimit, async (req: any, res: any) => {
    try {
      setNoStore(res);
      const parsed = spotifyBackfillSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const message = issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
        return sendError(res, 400, message, ErrorCodes.VALIDATION_ERROR);
      }
      const spotifyClientId = config.SPOTIFY_CLIENT_ID;
      const spotifyClientSecret = config.SPOTIFY_CLIENT_SECRET;
      if (!spotifyClientId || !spotifyClientSecret) {
        return sendError(res, 400, 'Spotify API credentials not configured', ErrorCodes.INVALID_INPUT);
      }

      const festivalId = req.params.id;
      const festival = await stores.pool.query('SELECT id FROM festivals WHERE id = $1 AND deleted_at IS NULL', [
        festivalId,
      ]);
      if (festival.rows.length === 0) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      // Optional body: verified overrides (artistName -> spotifyUrl) take
      // precedence over search; `force` re-links sets that already have a link.
      const body = parsed.data;
      const force = body.force === true;
      const skipSearch = body.skipSearch === true; // overrides-only, no Spotify calls
      const setIds = body.setIds;
      const normName = (s: any) =>
        spotify
          .cleanArtistName(s)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');
      const overrideMap = new Map<string, string>();
      if (body.overrides) {
        for (const [k, v] of Object.entries(body.overrides)) {
          if (typeof v !== 'string' || !v) continue;
          // Allowlist link schemes (drop javascript:/data: etc.) before persisting.
          const safe = sanitizeLinkRecord({ spotify: v }).spotify;
          if (safe) overrideMap.set(normName(k), safe);
        }
      }
      // "Artist A B2B Artist B" sets carry one combined name; split so each
      // sub-artist can be linked individually.
      const splitB2B = (name: any) =>
        String(name || '')
          .split(/\s+b2b\s+/i)
          .map((s) => s.trim())
          .filter(Boolean);

      const setFilter = setIds ? ' AND id = ANY($2::text[])' : '';
      // Without force, also pick a B2B set where only some artists are linked:
      // link_url holds the first linked artist, so it alone hides the others.
      const missingLink = `(link_url IS NULL OR link_url = '' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(artists) = 'array' THEN artists ELSE '[]'::jsonb END) a
          WHERE COALESCE(a->'links'->>'spotify', '') = ''))`;
      const { rows: sets } = await stores.pool.query(
        force
          ? `SELECT id, artist, artists FROM festival_sets WHERE festival_id = $1${setFilter}`
          : `SELECT id, artist, artists FROM festival_sets WHERE festival_id = $1 AND ${missingLink}${setFilter}`,
        setIds ? [festivalId, setIds] : [festivalId],
      );
      if (sets.length === 0) {
        return sendSuccess(res, { updated: 0, skipped: 0, total: 0, unmatched: [], message: 'No sets to backfill' });
      }

      // Collect cleaned sub-artist names that need a search (skip overridden).
      const searchNames = new Set<string>();
      if (!skipSearch) {
        for (const set of sets) {
          const arr = set.artists?.length ? set.artists : [{ name: set.artist }];
          for (const a of arr) {
            for (const part of splitB2B(a?.name)) {
              if (overrideMap.has(normName(part))) continue;
              const cleaned = spotify.cleanArtistName(part) || part;
              if (cleaned) searchNames.add(cleaned);
            }
          }
        }
      }
      const spotifyResults: Map<string, any> = searchNames.size
        ? await spotify.bulkSearchArtists([...searchNames], spotifyClientId, spotifyClientSecret, { log })
        : new Map();

      const resolve = (rawName: any) => {
        const ov = overrideMap.get(normName(rawName));
        if (ov) return { spotifyUrl: ov };
        return spotifyResults.get(spotify.cleanArtistName(rawName) || rawName) || null;
      };

      // Cleaned names that still have no Spotify link after this run.
      const unmatched = new Set<string>();
      let updated = 0;
      for (const set of sets) {
        const arr = set.artists?.length ? set.artists : [{ name: set.artist }];
        const newArtists: any[] = [];
        let changed = false;
        for (const a of arr) {
          const parts = splitB2B(a?.name);
          if (parts.length > 1) {
            // B2B → one entry per sub-artist, each with its own link
            for (const part of parts) {
              const m = resolve(part);
              const entry: any = { name: spotify.cleanArtistName(part) || part, links: {} };
              if (m?.spotifyUrl) {
                entry.links.spotify = m.spotifyUrl;
                changed = true;
              }
              if (m?.imageUrl) entry.photo = m.imageUrl;
              if (m?.genres?.length) entry.genres = m.genres;
              if (!m?.spotifyUrl) unmatched.add(entry.name);
              newArtists.push(entry);
            }
          } else {
            const m = resolve(a?.name);
            const entry: any = { ...a, links: { ...(a?.links || {}) } };
            if (m?.spotifyUrl && (force || !entry.links.spotify)) {
              entry.links.spotify = m.spotifyUrl;
              changed = true;
            }
            if (m?.imageUrl && !entry.photo) entry.photo = m.imageUrl;
            if (m?.genres?.length && !entry.genres?.length) entry.genres = m.genres;
            if (!m?.spotifyUrl && !entry.links.spotify) unmatched.add(spotify.cleanArtistName(a?.name) || a?.name);
            newArtists.push(entry);
          }
        }
        if (changed) {
          const firstSpotify = newArtists.find((x) => x.links?.spotify)?.links.spotify || null;
          await stores.pool.query(
            'UPDATE festival_sets SET artists = $1, link_url = COALESCE($2, link_url) WHERE id = $3',
            [JSON.stringify(newArtists), firstSpotify, set.id],
          );
          updated++;
        }
      }

      // Bump the festival timestamp so the list/detail cache (keyed on
      // updated_at) actually invalidates — set updates alone don't change it.
      if (updated > 0) {
        await stores.pool.query('UPDATE festivals SET updated_at = NOW() WHERE id = $1', [festivalId]);
      }
      if (_invalidateFestivalCache) _invalidateFestivalCache();
      const unmatchedList = [...unmatched]
        .filter(Boolean)
        .sort((x, y) => x.localeCompare(y))
        .slice(0, 200);
      log.info('spotify backfill complete', {
        festivalId,
        updated,
        skipped: sets.length - updated,
        ip: getRequestIp(req),
      });
      if (stores.auditLog) {
        await stores.auditLog.insert({
          actorType: 'admin',
          actorId: req.user?.userId,
          action: 'spotify_backfill',
          targetType: 'festival',
          targetId: festivalId,
          detailsJson: JSON.stringify({
            updated,
            skipped: sets.length - updated,
            total: sets.length,
            setIds: setIds?.length ?? null,
            unmatched: unmatchedList.length,
          }),
          ip: getRequestIp(req),
        });
        // eslint-disable-next-line require-atomic-updates -- res is request-scoped
        res.locals.auditWritten = true;
      }
      return sendSuccess(res, {
        updated,
        skipped: sets.length - updated,
        total: sets.length,
        unmatched: unmatchedList,
      });
    } catch (error: any) {
      log.error('spotify backfill failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Spotify backfill failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /festivals/:id/set-engagement — picks and reminders per set ──
  // Reminders live in festival_profiles.reminders_json (no table since migration 013).
  router.get('/festivals/:id/set-engagement', adminAuth, async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = req.params.id;
      const festival = await stores.pool.query('SELECT id FROM festivals WHERE id = $1 AND deleted_at IS NULL', [
        festivalId,
      ]);
      if (festival.rows.length === 0) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      const [picks, reminders] = await Promise.all([
        stores.pool.query(
          `
  SELECT
    fpp.set_id AS "setId",
    COUNT(*)::int AS picks
  FROM
    festival_profile_picks fpp
    JOIN festival_profiles fp ON fp.id = fpp.profile_id
  WHERE
    fp.festival_id = $1
    AND fp.deleted_at IS NULL
  GROUP BY
    fpp.set_id
`,
          [festivalId],
        ),
        stores.pool.query(
          `SELECT k AS "setId", COUNT(*)::int AS reminders
           FROM festival_profiles fp,
                jsonb_object_keys(fp.reminders_json) AS k
           WHERE fp.festival_id = $1 AND fp.deleted_at IS NULL
             AND jsonb_typeof(fp.reminders_json) = 'object'
           GROUP BY k`,
          [festivalId],
        ),
      ]);
      // A Map, because reminder keys come from user data and could be "__proto__".
      const engagement = new Map<string, { picks: number; reminders: number }>();
      for (const row of picks.rows) engagement.set(row.setId, { picks: row.picks, reminders: 0 });
      for (const row of reminders.rows) {
        engagement.set(row.setId, { picks: engagement.get(row.setId)?.picks ?? 0, reminders: row.reminders });
      }
      return sendSuccess(res, Object.fromEntries(engagement));
    } catch (error: any) {
      log.error('admin set engagement failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to load set engagement', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
