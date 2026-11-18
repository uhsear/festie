// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';
import { planPickerAlerts } from '../lib/picker-alerts.js';
import { diffCancelledEntries } from '../lib/schedule-diff.js';
import { withFreshMoves } from '../lib/set-moves.js';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { coverLineup, scheduleProgress } from '../lib/lineup.js';
import { resolveArtistRefs, type RefsResult } from '../lib/artist-refs.js';
import { FestivalChangedError } from '../lib/db/stores/festivals.js';
import { ArtistError } from '../lib/db/stores/artists.js';
import { lockFestivalAny } from '../lib/db/stores/lineup-imports.js';
import { withTransactionRetry } from '../lib/db/connection.js';

export default function createFestivalsRoutes(deps: any) {
  const {
    express,
    config,
    log,
    adminAuth,
    hasRecentAuth,
    requireRecentAuth,
    getFestivals,
    getFestivalById,
    getUserById,
    validateFestivalIssues,
    publishChecklist,
    sanitizeFestivalPayload,
    removeFestivalSockets,
    getRequestIp,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    io,
    stores,
    emitter,
    schemas,
    validate,
    validateQuery,
    validateParams,
    invalidateFestivalCache,
    geocodeVenue,
  } = deps;

  const router = express.Router();

  // Fill a festival's venue coordinates from its free-text location (lib/geocode.ts),
  // during the admin save, so the response can flag a weak match. The map centres on them when nothing is
  // pinned, and the weather route needs them. Tests do not inject geocodeVenue.
  // Resolves true when the stored venue was a weak match. The flag is not stored (no column),
  // so the save response is the only place the admin sees it.
  async function fillVenueCoords(festivalId: string, location: string): Promise<boolean> {
    if (!geocodeVenue || !location?.trim()) return false;
    try {
      const found = await geocodeVenue(location);
      if (!found) {
        log.info('festival venue not found', { festivalId, location });
        return false;
      }
      const { guessed, ...coords } = found;
      // Not an admin edit of the form, so an open form keeps its token.
      const festival = await stores.festivals.update(festivalId, coords, { touchEdited: false });
      if (!festival) return false;
      invalidateFestivalCache();
      invalidateFestivalListCache();
      // A draft has no attendees, and the event goes to every socket.
      if (festival.publishedAt) emitter.festivalUpdated({ festival });
      return guessed;
    } catch (error: any) {
      log.warn('festival venue geocode failed', { festivalId, error: error.message });
      return false;
    }
  }

  // The router is mounted at /festivals and at /admin/festivals; adminAuth sets
  // req.isAdmin on the admin mount. Drafts (no publishedAt) are visible there only.
  const isAdminReq = (req: any) => req.isAdmin === true;
  const visible = (festival: any, req: any) => (festival && (festival.publishedAt || isAdminReq(req)) ? festival : null);

  // 400 with one issue per problem; `message` stays one sentence for old clients.
  // Names that fit two artists. The checklist only warns, so a failed lookup never blocks the page.
  async function ambiguousNamesOf(festival: any): Promise<number> {
    try {
      return (await stores.artists?.countAmbiguousNames(festival)) ?? 0;
    } catch (error: any) {
      log.warn('ambiguous artist names lookup failed', { error: error?.message });
      return 0;
    }
  }

  function sendIssues(res: any, issues: any[]) {
    const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
    return sendError(res, 400, `${issues[0].message}${more}`, ErrorCodes.INVALID_INPUT, { issues });
  }

  // A primary-key clash on save (an id another festival, or another festival's set, already holds) is the caller's mistake, not a server fault.
  function sendIdClash(res: any, error: any) {
    if (error?.code !== '23505') return null;
    const clashing = /Key \(id\)=\(([^)]*)\)/.exec(error.detail ?? '')?.[1];
    const what = String(error.constraint ?? '').startsWith('festival_sets') ? 'set' : 'festival';
    const message = clashing ? `A ${what} with id "${clashing}" already exists.` : `A ${what} with that id already exists.`;
    return sendError(res, 409, message, ErrorCodes.ALREADY_EXISTS);
  }

  // Two lists from one build: admins see every festival (drafts too), with
  // `published` and `updatedAt`; the public list keeps its old shape.
  let _festivalListCache: { admin: { items: any[]; etag: string }; public: { items: any[]; etag: string } } | null = null;
  let _festivalListVersion: any = null;

  function invalidateFestivalListCache() {
    _festivalListCache = null;
    _festivalListVersion = null;
  }
  // Writers outside this router (lineup import and undo) change the sets, which the list's lineupCount reads.
  deps.invalidateFestivalListCache = invalidateFestivalListCache;

  const listETag = (items: any[]) =>
    `"${crypto.createHash('md5').update(JSON.stringify(items)).digest('hex').slice(0, 16)}"`;

  /**
   * H1 (festival delete): evict members from every `crew:${crewId}` room under a
   * festival before its crews are cascaded away. removeFestivalSockets only
   * drops sockets from the festival-presence room (socket.leave(festivalId)) —
   * it does NOT touch the crew rooms, so without this every connected crew
   * member keeps receiving live location/SOS/status broadcasts for a crew whose
   * festival no longer exists, and keeps a stamped sharingCrewId, until they
   * disconnect. Mirrors the whole-crew-delete eviction in routes/admin-bulk.ts.
   *
   * Best-effort: a failure must never fail the HTTP delete (DB rows are already
   * gone / about to go); io may be absent in some test/CLI contexts.
   */
  async function evictFestivalCrewRooms(festivalId: string) {
    if (!io || typeof io.in !== 'function' || !stores.crews?.listByFestival) return;
    try {
      const crews = await stores.crews.listByFestival(festivalId);
      for (const crew of crews) {
        const crewId = crew?.id;
        if (!crewId) continue;
        const room = `crew:${crewId}`;
        io.to(room).emit('crew:deleted', { crewId, festivalId });
        const sockets = await io.in(room).fetchSockets();
        for (const s of sockets) {
          if (s.data?.sharingCrewId === crewId) delete s.data.sharingCrewId;
          delete s.data.crewMembershipCheckedAt;
          delete s.data.crewMembershipUpdateCount;
          s.leave(room);
        }
      }
    } catch (error: any) {
      log.warn('festival crew room eviction failed', { error: error?.message, festivalId });
    }
  }

  // Audit log helper — writes to audit_log table if available (async, fire-and-forget with error handling).
  // Every caller sits behind adminAuth, so the actor is the signed-in admin.
  function audit(action: any, targetType: any, targetId: any, req: any, details: any = {}) {
    if (!stores.auditLog) return;
    // Tells the generic audit middleware this request already has its row.
    if (req.res?.locals) req.res.locals.auditWritten = true;
    // Fire async without awaiting to avoid blocking HTTP response
    Promise.resolve().then(async () => {
      try {
        await stores.auditLog.insert({
          id: crypto.randomUUID(),
          actorType: 'admin',
          actorId: req.user?.userId,
          action,
          targetType,
          targetId,
          detailsJson: Object.keys(details).length > 0 ? JSON.stringify(details) : null,
          ip: getRequestIp(req),
        });
      } catch (e: any) {
        log.warn('audit log write failed', { error: e.message });
      }
    });
  }

  const setsOf = (festival: any): any[] => (festival?.days || []).flatMap((d: any) => d.sets || []);

  // Field-level before and after for the festival.updated audit row. Lists count only.
  function festivalAuditChanges(before: any, after: any, daysSent: boolean) {
    const changes: Record<string, [unknown, unknown]> = {};
    const norm = (v: unknown) => (v === undefined || v === '' ? null : v);
    for (const key of ['name', 'location', 'timeZone', 'b2bSeparator', 'seriesId']) {
      if (norm(before[key]) !== norm(after[key])) changes[key] = [norm(before[key]), norm(after[key])];
    }
    const counts: Array<[string, (f: any) => number]> = [['stages', (f) => (f.stages || []).length]];
    if (daysSent) counts.push(['days', (f) => (f.days || []).length], ['sets', (f) => setsOf(f).length]);
    for (const [key, count] of counts) {
      if (count(before) !== count(after)) changes[key] = [count(before), count(after)];
    }
    return changes;
  }

  // "1 day, 24 sets and 113 picks": the non-zero parts, in this order.
  function removalSummary(removal: { days: number; sets: number; picks: number; ratings: number }) {
    const parts = (
      [
        [removal.days, 'day'],
        [removal.sets, 'set'],
        [removal.picks, 'pick'],
        [removal.ratings, 'rating'],
      ] as const
    )
      .filter(([n]) => n > 0)
      .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`);
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }

  // A save that only cancels acts removes nothing, so its confirm leads with the alert count instead.
  function removalMessage(removal: { days: number; sets: number; picks: number; ratings: number }) {
    const removes = removalSummary(removal);
    return removes ? `This save removes ${removes}. Confirm to continue.` : 'This save sends cancel alerts. Confirm to continue.';
  }

  async function countOnSets(table: 'festival_profile_picks' | 'set_ratings', setIds: string[]) {
    if (setIds.length === 0) return 0;
    const result = await stores.pool.query(`SELECT COUNT(*) AS count FROM ${table} WHERE set_id = ANY($1)`, [setIds]);
    return Number.parseInt(result.rows[0]?.count ?? '0', 10) || 0;
  }

  // The cancel line of the removal confirm: what cancelling these acts takes away and who hears about it.
  // `pickersBySet` holds the pickers of every moved or removed set, the map the send reads, so the counts
  // here are the counts that get an alert: `picked` people hear about a changed set, `marked` only about the act.
  async function cancelSummary(
    festival: any,
    cancelled: { entryId: string; artist: string; setIds: string[] }[],
    removedIds: string[],
    interestedByEntry: Map<string, string[]>,
    pickersBySet: Map<string, string[]>,
  ) {
    const removed = new Set(removedIds);
    const setIds = [...new Set(cancelled.flatMap((c) => c.setIds))].filter((id) => removed.has(id));
    const pickers = new Set([...pickersBySet.values()].flat());
    const marked = new Set([...interestedByEntry.values()].flat().filter((userId) => !pickers.has(userId)));
    return {
      acts: cancelled.map((c) => c.artist),
      sets: setIds.length,
      picks: await countOnSets('festival_profile_picks', setIds),
      picked: pickers.size,
      marked: marked.size,
    };
  }

  router.get('/', rateLimit(120, 'festival-list'), async (req: any, res: any) => {
    try {
      const festivals = await getFestivals();
      // Lightweight cache: recompute only when festival data changes
      const version = festivals
        .map((f: any) => `${f.updatedAt || f.createdAt || ''}|${f.publishedAt ?? ''}`)
        .join(',');
      if (!_festivalListCache || version !== _festivalListVersion) {
        const all = festivals.map((festival: any) => {
          // Derive the date range from the already-loaded day dates (the
          // festivals table has no start/end columns). Lets the picker show the
          // date + an upcoming/past status without a detail fetch.
          const dates = (festival.days || [])
            .map((d: any) => d.date)
            .filter(Boolean)
            .sort();
          return {
            id: festival.id,
            name: festival.name,
            location: festival.location,
            stageCount: festival.stages?.length || 0,
            dayCount: festival.days?.length || 0,
            // Announced acts that no set covers yet. Cancelled acts do not count.
            lineupCount: Object.values(coverLineup(festival.lineup ?? [], festival.days ?? [], festival.b2bSeparator)).filter(
              (cover) => cover.state === 'announced',
            ).length,
            // How far the schedule has come: set times, days only, lineup only, or nothing yet.
            scheduleProgress: scheduleProgress(festival),
            startDate: dates[0] || null,
            endDate: dates[dates.length - 1] || null,
            slug: festival.slug ?? null,
            seriesId: festival.seriesId ?? null,
            published: !!festival.publishedAt,
            updatedAt: festival.updatedAt,
          };
        });
        const published = all
          .filter((item: any) => item.published)
          .map(({ published: _published, updatedAt: _updatedAt, seriesId: _seriesId, ...item }: any) => item);
        _festivalListCache = {
          admin: { items: all, etag: listETag(all) },
          public: { items: published, etag: listETag(published) },
        };
        _festivalListVersion = version;
      }
      const list = isAdminReq(req) ? _festivalListCache.admin : _festivalListCache.public;
      res.setHeader('ETag', list.etag);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === list.etag) {
        return res.status(304).end();
      }
      return sendSuccess(res, list.items);
    } catch (error: any) {
      log.error('festivals list failed', { error: error.message });
      return sendError(res, 500, 'Failed to load festivals', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Resolve which festival a set belongs to — powers https deep links
  // (festie.us/set/:id): web + mobile look up the festival, load it, then open
  // the set. Public, no user data; just the festivalId. Declared before `/:id`
  // for clarity (the two-segment path can't collide with the one-segment one).
  router.get('/locate-set/:setId', rateLimit(120, 'festival-locate-set'), async (req: any, res: any) => {
    try {
      const setId = String(req.params.setId || '');
      if (!setId) return sendError(res, 400, 'Set ID required', ErrorCodes.INVALID_INPUT);
      const result = await stores.pool.query(
        `SELECT fs.festival_id, (f.published_at IS NOT NULL) AS published FROM festival_sets fs JOIN festivals f ON f.id = fs.festival_id
         WHERE fs.id = $1 AND f.deleted_at IS NULL AND (f.published_at IS NOT NULL OR $2::boolean) LIMIT 1`,
        [setId, isAdminReq(req)],
      );
      if (!result.rows.length) return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
      res.setHeader('Cache-Control', result.rows[0].published ? 'public, max-age=300' : 'private, no-store');
      return sendSuccess(res, { festivalId: result.rows[0].festival_id });
    } catch (error: any) {
      log.error('locate-set failed', { error: error.message });
      return sendError(res, 500, 'Failed to locate set', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Deleted festivals for the admin "Archived" view. Declared before `/:id`.
  router.get('/archived', adminAuth, rateLimit(60, 'festival-archived'), async (_req: any, res: any) => {
    try {
      return sendSuccess(res, await stores.festivals.listDeleted());
    } catch (error: any) {
      log.error('archived festivals list failed', { error: error.message });
      return sendError(res, 500, 'Failed to load archived festivals', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /:id/basemap — resolve a festival's offline PMTiles vector basemap (Phase
  // 3B). A STABLE, app-facing endpoint that decouples clients from where the
  // archive is hosted: the persisted reference lives in
  // map_config.offlineBasemap.pmtilesUrl (Phase 3A schema). When set, we 302 to
  // that https URL (which may be Festie's own /uploads/basemaps/<file>.pmtiles
  // static path, or an external CDN). When the festival has no offline basemap we
  // 404 — the client already falls back to the online OSM raster (graceful, the
  // online path is never regressed). Lets the mobile app prefetch via one stable
  // URL without re-reading the whole festival document.
  router.get('/:id/basemap', rateLimit(120, 'festival-basemap'), async (req: any, res: any) => {
    try {
      const id = String(req.params.id || '');
      if (!id) return sendError(res, 400, 'Festival ID required', ErrorCodes.INVALID_INPUT);
      const festival = visible(await getFestivalById(id), req);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      const url = festival.mapConfig?.offlineBasemap?.pmtilesUrl;
      // Re-assert https before redirecting (defense in depth — the schema already
      // enforces it on write, but never emit a Location header to a non-https /
      // unparseable target). Absent ⇒ no offline basemap ⇒ honest 404.
      if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
        return sendError(res, 404, 'No offline basemap for this festival', ErrorCodes.NOT_FOUND);
      }

      // Short cache on the REDIRECT (not the archive) so a re-extract that swaps
      // the pointer propagates within minutes; the archive itself is immutably
      // long-cached by the static handler.
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.redirect(302, url);
    } catch (error: any) {
      log.error('festival basemap resolve failed', { error: error.message, festivalId: req.params?.id });
      return sendError(res, 500, 'Failed to resolve basemap', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Tiered data loading (OpenViking L0/L1/L2 pattern):
  //   ?depth=0 → name, id, location only (already served by GET /)
  //   ?depth=1 → stages + days with set names (no profiles/messages) — default for mobile initial load
  //   ?depth=2 (or omitted) → full festival data (backward compatible default)
  router.get(
    '/:id',
    rateLimit(120, 'festival-detail'),
    validateParams(schemas.genericIdParams),
    validateQuery(schemas.festivalDepthQuery),
    async (req: any, res: any) => {
      try {
        const cached = visible(await getFestivalById(req.validatedParams.id), req);
        if (!cached) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        // The cached record can outlive a mark's 48 hours, so drop stale marks per response.
        const festival = withFreshMoves(cached, Date.now());
        // Public festival structure (stages/days/sets) — no user data. Use
        // `no-cache` (revalidate) rather than `no-store` (never cache) so the
        // service worker can serve the last-known copy when offline while
        // still fetching fresh data when the network is available.
        res.setHeader('Cache-Control', 'no-cache');

        const depth = req.validatedQuery.depth;
        if (depth === 1) {
          // L1: structural overview — stages, days with set names/times, no full profile data
          return sendSuccess(res, {
            id: festival.id,
            name: festival.name,
            location: festival.location,
            latitude: festival.latitude ?? null,
            longitude: festival.longitude ?? null,
            stages: (festival.stages || []).map((s: any) => ({
              id: s.id,
              name: s.name,
              color: s.color,
              latitude: s.latitude ?? null,
              longitude: s.longitude ?? null,
            })),
            days: (festival.days || []).map((d: any) => ({
              label: d.label,
              date: d.date,
              sets: (d.sets || []).map((s: any) => ({
                id: s.id,
                artist: s.artist,
                artists: s.artists || [],
                stageId: s.stageId,
                startTime: s.startTime,
                endTime: s.endTime,
                ...(s.movedAt ? { movedAt: s.movedAt, movedFrom: s.movedFrom } : {}),
              })),
            })),
            lineup: festival.lineup ?? [],
            slug: festival.slug ?? null,
            mapConfig: festival.mapConfig ?? null,
            createdAt: festival.createdAt,
            updatedAt: festival.updatedAt,
          });
        }

        // depth=2 or omitted: full festival (backward compatible)
        if (isAdminReq(req)) {
          const editorId = await stores.festivals.getEditor(festival.id);
          const editor = editorId ? await getUserById(editorId) : null;
          return sendSuccess(res, {
            ...festival,
            publishedAt: festival.publishedAt ?? null,
            updatedByUsername: editor?.username ?? null,
            checklist: publishChecklist(config, festival, { ambiguousNames: await ambiguousNamesOf(festival) }),
          });
        }
        const { seriesId: _seriesId, ...publicFestival } = festival;
        return sendSuccess(res, publicFestival);
      } catch (error: any) {
        log.error('festival load failed', { error: error.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to load festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.post(
    '/',
    adminAuth,
    rateLimit(10, 'festival-create'),
    validate(schemas.festivalCreate),
    async (req: any, res: any) => {
      try {
        const issues = validateFestivalIssues(config, req.validatedBody);
        if (issues.length > 0) return sendIssues(res, issues);
        const festival = sanitizeFestivalPayload(req.validatedBody);
        // A new festival is a draft. Attendees see it, and festival:created
        // goes out, only when an admin publishes it.
        await stores.festivals.create({ ...festival, publishedAt: null, updatedBy: req.user?.userId ?? null });
        invalidateFestivalCache();
        invalidateFestivalListCache();
        log.info('festival:created', { festivalId: festival.id, name: festival.name });
        audit(AUDIT_ACTIONS.FESTIVAL_CREATED, 'festival', festival.id, req, { name: festival.name });
        const venueGuessed =
          typeof festival.latitude !== 'number' && (await fillVenueCoords(festival.id, festival.location));
        res.status(201);
        return sendSuccess(res, { ...festival, publishedAt: null, ...(venueGuessed ? { venueGuessed } : {}) });
      } catch (error: any) {
        if (sendIdClash(res, error)) return;
        log.error('festival create failed', { error: error.message });
        return sendError(res, 500, 'Failed to create festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.put(
    '/:id',
    adminAuth,
    rateLimit(10, 'festival-update'),
    validateParams(schemas.genericIdParams),
    validate(schemas.festivalUpdate),
    async (req: any, res: any) => {
      try {
        const body = req.validatedBody;
        const existingFestival = await getFestivalById(req.validatedParams.id);
        if (!existingFestival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        // The body is partial, so check the festival that results from the save.
        // A stored lineup is not re-checked: only a body that carries one can fail on duplicates.
        const issues = validateFestivalIssues(config, { ...existingFestival, lineup: undefined, ...body });
        if (issues.length > 0) return sendIssues(res, issues);

        // The token is checked inside the save, under the festival row lock, against the last form edit.
        // A check here would compare the cache's updatedAt, which an artist edit moves.
        const nextFestival = sanitizeFestivalPayload(body, existingFestival);
        const venueSent = body.latitude !== undefined || body.longitude !== undefined;
        // Days and sets are touched only when the payload sends them; the map
        // editors leave them out so a map save cannot rewrite the lineup.
        const daysSent = body.days !== undefined;
        const stats = { setsAdded: 0, setsRemoved: 0, setsChanged: 0, picksLost: 0 };
        // A cancelled act alerts the people whose mark on it is still open. Converted marks are pickers already.
        // The alert stays off until the owner sets LINEUP_CANCEL_ALERTS_ENABLED, so no cancel counts or sends before then.
        const cancelAlertsOn = config.LINEUP_CANCEL_ALERTS_ENABLED === true && body.lineup !== undefined;
        const cancelCover: Record<string, { setIds: string[] }> = cancelAlertsOn
          ? coverLineup(existingFestival.lineup ?? [], existingFestival.days ?? [], existingFestival.b2bSeparator || 'b2b')
          : {};
        const cancelled = (cancelAlertsOn ? diffCancelledEntries(existingFestival, nextFestival) : []).map((change) => ({
          ...change,
          setIds: cancelCover[change.entryId]?.setIds ?? [],
        }));
        const interestedByEntry: Map<string, string[]> = cancelled.length
          ? await stores.profiles.interestedProfilesByEntry(
              existingFestival.id,
              cancelled.map((change) => change.entryId),
            )
          : new Map();

        // Only a moved or removed set, or a set timed on an already released date, alerts anyone, and only
        // the people who picked it. No save sends the festival-wide set-times alert: the admin releases it per date.
        // The pickers are read before the update, which deletes picks on removed sets. The confirm and the send share this map.
        const { changes, pickersBySet } = daysSent
          ? await planPickerAlerts({ stores, before: existingFestival, after: nextFestival })
          : { changes: [], pickersBySet: new Map<string, string[]>() };

        let removedIds: string[] = [];
        let picks = 0;
        let ratings = 0;
        if (daysSent) {
          const storedSets = setsOf(existingFestival);
          const nextIds = new Set(setsOf(nextFestival).map((set: any) => set.id));
          removedIds = storedSets.map((set: any) => set.id).filter((id: string) => !nextIds.has(id));
          [picks, ratings] = await Promise.all([
            countOnSets('festival_profile_picks', removedIds),
            countOnSets('set_ratings', removedIds),
          ]);
        }
        const cancel = cancelled.length
          ? await cancelSummary(existingFestival, cancelled, removedIds, interestedByEntry, pickersBySet)
          : undefined;
        // A cancel that alerts anyone needs the admin to see the count first, even when no pick or rating is lost.
        const cancelTellsPeople = !!cancel && cancel.picked + cancel.marked > 0 && req.validatedBody.notify !== false;
        if ((picks + ratings > 0 || cancelTellsPeople) && body.confirmRemovals !== true) {
          const removal = {
            days: daysSent ? Math.max(0, (existingFestival.days || []).length - nextFestival.days.length) : 0,
            sets: removedIds.length,
            picks,
            ratings,
            ...(cancel ? { cancel } : {}),
          };
          return sendError(
            res,
            409,
            removalMessage(removal),
            ErrorCodes.CONFIRM_REMOVALS,
            { removal },
          );
        }
        if (daysSent) {
          const storedById = new Map(setsOf(existingFestival).map((set: any) => [set.id, set]));
          stats.setsRemoved = removedIds.length;
          stats.picksLost = picks;
          for (const set of setsOf(nextFestival)) {
            const before: any = storedById.get(set.id);
            if (!before) stats.setsAdded++;
            else if (
              before.artist !== set.artist ||
              (before.stageId || '') !== (set.stageId || '') ||
              (before.startTime || null) !== (set.startTime || null) ||
              (before.endTime || null) !== (set.endTime || null)
            ) {
              stats.setsChanged++;
            }
          }
        }
        if (body.confirmRemovals === true && !hasRecentAuth(req)) {
          return sendError(res, 403, 'Confirm your password to continue.', ErrorCodes.REAUTH_REQUIRED);
        }

        // Sets and lineup entries get an artist id inside the save transaction (resolveArtistRefs).
        const refsSeen: { value: RefsResult | null } = { value: null };
        const refsNeeded = daysSent || body.lineup !== undefined;
        const festival = await stores.festivals.update(
          req.validatedParams.id,
          {
            name: nextFestival.name,
            location: nextFestival.location,
            b2bSeparator: nextFestival.b2bSeparator,
            timeZone: nextFestival.timeZone,
            stages: nextFestival.stages,
            ...(daysSent ? { days: nextFestival.days } : {}),
            // Only a body that sends the lineup rewrites it, so mobile and map saves keep the stored list.
            ...(body.lineup !== undefined ? { lineup: nextFestival.lineup } : {}),
            mapConfig: nextFestival.mapConfig,
            seriesId: nextFestival.seriesId,
            updatedBy: req.user?.userId ?? null,
            ...(venueSent ? { latitude: nextFestival.latitude, longitude: nextFestival.longitude } : {}),
          },
          {
            expectedUpdatedAt: body.expectedUpdatedAt,
            // The removal count above came from the cache; under the lock the stored sets must still be those.
            storedSetIds: daysSent ? setsOf(existingFestival).map((set: any) => set.id) : undefined,
            beforeChildren: refsNeeded
              ? async (client: any, fields: any) => {
                  refsSeen.value = await resolveArtistRefs(client, {
                    festivalId: req.validatedParams.id,
                    days: daysSent ? fields.days : undefined,
                    lineup: body.lineup !== undefined ? fields.lineup : undefined,
                    separator: nextFestival.b2bSeparator,
                    userId: req.user?.userId ?? null,
                  });
                  return { days: refsSeen.value.days, lineup: refsSeen.value.lineup };
                }
              : undefined,
          },
        );
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        invalidateFestivalCache();

        invalidateFestivalListCache();
        const pickers = new Set([...pickersBySet.values()].flat());
        // A person who picked a changed set gets that alert only, so marks are counted once.
        const marked = new Set([...interestedByEntry.values()].flat().filter((userId) => !pickers.has(userId))).size;
        const people = pickers.size + marked;
        const notified = req.validatedBody.notify !== false && people > 0;
        const scheduleNotice = { changes: changes.length + cancelled.length, people, notified, ...(marked > 0 ? { marked } : {}) };
        log.info('festival:updated', { festivalId: festival.id, name: festival.name });
        // The saved row lacks stages and days, so those come from the payload that was written.
        const fieldChanges = festivalAuditChanges(existingFestival, { ...nextFestival, ...festival }, daysSent);
        audit(AUDIT_ACTIONS.FESTIVAL_UPDATED, 'festival', festival.id, req, {
          name: festival.name,
          ...stats,
          scheduleChanges: changes.length + cancelled.length,
          notifiedPeople: notified ? people : 0,
          ...(Object.keys(fieldChanges).length > 0 ? { changes: fieldChanges } : {}),
        });
        // A draft has no attendees, and the event goes to every socket.
        if (existingFestival.publishedAt) emitter.festivalUpdated({ festival });
        if (notified) void emitter.scheduleChanged({ festival, changes: [...changes, ...cancelled], pickersBySet, interestedByEntry });
        // New sets or new names can cover a marked act. It runs after commit and logs its own failure.
        if (daysSent || body.lineup !== undefined || body.b2bSeparator !== undefined) void deps.interestConversion?.convert(festival.id);
        const venueMissing = typeof existingFestival.latitude !== 'number';
        // An admin-set venue wins over the geocoder until the location text changes in a later save.
        const venueSetByAdmin =
          venueSent &&
          (nextFestival.latitude !== existingFestival.latitude ||
            nextFestival.longitude !== existingFestival.longitude);
        const venueGuessed =
          !venueSetByAdmin &&
          (venueMissing || nextFestival.location !== existingFestival.location) &&
          (await fillVenueCoords(festival.id, nextFestival.location));
        const refs = refsSeen.value;
        return sendSuccess(res, {
          ...festival,
          scheduleNotice,
          ...(venueGuessed ? { venueGuessed } : {}),
          // The links the save dropped or ignored, and the names that match more than one artist.
          ...(refs
            ? { artistRefs: { droppedLinks: refs.droppedLinks, ignoredLinkEdits: refs.ignoredLinkEdits, ambiguous: refs.ambiguous } }
            : {}),
        });
      } catch (error: any) {
        if (error instanceof FestivalChangedError) {
          return sendError(
            res,
            409,
            'This festival changed since you opened it. Reload it, then make your change again.',
            ErrorCodes.FESTIVAL_CHANGED,
          );
        }
        if (error?.code === '40P01' || error?.code === '40001') {
          return sendError(res, 503, 'Festie is busy. Try again.', ErrorCodes.SERVICE_UNAVAILABLE);
        }
        if (sendIdClash(res, error)) return;
        log.error('festival update failed', { error: error.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to update festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // How many people, crews and picks lose access if this festival is deleted.
  router.get('/:id/impact', adminAuth, validateParams(schemas.genericIdParams), async (req: any, res: any) => {
    try {
      const festival = await getFestivalById(req.validatedParams.id);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      return sendSuccess(res, await stores.festivals.countImpact(festival.id));
    } catch (error: any) {
      log.error('festival impact failed', { error: error.message, festivalId: req.validatedParams?.id });
      return sendError(res, 500, 'Failed to count who uses this festival', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Publish a draft once the checklist has no 'todo' item. There is no unpublish:
  // it would cut off attendees with picks. Delete and Restore cover mistakes.
  router.post(
    '/:id/publish',
    adminAuth,
    rateLimit(10, 'festival-publish'),
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const festival = await getFestivalById(req.validatedParams.id);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        const checklist = publishChecklist(config, festival, { ambiguousNames: await ambiguousNamesOf(festival) });
        if (festival.publishedAt) return sendSuccess(res, { publishedAt: festival.publishedAt, checklist });
        if (checklist.some((item: any) => item.status === 'todo')) {
          return sendError(res, 409, 'Finish the checklist before you publish.', ErrorCodes.PUBLISH_BLOCKED, {
            checklist,
          });
        }
        const row = await stores.festivals.publish(festival.id, req.user?.userId ?? null);
        if (!row) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        invalidateFestivalCache();
        invalidateFestivalListCache();
        audit(AUDIT_ACTIONS.FESTIVAL_PUBLISHED, 'festival', festival.id, req, {
          name: festival.name,
          warnings: checklist.filter((item: any) => item.status === 'warn').map((item: any) => item.key),
        });
        log.info('festival:published', { festivalId: festival.id, name: festival.name });
        emitter.festivalCreated({ id: festival.id, name: festival.name });
        return sendSuccess(res, { publishedAt: row.publishedAt, checklist });
      } catch (error: any) {
        log.error('festival publish failed', { error: error.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to publish festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Bring a soft-deleted festival back. It keeps its published state.
  router.post(
    '/:id/restore',
    adminAuth,
    rateLimit(10, 'festival-restore'),
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const id = req.validatedParams.id;
        const row = await stores.festivals.restore(id, req.user?.userId ?? null);
        if (!row) return sendError(res, 404, 'This festival is not in Archived.', ErrorCodes.NOT_FOUND);
        invalidateFestivalCache();
        invalidateFestivalListCache();
        const festival = await getFestivalById(id);
        const name = festival?.name ?? '';
        audit(AUDIT_ACTIONS.FESTIVAL_RESTORED, 'festival', id, req, { name });
        log.info('festival:restored', { festivalId: id, name });
        const published = !!row.publishedAt;
        if (published) emitter.festivalCreated({ id, name });
        return sendSuccess(res, { id, published });
      } catch (error: any) {
        log.error('festival restore failed', { error: error.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to restore festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // P3.18: Soft-delete (default). Pass ?hard=true for permanent removal.
  router.delete(
    '/:id',
    adminAuth,
    rateLimit(5, 'festival-delete'),
    requireRecentAuth,
    validateParams(schemas.genericIdParams),
    validateQuery(schemas.festivalDeleteQuery),
    async (req: any, res: any) => {
      try {
        const festival = await getFestivalById(req.validatedParams.id);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        const festivalId = festival.id;
        const hardDelete = req.validatedQuery.hard === 'true';

        // H1: evict crew-room sockets BEFORE the delete (hard-delete cascades the
        // crews away; soft-delete makes them inaccessible) while listByFestival
        // can still resolve them. removeFestivalSockets below only clears the
        // festival-presence room, not the per-crew rooms.
        await evictFestivalCrewRooms(festivalId);

        if (!hardDelete && stores.festivals?.softDelete) {
          // Soft-delete: mark as deleted, preserve data for potential restore
          await stores.festivals.softDelete(festivalId);
        } else {
          // Hard delete: permanently remove all data (including crew children)
          // inside a single transaction. Migration 031 changed all festival FKs
          // from CASCADE to RESTRICT, so hardDelete deletes child rows
          // explicitly in dependency order.
          await stores.festivals.hardDelete(festivalId);
        }
        invalidateFestivalCache();

        removeFestivalSockets(festivalId, io);
        invalidateFestivalListCache();
        audit(hardDelete ? AUDIT_ACTIONS.FESTIVAL_PURGED : AUDIT_ACTIONS.FESTIVAL_DELETED, 'festival', festivalId, req, {
          name: festival.name,
        });
        log.info('admin:delete-festival', {
          festivalId,
          festivalName: festival.name,
          hard: hardDelete,
          ip: getRequestIp(req),
        });
        emitter.festivalDeleted({ id: festivalId });
        return sendSuccess(res, { success: true, softDeleted: !hardDelete });
      } catch (error: any) {
        log.error('festival delete failed', { error: error.message, festivalId: req.validatedParams?.id });
        return sendError(res, 500, 'Failed to delete festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // PUT /:festivalId/sets/:setId/link — Admin: set a Spotify/SoundCloud link on a set
  router.put(
    '/:festivalId/sets/:setId/link',
    adminAuth,
    rateLimit(10, 'set-link'),
    validate(schemas.setLink),
    async (req: any, res: any) => {
      try {
        const festivalId = req.params.festivalId;
        const setId = req.params.setId;
        const { linkUrl } = req.validatedBody;
        const artistIndex = req.validatedBody.artistIndex ?? 0;

        if (!festivalId || !setId)
          return sendError(res, 400, 'Festival and set IDs required', ErrorCodes.INVALID_INPUT);

        const festival = await getFestivalById(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

        // Validated by Zod schema — normalize to null if empty
        const cleanUrl = linkUrl && typeof linkUrl === 'string' && linkUrl.trim() ? linkUrl.trim() : null;

        // One transaction under the festival lock, reading the set row itself, so a link edit never
        // rebuilds a set from a cache and never races a festival save.
        const outcome: any = await withTransactionRetry(stores.pool, async (client: any) => {
          const locked = await lockFestivalAny(client, festivalId);
          if (!locked || locked.deleted_at) return { missing: 'Festival not found' };
          const { rows } = await client.query(
            'SELECT artist, artists FROM festival_sets WHERE id = $1 AND festival_id = $2 FOR UPDATE',
            [setId, festivalId],
          );
          if (!rows[0]) return { missing: 'Set not found' };
          // A set saved before the artists array existed has only its display name.
          const artists: any[] = rows[0].artists?.length
            ? rows[0].artists.map((a: any) => ({ ...a, links: { ...(a?.links || {}) } }))
            : [{ name: rows[0].artist, links: {} }];
          if (artistIndex >= artists.length) return { badIndex: true };
          const artistId = artists[artistIndex].id;
          // An artist that has a row owns its link: write the row, which rewrites every copy.
          if (artistId && (await client.query('SELECT 1 FROM artists WHERE id = $1 AND merged_into IS NULL', [artistId])).rowCount) {
            return { artistId };
          }
          if (cleanUrl) artists[artistIndex].links.spotify = cleanUrl;
          else delete artists[artistIndex].links.spotify;
          // link_url mirrors the first artist's Spotify link (backward compat).
          const firstLink = artists[0].links.spotify || null;
          await client.query('UPDATE festival_sets SET artists = $1, link_url = $2 WHERE id = $3 AND festival_id = $4', [
            JSON.stringify(artists),
            firstLink,
            setId,
            festivalId,
          ]);
          await client.query('UPDATE festivals SET updated_at = NOW(), edited_at = NOW() WHERE id = $1', [festivalId]);
          return {};
        });
        if (outcome.missing) return sendError(res, 404, outcome.missing, ErrorCodes.NOT_FOUND);
        if (outcome.badIndex) return sendError(res, 400, 'That artist is not on this set.', ErrorCodes.INVALID_INPUT);
        if (outcome.artistId) {
          const current = await stores.artists.getById(outcome.artistId);
          const result = await stores.artists.update(outcome.artistId, {
            expectedUpdatedAt: new Date(current.updated_at).toISOString(),
            changes: { spotifyLink: cleanUrl },
            userId: req.user?.userId ?? null,
            ip: getRequestIp(req),
          });
          await deps.afterArtistSync?.(result.synced);
        }
        invalidateFestivalCache();
        // A flat set becomes an artists array here, which can change the name key that covers an act.
        void deps.interestConversion?.convert(festivalId);

        audit(AUDIT_ACTIONS.SET_LINK_UPDATED, 'set', setId, req, { festivalId, artistIndex, linkUrl: cleanUrl });
        log.info('set link updated', {
          festivalId,
          setId,
          artistIndex,
          linkUrl: cleanUrl ? 'set' : 'cleared',
          ip: getRequestIp(req),
        });
        return sendSuccess(res, { setId, artistIndex, linkUrl: cleanUrl });
      } catch (error: any) {
        if (error instanceof ArtistError) return sendError(res, error.status, error.message, ErrorCodes[error.code], error.details);
        log.error('set link update failed', { error: error.message });
        return sendError(res, 500, 'Failed to update set link', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // GET /:festivalId/sets/links — Admin: list all set links for a festival
  router.get('/:festivalId/sets/links', adminAuth, async (req: any, res: any) => {
    try {
      const festivalId = req.params.festivalId;
      const festival = await stores.pool.query('SELECT id FROM festivals WHERE id = $1 AND deleted_at IS NULL', [festivalId]);
      if (festival.rows.length === 0) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      const result = await stores.pool.query(
        'SELECT id, artist, link_url AS "linkUrl", artists FROM festival_sets WHERE festival_id = $1 AND (link_url IS NOT NULL OR artists != \'[]\'::jsonb) ORDER BY artist',
        [festivalId],
      );
      return sendSuccess(res, result.rows);
    } catch (error: any) {
      log.error('set links list failed', { error: error.message });
      return sendError(res, 500, 'Failed to load set links', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
