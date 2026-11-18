// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { ArtistError, isCurrentOrUpcoming, publicArtist, type SyncedFestival } from '../lib/db/stores/artists.js';

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

  router.get('/:id/impact', validateParams(schemas.genericIdParams), async (req: any, res: any) => {
    try {
      const festivals = await stores.artists.impact(req.validatedParams.id);
      return sendSuccess(res, { festivals });
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
        const result = await stores.artists.update(id, { expectedUpdatedAt, changes, userId: req.user?.userId ?? null });
        await afterSync(result.synced);
        audit(AUDIT_ACTIONS.ARTIST_UPDATED, id, req, {
          name: result.artist.name,
          ...(result.before.name !== result.artist.name ? { renamedFrom: result.before.name } : {}),
          fields: Object.keys(changes).filter((key) => changes[key] !== undefined),
          festivalsUpdated: result.synced.length,
        });
        log.info('artist:updated', { artistId: id, festivals: result.synced.length });
        return sendSuccess(res, { artist: publicArtist(result.artist), festivalsUpdated: result.synced.length });
      } catch (error: any) {
        return sendArtistError(res, error, 'update the artist');
      }
    },
  );

  return router;
}
