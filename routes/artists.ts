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

/** Artists searched per "Find Spotify links" run. The rest wait for the next run, after the editor skips or links these. */
const MAX_CANDIDATE_ARTISTS = 150;

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
    invalidateFestivalCache,
    config,
  } = deps;

  const router = express.Router();

  function sendArtistError(res: any, error: any, what: string) {
    if (error instanceof ArtistError) {
      return sendError(res, error.status, error.message, ErrorCodes[error.code], error.details);
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

  router.get('/', validateQuery(schemas.artistListQuery), async (req: any, res: any) => {
    try {
      const { festivalId, q, limit } = req.validatedQuery;
      const artists = await stores.artists.list({ festivalId, query: q, limit: limit ?? (festivalId ? 1000 : 200) });
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
              acceptShared: pick.acceptShared === true,
              userId: req.user?.userId ?? null,
            });
            if (outcome.status === 'shared') {
              results.push({ ...result, status: 'shared', alsoOn: outcome.alsoOn });
              continue;
            }
            for (const festival of outcome.synced) {
              const have = synced.get(festival.id);
              synced.set(festival.id, have ? { ...have, setIds: [...have.setIds, ...festival.setIds] } : festival);
            }
            const { before, artist: after } = outcome;
            // A pick links Spotify and also fills an empty photo or genre list: audit what really changed.
            const fields = [
              ...(before.links?.spotify !== after.links?.spotify ? ['spotify'] : []),
              ...(before.photo !== after.photo ? ['photo'] : []),
              ...(JSON.stringify(before.genres ?? []) !== JSON.stringify(after.genres ?? []) ? ['genres'] : []),
            ];
            audit(AUDIT_ACTIONS.ARTIST_UPDATED, pick.artistId, req, {
              name: after.name,
              fields,
              via: 'spotify-pick',
              festivalsUpdated: outcome.synced.length,
              before: { name: before.name, label: before.label, links: before.links ?? {}, photo: before.photo ?? null, genres: before.genres ?? [] },
              after: { name: after.name, label: after.label, links: after.links ?? {}, photo: after.photo ?? null, genres: after.genres ?? [] },
              festivalIds: outcome.synced.slice(0, 200).map((festival: SyncedFestival) => festival.id),
            });
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

  return router;
}
