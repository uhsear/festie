// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';
import { planPickerAlerts } from '../lib/picker-alerts.js';
import { diffCancelledEntries } from '../lib/schedule-diff.js';
import { withFreshMoves } from '../lib/set-moves.js';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { auditContext } from '../lib/audit-middleware.js';
import { deliverScheduleAlert } from '../lib/alert-hold.js';
import { normalizeArtistLink } from '../lib/artist-links.js';
import { sendPublishDecisionEmail } from '../lib/email.js';
import { appOrigin } from '../lib/notifications/links.js';
import { absolutizeTilesUrl } from '../lib/tiles.js';
import { firstRuleMessage, organizerFestivalRules } from '../lib/schemas/organizer-rules.js';
import { coverLineup, scheduleProgress } from '../lib/lineup.js';
import { resolveArtistRefs, type RefsResult } from '../lib/artist-refs.js';
import { artistViewerOf } from '../lib/artist-viewer.js';
import { ENGAGEMENT_MIN_COUNT, organizerAudience } from '../lib/organizer-engagement.js';
import { FestivalChangedError } from '../lib/db/stores/festivals.js';
import { ArtistError } from '../lib/db/stores/artists.js';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { RouteDeps } from '../lib/types';
import type { Params, Query } from '../lib/types/app-context';
import { evictCrewRoomSockets } from '../lib/presence.js';

export default function createFestivalsRoutes(deps: RouteDeps) {
  const {
    express,
    config,
    log,
    adminAuth,
    festivalAccess,
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
  // A member's geocode runs after the response, and a request past this many waiting ones is dropped with a log line
  // (plan-v3 6.6): the Nominatim queue is one request per 1.1 seconds for everyone, so an organization cannot fill it.
  const MEMBER_GEOCODE_QUEUE = 5;
  let memberGeocodesWaiting = 0;

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
    } catch (error) {
      log.warn('festival venue geocode failed', { festivalId, error: (error as NodeJS.ErrnoException).message });
      return false;
    }
  }

  // The router is mounted at /festivals, at /admin/festivals and, through routes/manage.ts, at /manage.
  // adminAuth and festivalAccess set req.isAdmin for an admin. Only festivalAccess sets req.festivalRole, and it
  // gives an organization member a role on /manage alone, so a member sees drafts there and nowhere else.
  const isAdminReq = (req: Request) => (req as Request & { isAdmin?: boolean }).isAdmin === true;
  const isMemberReq = (req: Request) => !isAdminReq(req) && (req as Request & { festivalRole?: string }).festivalRole !== undefined;
  const visible = (festival: any, req: Request) =>
    festival && (festival.publishedAt || isAdminReq(req) || isMemberReq(req)) ? festival : null;
  const refusal = (message: string) => ({ status: 403, code: 'FORBIDDEN' as const, message });

  // What artists a request may see (artist plan 8.5): everything for an admin, the member's view for a member.
  async function memberViewer(req: Request) {
    if (!isMemberReq(req)) return undefined;
    const viewer = await artistViewerOf(stores as any, req as any);
    if (!viewer) throw new Error('a member request without an organization');
    return viewer;
  }

  // A member's save keeps a set id only when the festival already holds it: set ids are global primary keys, so
  // a foreign id would clash with another tenant's row. Alerts the save would send are held (lib/alert-hold.ts).
  function memberBody<T extends { days?: any[] }>(req: Request, sent: T, existing: any): T {
    if (!isMemberReq(req)) return sent;
    const own = new Set(setsOf(existing).map((set: any) => set.id));
    const days = sent.days?.map((day: any) => ({
      ...day,
      sets: (day.sets || []).map((set: any) => (own.has(set.id) ? set : { ...set, id: `set-${crypto.randomUUID()}` })),
    }));
    // The organizer editor has no series control: a series is a Festie-wide id, so a member's body never moves it.
    const { seriesId: _seriesId, ...rest } = sent as T & { seriesId?: unknown };
    return { ...rest, ...(days ? { days } : {}) } as T;
  }

  // 400 with one issue per problem; `message` stays one sentence for old clients.
  // Names that fit two artists. The checklist only warns, so a failed lookup never blocks the page.
  async function ambiguousNamesOf(festival: any, req: Request): Promise<number> {
    try {
      return (await stores.artists?.countAmbiguousNames(festival, await memberViewer(req))) ?? 0;
    } catch (error) {
      log.warn('ambiguous artist names lookup failed', { error: (error as NodeJS.ErrnoException)?.message });
      return 0;
    }
  }

  function sendIssues(res: Response, issues: any[]) {
    const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
    return sendError(res, 400, `${issues[0].message}${more}`, ErrorCodes.INVALID_INPUT, { issues });
  }

  // A 400 for a member's body that breaks the link and hosting rules, one entry per problem.
  function sendRuleIssues(res: Response, error: z.ZodError) {
    return sendError(res, 400, firstRuleMessage(error), ErrorCodes.INVALID_INPUT, {
      issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  // Who saved first and when, for a member whose save lost the race (plan-v3 5.9). The name follows the rule of
  // the festival page: a teammate's display name, otherwise "Festie support". An admin's 409 keeps its old body.
  async function staleDetails(req: Request): Promise<{ updatedAt: string | null; updatedBy: string | null } | undefined> {
    if (!isMemberReq(req)) return undefined;
    try {
      const info = await stores.festivalReview.editInfo((req.validatedParams as Params).id);
      if (!info) return undefined;
      return {
        updatedAt: new Date(info.editedAt).toISOString(),
        updatedBy: await stores.organizations.editorLabel((req as any).organizationId, info.updatedBy),
      };
    } catch (err) {
      log.warn('stale save details failed', { error: (err as Error).message });
      return undefined;
    }
  }

  // A primary-key clash on save (an id another festival, or another festival's set, already holds) is the caller's mistake, not a server fault.
  // A member never learns which id is taken, because the id may belong to another tenant.
  function sendIdClash(res: Response, error: any, member = false) {
    if (error?.code !== '23505') return null;
    if (member) return sendError(res, 409, 'That id is taken.', ErrorCodes.ALREADY_EXISTS);
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
   * disconnect. Uses evictCrewRoomSockets from lib/presence.ts.
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
        emitter.toCrew(crewId, 'crew:deleted', { crewId, festivalId });
        await evictCrewRoomSockets(io, crewId);
      }
    } catch (error) {
      log.warn('festival crew room eviction failed', { error: (error as NodeJS.ErrnoException)?.message, festivalId });
    }
  }

  // Audit log helper — writes to audit_log table if available (async, fire-and-forget with error handling).
  // Every caller sits behind festivalAccess, so the actor is the signed-in admin or an organization member.
  function audit(action: any, targetType: any, targetId: any, req: Request, details: any = {}) {
    if (!stores.auditLog) return;
    // Tells the generic audit middleware this request already has its row.
    if (req.res?.locals) req.res.locals.auditWritten = true;
    // Fire async without awaiting to avoid blocking HTTP response
    Promise.resolve().then(async () => {
      try {
        await stores.auditLog.insert({
          id: crypto.randomUUID(),
          ...auditContext(req),
          actorId: req.user?.userId,
          action,
          targetType,
          targetId,
          detailsJson: Object.keys(details).length > 0 ? JSON.stringify(details) : null,
          ip: getRequestIp(req),
        });
      } catch (e) {
        log.warn('audit log write failed', { error: (e as NodeJS.ErrnoException).message });
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
    return stores.festivals.countOnSets(table, setIds);
  }

  // Who an alert would reach: every picker of a changed set, and the people with an open mark on a cancelled act who did not pick.
  function alertAudience(pickersBySet: Map<string, string[]>, interestedByEntry: Map<string, string[]>) {
    const pickers = new Set([...pickersBySet.values()].flat());
    const marked = new Set([...interestedByEntry.values()].flat().filter((userId) => !pickers.has(userId))).size;
    return { people: pickers.size + marked, marked };
  }

  // What a response says about the audience. An organizer gets a size only from ENGAGEMENT_MIN_JOINED up and never
  // a smaller one (owner decision 4), so a count cannot point at a few people. An admin sees the raw counts.
  function audienceFields(asMember: boolean, people: number, marked: number) {
    if (!asMember) return { people, ...(marked > 0 ? { marked } : {}) };
    const shownPeople = organizerAudience(people);
    const shownMarked = organizerAudience(marked);
    return { ...(shownPeople !== null ? { people: shownPeople } : {}), ...(shownMarked !== null ? { marked: shownMarked } : {}) };
  }

  // An organizer sees a removal count only from ENGAGEMENT_MIN_JOINED up, like an audience size; a smaller one reads
  // as 0 and drops out of the message. The save still asks for the confirm, which hidden counts alone can trigger.
  function removalForMember<T extends { picks: number; ratings: number; cancel?: { picks: number; picked: number; marked: number } }>(removal: T): T {
    const floor = (n: number) => organizerAudience(n) ?? 0;
    return {
      ...removal,
      picks: floor(removal.picks),
      ratings: floor(removal.ratings),
      ...(removal.cancel
        ? { cancel: { ...removal.cancel, picks: floor(removal.cancel.picks), picked: floor(removal.cancel.picked), marked: floor(removal.cancel.marked) } }
        : {}),
    };
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

  router.get('/', rateLimit(120, 'festival-list'), async (req: Request, res: Response) => {
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
    } catch (error) {
      log.error('festivals list failed', { error: (error as NodeJS.ErrnoException).message });
      return sendError(res, 500, 'Failed to load festivals', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Resolve which festival a set belongs to — powers https deep links
  // (festie.us/set/:id): web + mobile look up the festival, load it, then open
  // the set. Public, no user data; just the festivalId. Declared before `/:id`
  // for clarity (the two-segment path can't collide with the one-segment one).
  router.get('/locate-set/:setId', rateLimit(120, 'festival-locate-set'), async (req: Request, res: Response) => {
    try {
      const setId = String(req.params.setId || '');
      if (!setId) return sendError(res, 400, 'Set ID required', ErrorCodes.INVALID_INPUT);
      const located = await stores.festivals.locateSet(setId, isAdminReq(req));
      if (!located) return sendError(res, 404, 'Set not found', ErrorCodes.NOT_FOUND);
      res.setHeader('Cache-Control', located.published ? 'public, max-age=300' : 'private, no-store');
      return sendSuccess(res, { festivalId: located.festivalId });
    } catch (error) {
      log.error('locate-set failed', { error: (error as NodeJS.ErrnoException).message });
      return sendError(res, 500, 'Failed to locate set', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Deleted festivals for the admin "Archived" view. Declared before `/:id`.
  router.get('/archived', adminAuth, rateLimit(60, 'festival-archived'), async (_req: Request, res: Response) => {
    try {
      return sendSuccess(res, await stores.festivals.listDeleted());
    } catch (error) {
      log.error('archived festivals list failed', { error: (error as NodeJS.ErrnoException).message });
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
  router.get('/:id/basemap', rateLimit(120, 'festival-basemap'), async (req: Request, res: Response) => {
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
    } catch (error) {
      log.error('festival basemap resolve failed', { error: (error as NodeJS.ErrnoException).message, festivalId: req.params?.id });
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
    async (req: Request, res: Response) => {
      try {
        const cached = visible(await getFestivalById((req.validatedParams as Params).id), req);
        if (!cached) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        // The cached record can outlive a mark's 48 hours, so drop stale marks per response.
        const festival = withFreshMoves(cached, Date.now());
        // Public festival structure (stages/days/sets) — no user data. Use
        // `no-cache` (revalidate) rather than `no-store` (never cache) so the
        // service worker can serve the last-known copy when offline while
        // still fetching fresh data when the network is available.
        res.setHeader('Cache-Control', 'no-cache');

        const depth = (req.validatedQuery as Query).depth;
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
        if (isAdminReq(req) || isMemberReq(req)) {
          const editorId = await stores.festivals.getEditor(festival.id);
          const editor = editorId ? await getUserById(editorId) : null;
          // A member sees "<display name> at <organization>" for a teammate. An edit by anyone else, an admin
          // included, reads "Festie support". The attendee username is never shown to a member.
          const updatedByUsername = !editor
            ? null
            : isMemberReq(req)
              ? await stores.organizations.editorLabel((req as any).organizationId, editor.id)
              : editor.username;
          // The state of a publish request, so the editor can show "Waiting for review" or the note of a decline.
          const review = await stores.festivalReview?.reviewState?.(festival.id);
          return sendSuccess(res, {
            ...festival,
            publishedAt: festival.publishedAt ?? null,
            updatedByUsername,
            ...(review ? { publishRequestedAt: review.requestedAt, publishReviewNote: review.note } : {}),
            checklist: publishChecklist(config, festival, { ambiguousNames: await ambiguousNamesOf(festival, req) }),
          });
        }
        const { seriesId: _seriesId, ...publicFestival } = festival;
        return sendSuccess(res, publicFestival);
      } catch (error) {
        log.error('festival load failed', { error: (error as NodeJS.ErrnoException).message, festivalId: (req.validatedParams as Params)?.id });
        return sendError(res, 500, 'Failed to load festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.post(
    '/',
    adminAuth,
    rateLimit(10, 'festival-create'),
    validate(schemas.festivalCreate),
    async (req: Request, res: Response) => {
      try {
        absolutizeTilesUrl((req.validatedBody as z.infer<typeof schemas.festivalCreate>).mapConfig, config.PUBLIC_ORIGIN);
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
      } catch (error) {
        if (sendIdClash(res, error)) return;
        log.error('festival create failed', { error: (error as NodeJS.ErrnoException).message });
        return sendError(res, 500, 'Failed to create festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.put(
    '/:id',
    festivalAccess({
      action: 'festival.edit',
      // Dropping sets that attendees picked is an owner decision.
      allow: (req, _festival, membership) =>
        req.body?.confirmRemovals === true && membership.role !== 'owner'
          ? refusal(`Attendees already picked these sets. An owner of ${membership.name} must confirm the removal.`)
          : true,
    }),
    rateLimit(10, 'festival-update'),
    validateParams(schemas.genericIdParams),
    validate(schemas.festivalUpdate),
    async (req: Request, res: Response) => {
      try {
        const existingFestival = await getFestivalById((req.validatedParams as Params).id);
        if (!existingFestival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        const body = memberBody(req, req.validatedBody as z.infer<typeof schemas.festivalUpdate>, existingFestival);
        if (isMemberReq(req)) {
          // Two editors at once: a member's save always names the version it was made from (plan-v3 5.9).
          if (body.expectedUpdatedAt === undefined) {
            return sendError(res, 400, 'Reload this festival, then save again.', ErrorCodes.INVALID_INPUT);
          }
          const rules = organizerFestivalRules(appOrigin(config)).safeParse(body);
          if (!rules.success) return sendRuleIssues(res, rules.error);
        }
        // A member's save with a /tiles/ path already failed the rules above, so this only affects an admin.
        absolutizeTilesUrl(body.mapConfig, config.PUBLIC_ORIGIN);
        // The body is partial, so check the festival that results from the save.
        // A stored lineup is not re-checked: only a body that carries one can fail on duplicates.
        const issues = validateFestivalIssues(config, { ...existingFestival, lineup: undefined, ...body });
        if (issues.length > 0) return sendIssues(res, issues);

        // The token is checked inside the save, under the festival row lock, against the last form edit.
        // A check here would compare the cache's updatedAt, which an artist edit moves.
        const nextFestival = sanitizeFestivalPayload(body, existingFestival);
        // Until Festie verifies the organization, the name and place of a live festival change only through Festie (plan-v3 6.3).
        if (
          isMemberReq(req) &&
          existingFestival.publishedAt &&
          !(req as any).orgVerified &&
          (nextFestival.name !== existingFestival.name || (nextFestival.location ?? '') !== (existingFestival.location ?? ''))
        ) {
          return sendError(res, 403, 'Ask Festie to change the name or location of a live festival.', ErrorCodes.FORBIDDEN);
        }
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
        const cancelTellsPeople = !!cancel && cancel.picked + cancel.marked > 0 && body.notify !== false;
        // A dry run answers what this save would tell people, so an owner can confirm the count. Nothing is written.
        if (body.dryRun === true) {
          const audience = alertAudience(pickersBySet, interestedByEntry);
          const asMember = isMemberReq(req);
          const verifiedMember = asMember && (req as any).orgVerified === true;
          const wanted = body.notify !== false && audience.people > 0;
          return sendSuccess(res, {
            dryRun: true,
            scheduleNotice: {
              changes: changes.length + cancelled.length,
              notified: wanted && (!asMember || verifiedMember),
              ...(wanted && asMember && !verifiedMember ? { held: true } : {}),
              ...audienceFields(asMember, audience.people, audience.marked),
            },
            ...(verifiedMember
              ? { runsLeft: await stores.festivalReview.alertRunsLeft(existingFestival.id, config.ORGANIZER_SCHEDULE_ALERT_HOURLY_CAP) }
              : {}),
          });
        }
        if ((picks + ratings > 0 || cancelTellsPeople) && body.confirmRemovals !== true) {
          const removal = {
            days: daysSent ? Math.max(0, (existingFestival.days || []).length - nextFestival.days.length) : 0,
            sets: removedIds.length,
            picks,
            ratings,
            ...(cancel ? { cancel } : {}),
          };
          const shownRemoval = isMemberReq(req) ? removalForMember(removal) : removal;
          return sendError(
            res,
            409,
            removalMessage(shownRemoval),
            ErrorCodes.CONFIRM_REMOVALS,
            { removal: shownRemoval },
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
        const artistViewer = refsNeeded ? await memberViewer(req) : undefined;
        const festival = await stores.festivals.update(
          (req.validatedParams as Params).id,
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
                    festivalId: (req.validatedParams as { id: string }).id,
                    days: daysSent ? fields.days : undefined,
                    lineup: body.lineup !== undefined ? fields.lineup : undefined,
                    separator: nextFestival.b2bSeparator,
                    userId: req.user?.userId ?? null,
                    viewer: artistViewer,
                  });
                  return { days: refsSeen.value.days, lineup: refsSeen.value.lineup };
                }
              : undefined,
          },
        );
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        invalidateFestivalCache();

        invalidateFestivalListCache();
        // A person who picked a changed set gets that alert only, so marks are counted once.
        const { people, marked } = alertAudience(pickersBySet, interestedByEntry);
        const notified = body.notify !== false && people > 0;
        // An unverified organization's alerts are held for an admin. A verified one's go out, at most the hourly cap per
        // festival, and a save past the cap is held, so the notice is settled after the delivery below.
        const organizer = isMemberReq(req);
        const verified = organizer && (req as any).orgVerified === true;
        const scheduleNotice = {
          changes: changes.length + cancelled.length,
          notified: notified && (!organizer || verified),
          ...(notified && organizer && !verified ? { held: true } : {}),
          ...audienceFields(organizer, people, marked),
        };
        log.info('festival:updated', { festivalId: festival.id, name: festival.name });
        let alertHeld = false;
        if (notified) {
          const sending = deliverScheduleAlert({
            stores,
            emitter,
            festival,
            alert: { changes: [...changes, ...cancelled], pickersBySet, interestedByEntry },
            organizer,
            verified,
            hourlyCap: config.ORGANIZER_SCHEDULE_ALERT_HOURLY_CAP,
            log,
          });
          if (!organizer) void sending.catch((err: Error) => log.warn('schedule alert failed', { festivalId: festival.id, error: err.message }));
          else {
            // The save is committed, so a failed hold is logged for an admin to find, and the save still succeeds.
            try {
              const result = await sending;
              if (result.held) {
                alertHeld = true;
                audit(AUDIT_ACTIONS.FESTIVAL_ALERT_HELD, 'festival', festival.id, req, { changes: result.changes, people: result.people });
              }
            } catch (err) {
              log.error('schedule alert hold failed', { festivalId: festival.id, error: (err as Error).message });
            }
          }
        }
        // A verified organization's save past the hourly cap went to the held queue instead of out.
        if (alertHeld && scheduleNotice.notified) Object.assign(scheduleNotice, { notified: false, held: true });
        // The saved row lacks stages and days, so those come from the payload that was written.
        const fieldChanges = festivalAuditChanges(existingFestival, { ...nextFestival, ...festival }, daysSent);
        audit(AUDIT_ACTIONS.FESTIVAL_UPDATED, 'festival', festival.id, req, {
          name: festival.name,
          ...stats,
          scheduleChanges: changes.length + cancelled.length,
          notifiedPeople: scheduleNotice.notified ? people : 0,
          ...(Object.keys(fieldChanges).length > 0 ? { changes: fieldChanges } : {}),
        });
        // A draft has no attendees, and the event goes to every socket.
        if (existingFestival.publishedAt) emitter.festivalUpdated({ festival });
        // New sets or new names can cover a marked act. It runs after commit and logs its own failure.
        if (daysSent || body.lineup !== undefined || body.b2bSeparator !== undefined) void deps.interestConversion?.convert(festival.id);
        const venueMissing = typeof existingFestival.latitude !== 'number';
        // An admin-set venue wins over the geocoder until the location text changes in a later save.
        const venueSetByAdmin =
          venueSent &&
          (nextFestival.latitude !== existingFestival.latitude ||
            nextFestival.longitude !== existingFestival.longitude);
        // A pending organization may not geocode: the lookup calls an outside service on its text (plan 6.6).
        const wantsVenue =
          !venueSetByAdmin &&
          (req as any).orgStatus !== 'pending' &&
          (venueMissing || nextFestival.location !== existingFestival.location);
        let venueGuessed = false;
        if (wantsVenue && !organizer) venueGuessed = await fillVenueCoords(festival.id, nextFestival.location);
        else if (wantsVenue && memberGeocodesWaiting >= MEMBER_GEOCODE_QUEUE) {
          log.warn('member venue geocode dropped: queue full', { festivalId: festival.id });
        } else if (wantsVenue) {
          memberGeocodesWaiting += 1;
          void fillVenueCoords(festival.id, nextFestival.location).finally(() => {
            memberGeocodesWaiting -= 1;
          });
        }
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
      } catch (error) {
        if (error instanceof FestivalChangedError) {
          return sendError(
            res,
            409,
            'This festival changed since you opened it. Reload it, then make your change again.',
            ErrorCodes.FESTIVAL_CHANGED,
            await staleDetails(req),
          );
        }
        if ((error as NodeJS.ErrnoException)?.code === '40P01' || (error as NodeJS.ErrnoException)?.code === '40001') {
          return sendError(res, 503, 'Festie is busy. Try again.', ErrorCodes.SERVICE_UNAVAILABLE);
        }
        if (sendIdClash(res, error, isMemberReq(req))) return;
        log.error('festival update failed', { error: (error as NodeJS.ErrnoException).message, festivalId: (req.validatedParams as Params)?.id });
        return sendError(res, 500, 'Failed to update festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // How many people, crews and picks lose access if this festival is deleted.
  router.get('/:id/impact', festivalAccess({ action: 'festival.impact' }), validateParams(schemas.genericIdParams), async (req: Request, res: Response) => {
    try {
      const festival = await getFestivalById((req.validatedParams as Params).id);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      const impact = await stores.festivals.countImpact(festival.id);
      if (!isMemberReq(req)) return sendSuccess(res, impact);
      // An organizer learns who uses a live festival only from ENGAGEMENT_MIN_JOINED joined users up, and no single
      // count under ENGAGEMENT_MIN_COUNT (owner decision 4). A hidden count reads 0.
      const open = organizerAudience(impact.profiles) !== null;
      const shown = (n: number) => (open && n >= ENGAGEMENT_MIN_COUNT ? n : 0);
      return sendSuccess(res, { profiles: open ? impact.profiles : 0, crews: shown(impact.crews), picks: shown(impact.picks) });
    } catch (error) {
      log.error('festival impact failed', { error: (error as NodeJS.ErrnoException).message, festivalId: (req.validatedParams as Params)?.id });
      return sendError(res, 500, 'Failed to count who uses this festival', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // The owners of an organization hear the decision on a publish request by email. Fire and forget: the
  // decision is already saved, so a mail failure only logs.
  function emailDecision(organizationId: string | null | undefined, festivalName: string, decision: 'approved' | 'declined', note?: string) {
    if (!organizationId) return;
    void (async () => {
      const [organization, owners] = await Promise.all([
        stores.organizations.getById(organizationId),
        stores.organizations.ownerEmails(organizationId),
      ]);
      if (!organization) return;
      // A test seam: deps.sendPublishDecisionEmail replaces the mail send.
      const send = deps.sendPublishDecisionEmail ?? sendPublishDecisionEmail;
      for (const to of owners) {
        await send({ to, organizationName: organization.name, festivalName, decision, note, config, log });
      }
    })().catch((err: Error) => log.warn('publish decision email failed', { organizationId, error: err.message }));
  }

  // Publish a draft once the checklist has no 'todo' item. There is no unpublish:
  // it would cut off attendees with picks. Delete and Restore cover mistakes.
  // An admin publishes any festival and so approves a request. An organization publishes its own only once Festie
  // has verified it (owner decision 8); every other organization submits for review instead.
  router.post(
    '/:id/publish',
    festivalAccess({
      action: 'publish.direct',
      allow: (_req, _festival, membership) =>
        membership.verified ? true : refusal('Festie checks the first publish of your organization. Submit this festival for review.'),
    }),
    rateLimit(10, 'festival-publish'),
    validateParams(schemas.genericIdParams),
    async (req: Request, res: Response) => {
      try {
        const festival = await getFestivalById((req.validatedParams as Params).id);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        const checklist = publishChecklist(config, festival, { ambiguousNames: await ambiguousNamesOf(festival, req) });
        if (festival.publishedAt) return sendSuccess(res, { publishedAt: festival.publishedAt, checklist });
        if (checklist.some((item: any) => item.status === 'todo')) {
          return sendError(res, 409, 'Finish the checklist before you publish.', ErrorCodes.PUBLISH_BLOCKED, {
            checklist,
          });
        }
        // Read before the publish, which clears the request.
        const waiting = !isMemberReq(req) && !!(await stores.festivalReview?.reviewState?.(festival.id))?.requestedAt;
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
        if (waiting) emailDecision((req as any).organizationId, festival.name, 'approved');
        return sendSuccess(res, { publishedAt: row.publishedAt, checklist });
      } catch (error) {
        log.error('festival publish failed', { error: (error as NodeJS.ErrnoException).message, festivalId: (req.validatedParams as Params)?.id });
        return sendError(res, 500, 'Failed to publish festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Decline a publish request with a note the organization's owners read. The festival stays a draft, and
  // submitting again clears the note. Only a platform admin: the manage mount does not list this route.
  router.post(
    '/:id/publish/decline',
    festivalAccess({ action: 'publish.decide' }),
    rateLimit(10, 'festival-publish-decline'),
    validateParams(schemas.genericIdParams),
    validate(schemas.publishDecline),
    async (req: Request, res: Response) => {
      try {
        const id = (req.validatedParams as Params).id;
        const { note } = req.validatedBody as { note: string };
        const declined = await stores.festivalReview.declinePublish(id, note);
        if (!declined) {
          const festival = await getFestivalById(id);
          if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
          return sendError(res, 409, 'No review request is waiting for this festival.', ErrorCodes.CONFLICT);
        }
        audit(AUDIT_ACTIONS.FESTIVAL_PUBLISH_DECLINED, 'festival', id, req, { name: declined.name, note });
        log.info('festival:publish-declined', { festivalId: id });
        emailDecision(declined.organizationId, declined.name, 'declined', note);
        return sendSuccess(res, { declined: true });
      } catch (error) {
        log.error('festival publish decline failed', { error: (error as NodeJS.ErrnoException).message, festivalId: (req.validatedParams as Params)?.id });
        return sendError(res, 500, 'Failed to decline the request', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Bring a soft-deleted festival back. It keeps its published state.
  router.post(
    '/:id/restore',
    festivalAccess({ action: 'festival.restore' }),
    rateLimit(10, 'festival-restore'),
    validateParams(schemas.genericIdParams),
    async (req: Request, res: Response) => {
      try {
        const id = (req.validatedParams as Params).id;
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
      } catch (error) {
        log.error('festival restore failed', { error: (error as NodeJS.ErrnoException).message, festivalId: (req.validatedParams as Params)?.id });
        return sendError(res, 500, 'Failed to restore festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // P3.18: Soft-delete (default). Pass ?hard=true for permanent removal.
  router.delete(
    '/:id',
    festivalAccess({
      action: 'festival.delete',
      // A member may delete a draft softly. A live festival and a permanent delete stay with Festie.
      allow: (req, festival) => {
        if (festival.publishedAt) return refusal('Only Festie can delete a festival that is live. Contact Festie.');
        if (req.query?.hard === 'true') return refusal('Only Festie can delete a festival permanently.');
        return true;
      },
    }),
    rateLimit(5, 'festival-delete'),
    requireRecentAuth,
    validateParams(schemas.genericIdParams),
    validateQuery(schemas.festivalDeleteQuery),
    async (req: Request, res: Response) => {
      try {
        const festival = await getFestivalById((req.validatedParams as Params).id);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        const festivalId = festival.id;
        const hardDelete = (req.validatedQuery as Query).hard === 'true';

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

        await removeFestivalSockets(festivalId, io);
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
      } catch (error) {
        log.error('festival delete failed', { error: (error as NodeJS.ErrnoException).message, festivalId: (req.validatedParams as Params)?.id });
        return sendError(res, 500, 'Failed to delete festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // PUT /:festivalId/sets/:setId/link — Admin: set a Spotify/SoundCloud link on a set
  router.put(
    '/:festivalId/sets/:setId/link',
    festivalAccess({ action: 'links.edit', param: 'festivalId' }),
    rateLimit(10, 'set-link'),
    validate(schemas.setLink),
    async (req: Request, res: Response) => {
      try {
        const festivalId = (req as { festivalId?: string }).festivalId as string;
        const setId = req.params.setId as string;
        const { linkUrl, artistIndex = 0 } = req.validatedBody as z.infer<typeof schemas.setLink>;

        if (!festivalId || !setId)
          return sendError(res, 400, 'Festival and set IDs required', ErrorCodes.INVALID_INPUT);

        const festival = await getFestivalById(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

        // Validated by Zod schema — normalize to null if empty
        const cleanUrl = linkUrl && typeof linkUrl === 'string' && linkUrl.trim() ? linkUrl.trim() : null;
        // A member's link must be a profile on Spotify (lib/artist-links.ts); an admin's keeps the wider rule.
        if (isMemberReq(req) && cleanUrl) {
          const checked = normalizeArtistLink('spotify', cleanUrl);
          if (!checked.ok) return sendError(res, 400, checked.message, ErrorCodes.INVALID_INPUT);
        }

        // One transaction under the festival lock, reading the set row itself, so a link edit never
        // rebuilds a set from a cache and never races a festival save.
        const outcome = await stores.festivals.setSpotifyLink(festivalId, setId, artistIndex, cleanUrl);
        if (outcome.missing) return sendError(res, 404, outcome.missing, ErrorCodes.NOT_FOUND);
        if (outcome.badIndex) return sendError(res, 400, 'That artist is not on this set.', ErrorCodes.INVALID_INPUT);
        if (outcome.artistId) {
          const current = await stores.artists.getById(outcome.artistId);
          // A member never writes a Spotify link: it is a suggestion that an admin decides (artist plan 8.3).
          if (isMemberReq(req)) {
            const suggested = await stores.artists.organizerUpdate(
              outcome.artistId,
              { expectedUpdatedAt: new Date(current.updated_at).toISOString(), changes: { spotifyLink: cleanUrl }, festivalId, ip: getRequestIp(req) },
              await memberViewer(req),
            );
            return sendSuccess(res, { setId, artistIndex, linkUrl: current.links?.spotify ?? null, suggested: suggested.status === 'suggested' });
          }
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
      } catch (error) {
        if (error instanceof ArtistError) return sendError(res, error.status, error.message, ErrorCodes[error.code], error.details);
        log.error('set link update failed', { error: (error as NodeJS.ErrnoException).message });
        return sendError(res, 500, 'Failed to update set link', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // GET /:festivalId/sets/links — Admin: list all set links for a festival
  router.get('/:festivalId/sets/links', festivalAccess({ action: 'links.edit', param: 'festivalId' }), async (req: Request, res: Response) => {
    try {
      const festivalId = (req as { festivalId?: string }).festivalId;
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      if (!(await stores.festivals.exists(festivalId))) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      return sendSuccess(res, await stores.festivals.listSetLinks(festivalId));
    } catch (error) {
      log.error('set links list failed', { error: (error as NodeJS.ErrnoException).message });
      return sendError(res, 500, 'Failed to load set links', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
