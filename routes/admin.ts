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
import mountAdminPolicyNoticeRoutes from './admin-policy-notice.js';
import * as spotify from '../lib/spotify.js';
import { sanitizeLinkRecord, spotifyBackfillSchema } from '../lib/schemas.js';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { withTransactionRetry } from '../lib/db/connection.js';
import { lockFestivalAny } from '../lib/db/stores/lineup-imports.js';
import { rewriteCopies, type ArtistRecord } from '../lib/db/stores/artists.js';
import { recentRequestTotals } from '../lib/recent-requests.js';
import type { Router } from 'express';

// Re-engagement news types the growth report counts. Add a type here when it joins the news set.
const GROWTH_NEWS_TYPES = ['lineup_drop', 'set_times_out', 'days_out'];

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
    paramKey: 'id',
  });

  // One place adds the display fields to audit rows, so the audit list and the
  // user detail page show the same actor names. An unknown actor falls back to its id.
  const enrichAuditEntries = async (rows: any[]) => {
    const users = await getUsers();
    const usernameById = new Map<string, string>(users.map((u: any) => [u.id, u.username]));
    return rows.map((row: any) => ({
      ...row,
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

      // Resolve actorId to username for each activity entry
      const enrichedActivity = recentActivity.map((a: any) => ({
        id: a.id,
        action: a.action,
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
          recent: recentRequestTotals(deps.state?.metrics),
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
    enrichAuditEntries,
  };
  mountAdminUserRoutes({ router, deps, ctx }); // /users, /users/:id/*
  mountAdminAuditRoutes({ router, deps, ctx }); // /audit
  mountAdminBulkRoutes({ router, deps, ctx }); // /bulk/*, /crews*
  mountAdminPolicyNoticeRoutes({ router, deps, ctx }); // /policy-notice

  const REF_COUNTS_SQL = `
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
`;

  // ── GET /ref-counts — anonymous sign-ups per ?ref= source (migration 070) ──
  router.get('/ref-counts', adminAuth, validateQuery(schemas.adminRefCountsQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const { rows } = await stores.pool.query(REF_COUNTS_SQL, [req.validatedQuery.days]);
      return sendSuccess(res, rows);
    } catch (error: any) {
      log.error('admin ref counts failed', { error: error.message });
      return sendError(res, 500, 'Failed to load sign-up ref counts', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /growth — read-only growth report: sign-ups by ref, follows, and people reached by news pushes, emails and held pushes ──
  // Every ref count is a floor: mobile sign-ups and visitors who cleared storage carry no ref.
  router.get('/growth', adminAuth, validateQuery(schemas.adminRefCountsQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const days = [req.validatedQuery.days];
      const dayOf = (column: string) => `to_char(${column}::date, 'YYYY-MM-DD')`;
      const [signups, followsPerDay, followers, news] = await Promise.all([
        stores.pool.query(REF_COUNTS_SQL, days),
        stores.pool.query(
          `SELECT ${dayOf('ff.created_at')} AS day, ff.festival_id AS "festivalId", f.name AS "festivalName", COUNT(*)::int AS follows
           FROM festival_follows ff JOIN festivals f ON f.id = ff.festival_id
           WHERE ff.created_at >= CURRENT_DATE - ($1::int - 1)
           GROUP BY 1, 2, 3 ORDER BY 1 DESC, 4 DESC, 3 ASC`,
          days,
        ),
        stores.pool.query(
          `
  SELECT
    ff.festival_id AS "festivalId",
    f.name AS "festivalName",
    COUNT(*)::int AS followers
  FROM
    festival_follows ff
    JOIN festivals f ON f.id = ff.festival_id
  GROUP BY
    1,
    2
  ORDER BY
    3 DESC,
    2 ASC
`,
        ),
        // People, not rows: send.ts logs one row per device and reengagement.ts one per email.
        stores.pool.query(
          `
  SELECT
    type,
    CASE
      WHEN status = 'held' THEN 'held'
      WHEN platform = 'email' THEN 'email'
      ELSE 'push'
    END AS channel,
    COUNT(DISTINCT user_id)::int AS count
  FROM
    notification_log
  WHERE
    type = ANY ($2::text[])
    AND status IN ('sent', 'held')
    AND created_at >= CURRENT_DATE - ($1::int - 1)
  GROUP BY
    1,
    2
  ORDER BY
    1 ASC,
    2 ASC
`,
          [...days, GROWTH_NEWS_TYPES],
        ),
      ]);
      const newsBy = (channel: string) =>
        news.rows.filter((row: any) => row.channel === channel).map(({ type, count }: any) => ({ type, count }));
      return sendSuccess(res, {
        days: req.validatedQuery.days,
        signupsByRef: signups.rows,
        followsPerDay: followsPerDay.rows,
        followers: followers.rows,
        newsPushes: newsBy('push'),
        newsEmails: newsBy('email'),
        newsHeld: newsBy('held'),
        generatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      log.error('admin growth report failed', { error: error.message });
      return sendError(res, 500, 'Failed to load the growth report', ErrorCodes.INTERNAL_ERROR);
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
      // precedence over search. A guess never replaces a link, and never touches an artist that
      // other festivals list: those artists are edited on the Artists tab.
      const body = parsed.data;
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
      // Also pick a B2B set where only some artists are linked:
      // link_url holds the first linked artist, so it alone hides the others.
      const missingLink = `(link_url IS NULL OR link_url = '' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(artists) = 'array' THEN artists ELSE '[]'::jsonb END) a
          WHERE COALESCE(a->'links'->>'spotify', '') = ''))`;
      const { rows: sets } = await stores.pool.query(
        `SELECT id, artist, artists FROM festival_sets WHERE festival_id = $1 AND ${missingLink}${setFilter}`,
        setIds ? [festivalId, setIds] : [festivalId],
      );
      if (sets.length === 0) {
        return sendSuccess(res, { updated: 0, skipped: 0, total: 0, unmatched: [], message: 'No sets to backfill' });
      }
      // Artists that sit on another festival too, archived ones included, are left alone and listed.
      // This read only spares the searches: the transaction checks again under the locks.
      const elementIds: string[] = sets.flatMap((set: any) => (set.artists ?? []).map((a: any) => a?.id).filter(Boolean));
      const sharedIds: Set<string> = await stores.artists.sharedElsewhere(festivalId, [...new Set(elementIds)]);
      const skippedShared = new Set<string>();

      // Collect cleaned sub-artist names that need a search (skip overridden).
      const searchNames = new Set<string>();
      if (!skipSearch) {
        for (const set of sets) {
          const arr = set.artists?.length ? set.artists : [{ name: set.artist }];
          for (const a of arr) {
            if (a?.id && sharedIds.has(a.id)) continue;
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
      const writes: Array<{ id: string; before: string; artists: any[] }> = [];
      const fills = new Map<any, { spotifyUrl?: string; photo?: string; genres?: string[]; original: any }>();
      for (const set of sets) {
        const arr = set.artists?.length ? set.artists : [{ name: set.artist }];
        const newArtists: any[] = [];
        let changed = false;
        for (const a of arr) {
          if (a?.id && sharedIds.has(a.id)) {
            skippedShared.add(a.name);
            newArtists.push(a);
            continue;
          }
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
            if (m?.spotifyUrl && !entry.links.spotify) {
              entry.links.spotify = m.spotifyUrl;
              changed = true;
            }
            if (m?.imageUrl && !entry.photo) entry.photo = m.imageUrl;
            if (m?.genres?.length && !entry.genres?.length) entry.genres = m.genres;
            if (!m?.spotifyUrl && !entry.links.spotify) unmatched.add(spotify.cleanArtistName(a?.name) || a?.name);
            // An artist that has a row takes the guess into the row, not only into this copy.
            if (entry.id) fills.set(entry, { spotifyUrl: m?.spotifyUrl, photo: m?.imageUrl, genres: m?.genres, original: a });
            newArtists.push(entry);
          }
        }
        if (changed) writes.push({ id: set.id, before: JSON.stringify(set.artists ?? []), artists: newArtists });
      }

      // One transaction under the festival lock. Artist rows lock after it, in id order. A set that
      // changed since it was read is left for the next run.
      let updated = 0;
      if (writes.length > 0) {
        updated = await withTransactionRetry(stores.pool, async (client: any) => {
          const locked = await lockFestivalAny(client, festivalId);
          if (!locked || locked.deleted_at) return 0;
          const { rows: current } = await client.query(
            'SELECT id, artists FROM festival_sets WHERE festival_id = $1 AND id = ANY($2::text[]) FOR UPDATE',
            [festivalId, writes.map((w) => w.id)],
          );
          const unchanged = new Set(
            current.filter((row: any) => JSON.stringify(row.artists ?? []) === writes.find((w) => w.id === row.id)?.before).map((row: any) => row.id),
          );
          const fillIds = [
            ...new Set(writes.filter((w) => unchanged.has(w.id)).flatMap((w) => w.artists.filter((e) => fills.has(e)).map((e) => e.id as string))),
          ].sort();
          if (fillIds.length > 0) await client.query('SELECT id FROM artists WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE', [fillIds]);
          // Under the festival and artist locks no save can add an artist to another festival unseen, so
          // this is the check that counts. A shared artist keeps the copy the set already holds.
          const sharedNow = await stores.artists.sharedElsewhere(festivalId, fillIds, client);
          let written = 0;
          const refreshed: ArtistRecord[] = [];
          for (const write of writes) {
            if (!unchanged.has(write.id)) continue;
            write.artists = write.artists.map((entry) => {
              const fill = fills.get(entry);
              if (!fill || !sharedNow.has(entry.id)) return entry;
              skippedShared.add(entry.name);
              return fill.original;
            });
            if (JSON.stringify(write.artists) === write.before) continue;
            for (const entry of write.artists) {
              const fill = fills.get(entry);
              if (!fill) continue;
              const filled = await stores.artists.fillEmpty(client, entry.id, fill, { userId: req.user?.userId ?? null, ip: getRequestIp(req) });
              if (!filled) continue;
              Object.assign(entry, { links: { ...(filled.artist.links ?? {}) } });
              if (filled.artist.photo) entry.photo = filled.artist.photo;
              if (filled.artist.genres?.length) entry.genres = filled.artist.genres;
              if (filled.skippedSpotify) unmatched.add(entry.name);
              if (filled.changed) refreshed.push(filled.artist);
            }
            const firstSpotify = write.artists.find((x) => x.links?.spotify)?.links.spotify || null;
            await client.query('UPDATE festival_sets SET artists = $1, link_url = COALESCE($2, link_url) WHERE id = $3', [
              JSON.stringify(write.artists),
              firstSpotify,
              write.id,
            ]);
            written++;
          }
          // The row is the truth: the artist's copy in the announced lineup and in sets this run left out follows it.
          for (const artist of refreshed) await rewriteCopies(client, [festivalId], artist);
          // Bump the festival timestamp so the list/detail cache (keyed on updated_at) invalidates.
          if (written > 0) await client.query('UPDATE festivals SET updated_at = NOW(), edited_at = NOW() WHERE id = $1', [festivalId]);
          return written;
        });
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
          action: AUDIT_ACTIONS.SPOTIFY_BACKFILLED,
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
        // On other festivals too: add their links on the Artists tab.
        skippedShared: [...skippedShared].sort((x, y) => x.localeCompare(y)).slice(0, 200),
      });
    } catch (error: any) {
      if (error?.code === 'SPOTIFY_RATE_LIMITED') {
        return sendError(res, 503, 'Spotify is busy right now. Try again in a minute.', ErrorCodes.SPOTIFY_RATE_LIMITED);
      }
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
