// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import {
  ArtistError,
  artistTitle,
  isCurrentOrUpcoming,
  liveArtistsBySpotifyId,
  publicArtist,
  type SyncedFestival,
} from '../lib/db/stores/artists.js';
import * as spotify from '../lib/spotify.js';
import { applyBackfillPlan, planBackfill, verifyBackfill } from '../lib/artist-backfill.js';

/** Artists searched per "Find Spotify links" run. The rest wait for the next run, after the editor skips or links these. */
const MAX_CANDIDATE_ARTISTS = 150;

// Postgres advisory lock key ("FESTIE_A"), next to the migration runner's "FESTIE_M" key. Two runs never overlap.
const BACKFILL_LOCK_KEY = '5063544977519632193';

/**
 * Artist routes, admin only, mounted at /api/v1/admin/artists. An edit changes every festival that
 * lists the artist, past ones too. The festival copies are rewritten in the
 * same transaction as the artist row, so no reader ever sees them disagree.
 */
export default function createArtistsRoutes(deps: any) {
  const {
    express,
    log,
    stores,
    emitter,
    rateLimit,
    validate,
    validateQuery,
    validateParams,
    schemas,
    sendSuccess,
    sendError,
    ErrorCodes,
    getRequestIp,
    requireRecentAuth,
    invalidateFestivalCache,
    setNoStore,
    config,
  } = deps;
  // deps.artistBackfill lets a route test swap the three backfill steps.
  const backfill = deps.artistBackfill ?? { planBackfill, applyBackfillPlan, verifyBackfill };

  const router = express.Router();

  function sendArtistError(res: any, error: any, what: string) {
    if (error instanceof ArtistError) {
      return sendError(res, error.status, error.message, ErrorCodes[error.code], error.details);
    }
    if (error?.code === 'SPOTIFY_RATE_LIMITED') {
      return sendError(res, 503, 'Spotify is busy right now. Try again in a minute.', ErrorCodes.SPOTIFY_RATE_LIMITED);
    }
    // The database gave up on a deadlock or a serialization failure after the retries.
    if (error?.code === '40P01' || error?.code === '40001') {
      return sendError(res, 503, 'Festie is busy. Try again.', ErrorCodes.SERVICE_UNAVAILABLE);
    }
    log.error(what, { error: error?.message });
    return sendError(res, 500, `Failed to ${what}`, ErrorCodes.INTERNAL_ERROR);
  }

  // Same shape as the festival routes' audit helper: after the response, and a failure only logs.
  function audit(action: string, artistId: string, req: any, details: Record<string, unknown>) {
    if (!stores.auditLog) return;
    if (req.res?.locals) req.res.locals.auditWritten = true;
    Promise.resolve().then(async () => {
      try {
        await stores.auditLog.insert({
          id: crypto.randomUUID(),
          actorType: 'admin',
          actorId: req.user?.userId,
          action,
          targetType: 'artist',
          targetId: artistId,
          detailsJson: JSON.stringify(details),
          ip: getRequestIp(req),
        });
      } catch (e: any) {
        log.warn('audit log write failed', { error: e.message });
      }
    });
  }

  /**
   * After the commit: refresh the caches and the Spotify preview cache once, and tell clients only
   * about published festivals that are current or upcoming (each emit sends a silent push). Past
   * festivals refresh on their next online fetch. Never throws: the write is already committed.
   */
  async function afterSync(synced: SyncedFestival[]) {
    if (synced.length === 0) return;
    try {
      invalidateFestivalCache();
      deps.invalidateFestivalListCache?.();
      for (const festival of synced) for (const setId of festival.setIds) deps.clearSpotifyPreview?.(setId);
      for (const festival of synced) {
        if (festival.published && isCurrentOrUpcoming(festival)) emitter.festivalUpdated({ festival: { id: festival.id } });
      }
    } catch (error: any) {
      log.warn('artist sync follow-up failed', { error: error?.message });
    }
  }
  // The single-link set route and the Spotify fill write through the same follow-up.
  deps.afterArtistSync = afterSync;

  // The duplicates list scans every live artist, so it is limited; the plain lists are not.
  const duplicatesLimit = rateLimit(30, 'artist-duplicates');
  router.get('/', validateQuery(schemas.artistListQuery), (req: any, res: any, next: any) => (req.validatedQuery.duplicates === 'true' ? duplicatesLimit(req, res, next) : next()), async (req: any, res: any) => {
    try {
      const { festivalId, q, limit, duplicates } = req.validatedQuery;
      const artists = await stores.artists.list({
        festivalId,
        query: q,
        duplicates: duplicates === 'true',
        limit: limit ?? (festivalId && !duplicates ? 1000 : 200),
      });
      return sendSuccess(res, { artists });
    } catch (error: any) {
      return sendArtistError(res, error, 'load artists');
    }
  });

  router.post('/match', rateLimit(60, 'artist-match'), validate(schemas.artistMatch), async (req: any, res: any) => {
    try {
      return sendSuccess(res, { results: await stores.artists.match(req.validatedBody.items) });
    } catch (error: any) {
      return sendArtistError(res, error, 'match artists');
    }
  });

  router.post('/', rateLimit(30, 'artist-create'), validate(schemas.artistCreate), async (req: any, res: any) => {
    try {
      const artist = await stores.artists.create({ ...req.validatedBody, userId: req.user?.userId ?? null });
      audit(AUDIT_ACTIONS.ARTIST_CREATED, artist.id, req, { name: artist.name, label: artist.label });
      res.status(201);
      return sendSuccess(res, { artist: publicArtist(artist) });
    } catch (error: any) {
      return sendArtistError(res, error, 'create the artist');
    }
  });

  /** The two Spotify routes need the client-credentials keys. Sends the 400 and returns it when they are not set. */
  function spotifyKeysMissing(res: any) {
    if (config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET) return null;
    return sendError(res, 400, 'Spotify API credentials not configured', ErrorCodes.INVALID_INPUT);
  }

  /**
   * "Find Spotify links": the top 3 Spotify candidates for each artist on the festival that has no
   * Spotify link. Writes nothing. A row is `singleExact` when exactly one candidate has the artist's
   * name and no other artist holds its Spotify id, and the name is not shared with another artist:
   * same-name artists are always picked by hand.
   */
  router.post(
    '/spotify-candidates',
    rateLimit(6, 'artist-spotify-search'),
    validate(schemas.artistSpotifyCandidates),
    async (req: any, res: any) => {
      try {
        const missing = spotifyKeysMissing(res);
        if (missing) return missing;
        const { festivalId, exclude } = req.validatedBody;
        const skipped = new Set<string>(exclude ?? []);
        const rows = (await stores.artists.list({ festivalId, limit: 1000 })).filter(
          (row: any) => !row.links?.spotify && !skipped.has(row.id),
        );
        const searched = rows.slice(0, MAX_CANDIDATE_ARTISTS);
        const found: Map<string, any[]> = await spotify.bulkSearchCandidates(
          [...new Set(searched.map((row: any) => row.name))],
          config.SPOTIFY_CLIENT_ID,
          config.SPOTIFY_CLIENT_SECRET,
          { log },
        );
        const heldBy = await liveArtistsBySpotifyId(
          stores.pool,
          [...new Set([...found.values()].flat().map((candidate: any) => candidate.spotifyId))],
        );
        let searchFailed = 0;
        const artists = searched.map((artist: any) => {
          const hits = found.get(artist.name);
          if (!hits) searchFailed++;
          const candidates = (hits ?? []).map((candidate: any) => {
            const holder = heldBy.get(candidate.spotifyId);
            return { ...candidate, linkedTo: holder ? artistTitle(holder) : null };
          });
          const exact = candidates.filter((candidate: any) => candidate.exact);
          const singleExact = !artist.sameName && exact.length === 1 && exact[0].linkedTo === null;
          return { artist, candidates, singleExact };
        });
        return sendSuccess(res, { artists, notSearched: rows.length - searched.length, searchFailed });
      } catch (error: any) {
        return sendArtistError(res, error, 'search Spotify');
      }
    },
  );

  /**
   * The editor's Spotify picks, one artist at a time, each in its own transaction. The client sends
   * only the Spotify id: the link, photo and genres come from Spotify. A pick that cannot be applied
   * (stale token, taken id, artist now on other festivals) is reported on its own row, and the rest still apply.
   */
  router.post(
    '/spotify-picks',
    rateLimit(20, 'artist-spotify-pick'),
    validate(schemas.artistSpotifyPicks),
    async (req: any, res: any) => {
      try {
        const missing = spotifyKeysMissing(res);
        if (missing) return missing;
        const { festivalId, picks } = req.validatedBody;
        const details: Map<string, any> = await spotify.getArtistsByIds(
          [...new Set<string>(picks.map((pick: any) => pick.spotifyId))],
          config.SPOTIFY_CLIENT_ID,
          config.SPOTIFY_CLIENT_SECRET,
          { log },
        );
        const results: any[] = [];
        const synced = new Map<string, SyncedFestival>();
        for (const pick of picks) {
          const result: any = { artistId: pick.artistId };
          const spotifyArtist = details.get(pick.spotifyId);
          if (!spotifyArtist) {
            results.push({ ...result, status: 'unavailable', message: 'Spotify did not return that artist. Try again.' });
            continue;
          }
          try {
            const outcome = await stores.artists.pickSpotify(pick.artistId, {
              festivalId,
              expectedUpdatedAt: pick.expectedUpdatedAt,
              spotify: { spotifyId: pick.spotifyId, photo: spotifyArtist.imageUrl, genres: spotifyArtist.genres },
              acceptedAlsoOn: pick.acceptedAlsoOn ?? 0,
              userId: req.user?.userId ?? null,
              ip: getRequestIp(req),
            });
            if (outcome.status === 'shared') {
              results.push({ ...result, status: 'shared', alsoOn: outcome.alsoOn });
              continue;
            }
            for (const festival of outcome.synced) {
              const have = synced.get(festival.id);
              synced.set(festival.id, have ? { ...have, setIds: [...have.setIds, ...festival.setIds] } : festival);
            }
            // The store wrote the audit row in the pick's transaction.
            if (req.res?.locals) req.res.locals.auditWritten = true;
            results.push({ ...result, status: 'saved', artist: publicArtist(outcome.artist), festivalsUpdated: outcome.synced.length });
          } catch (error: any) {
            if (!(error instanceof ArtistError)) {
              log.error('spotify pick failed', { artistId: pick.artistId, error: error?.message });
              results.push({ ...result, status: 'error', message: "Couldn't save this pick. Try again." });
            } else if (error.code === 'ARTIST_CHANGED') {
              results.push({ ...result, status: 'changed', message: error.message, artist: error.details?.artist });
            } else {
              results.push({ ...result, status: error.code === 'ARTIST_EXISTS' ? 'taken' : 'error', message: error.message });
            }
          }
        }
        await afterSync([...synced.values()]);
        return sendSuccess(res, { results });
      } catch (error: any) {
        return sendArtistError(res, error, 'save the Spotify picks');
      }
    },
  );

  /**
   * The artist id backfill, the sanctioned production path (scripts/artist-backfill.ts refuses
   * production by design). It runs on the app's own pool, so it skips assertSafeBackfillDatabase on purpose.
   * dry-run and verify write nothing. run needs a recent re-auth, holds an advisory lock, writes one audit
   * row and clears the festival caches, which the script cannot do.
   */
  const runOnlyReauth = (req: any, res: any, next: any) => (req.validatedBody.mode === 'run' ? requireRecentAuth(req, res, next) : next());
  router.post('/backfill', rateLimit(10, 'artist-backfill'), validate(schemas.artistBackfill), runOnlyReauth, async (req: any, res: any) => {
    const { mode } = req.validatedBody;
    let lock: any = null;
    let held = false;
    try {
      setNoStore(res);
      const pool = stores.pool;
      if (mode === 'verify') return sendSuccess(res, { mode, result: await backfill.verifyBackfill(pool) });
      if (mode === 'dry-run') return sendSuccess(res, { mode, report: (await backfill.planBackfill(pool)).report });

      lock = await pool.connect();
      const { rows } = await lock.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [BACKFILL_LOCK_KEY]);
      held = !!rows[0]?.locked;
      if (!held) {
        return sendError(res, 409, 'An artist backfill is already running. Wait for it to finish.', ErrorCodes.ALREADY_EXISTS);
      }
      const plan = await backfill.planBackfill(pool);
      const result = await backfill.applyBackfillPlan(pool, plan);
      // The data is committed: a failed cache or audit step must not turn into an error response.
      try {
        invalidateFestivalCache();
        deps.invalidateFestivalListCache?.();
      } catch (error: any) {
        log.warn('artist backfill cache clear failed', { error: error?.message });
      }
      audit(AUDIT_ACTIONS.ARTIST_BACKFILL_RUN, result.runId, req, {
        runId: result.runId,
        counts: plan.report.counts,
        festivalsWritten: result.festivalsWritten.length,
        festivalsSkipped: result.festivalsSkipped.length,
        artistsCreated: result.artistsCreated,
        conflicts: result.conflicts.length,
      });
      log.info('artist:backfilled', { runId: result.runId, artistsCreated: result.artistsCreated });
      return sendSuccess(res, { mode, report: plan.report, result });
    } catch (error: any) {
      return sendArtistError(res, error, 'run the artist backfill');
    } finally {
      if (lock) {
        let unlocked = !held;
        if (held) {
          try {
            await lock.query('SELECT pg_advisory_unlock($1::bigint)', [BACKFILL_LOCK_KEY]);
            unlocked = true;
          } catch (error: any) {
            log.warn('artist backfill unlock failed', { error: error?.message });
          }
        }
        // A session that kept the lock is destroyed, not returned to the pool.
        lock.release(!unlocked);
      }
    }
  });

  router.get('/:id/impact',validateParams(schemas.genericIdParams), async (req: any, res: any) => {
    try {
      return sendSuccess(res, await stores.artists.impact(req.validatedParams.id));
    } catch (error: any) {
      return sendArtistError(res, error, 'count where the artist plays');
    }
  });

  router.patch(
    '/:id',
    rateLimit(60, 'artist-update'),
    validateParams(schemas.genericIdParams),
    validate(schemas.artistUpdate),
    async (req: any, res: any) => {
      try {
        const id = req.validatedParams.id;
        const { expectedUpdatedAt, changes } = req.validatedBody;
        const result = await stores.artists.update(id, { expectedUpdatedAt, changes, userId: req.user?.userId ?? null, ip: getRequestIp(req) });
        await afterSync(result.synced);
        // The store wrote the audit row in the edit's transaction.
        if (req.res?.locals) req.res.locals.auditWritten = true;
        log.info('artist:updated', { artistId: id, festivals: result.synced.length });
        return sendSuccess(res, { artist: publicArtist(result.artist), festivalsUpdated: result.synced.length });
      } catch (error: any) {
        return sendArtistError(res, error, 'update the artist');
      }
    },
  );

  /**
   * Merges the artist in the path (the survivor) with `loserId`. Admin only and web only: the loser
   * becomes a tombstone, every festival that lists it, archived ones too, lists the survivor, and the
   * moved refs are recorded on the tombstone. A recent re-auth is required, as for a festival delete.
   * The store writes the audit row in the merge's transaction.
   */
  router.post(
    '/:id/merge',
    rateLimit(10, 'artist-merge'),
    requireRecentAuth,
    validateParams(schemas.genericIdParams),
    validate(schemas.artistMerge),
    async (req: any, res: any) => {
      try {
        const { loserId, survivorUpdatedAt, loserUpdatedAt, acceptedFestivals, pick } = req.validatedBody;
        const result = await stores.artists.merge({
          survivorId: req.validatedParams.id,
          loserId,
          survivorUpdatedAt,
          loserUpdatedAt,
          acceptedFestivals,
          pick: pick ?? {},
          userId: req.user?.userId ?? null,
          ip: getRequestIp(req),
        });
        await afterSync(result.synced);
        if (req.res?.locals) req.res.locals.auditWritten = true;
        log.info('artist:merged', { survivorId: req.validatedParams.id, loserId, ...result.counts });
        return sendSuccess(res, { artist: publicArtist(result.artist), loserId, counts: result.counts });
      } catch (error: any) {
        return sendArtistError(res, error, 'merge the artists');
      }
    },
  );

  return router;
}
