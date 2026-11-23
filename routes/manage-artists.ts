// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The artist routes of an organization member, mounted by routes/manage.ts at /api/v1/manage/artists (so they exist
 * only while ORGANIZER_PLATFORM_ENABLED is on, behind userAuth). They apply the artist rules of plan section 8:
 *   - A member sees an artist only when it is used on a published festival, used on a festival of the member's
 *     organizations, or created by the member itself (lib/db/stores/artist-visibility.ts). Nothing in any answer differs
 *     because a hidden artist exists.
 *   - A member creates artists (unverified) and uses existing ones on its festivals through the festival save.
 *   - A member edits an artist directly only while every festival that lists it belongs to its organizations. Filling
 *     an empty non-Spotify link of a shared artist saves at once and is flagged. Every other change to a shared
 *     artist, and every Spotify change, becomes a suggestion that an admin decides.
 * Reads need any role. Writes need an owner or editor of an organization that is not suspended.
 */

import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { createAdminAuditWriter } from '../lib/audit-middleware.js';
import { ArtistError, viewerArtist, type ArtistViewer } from '../lib/db/stores/artists.js';
import { mayWriteArtists } from '../lib/artist-viewer.js';

type OrgRow = { id: string; role: 'owner' | 'editor' | 'viewer'; status: 'pending' | 'active' | 'suspended' };

export default function createManageArtistsRoutes(deps: any) {
  const { express, log, stores, rateLimit, validate, validateQuery, validateParams, schemas, sendSuccess, sendError, ErrorCodes, getRequestIp } =
    deps;
  const writeAudit = createAdminAuditWriter({ stores, log, getRequestIp });
  const router = express.Router();

  // Sets req.artistViewer, or sends the refusal. `write` also needs a role that may change artists.
  const access = (write: boolean) => async (req: any, res: any, next: any) => {
    try {
      const orgs: OrgRow[] = await stores.organizations.listForUser(req.user.userId);
      if (orgs.length === 0) return sendError(res, 403, 'Join an organization to use artists.', ErrorCodes.FORBIDDEN);
      const named = write ? req.body?.organizationId : undefined;
      const acting = named ? orgs.find((org) => org.id === named) : orgs.find(mayWriteArtists) ?? orgs[0];
      if (!acting) return sendError(res, 404, 'Organization not found', ErrorCodes.NOT_FOUND);
      if (write && !mayWriteArtists(acting)) {
        const message =
          acting.status === 'suspended'
            ? "Your organization's access is paused."
            : 'Only an owner or editor of your organization can change artists.';
        return sendError(res, 403, message, ErrorCodes.FORBIDDEN);
      }
      const viewer: ArtistViewer = {
        userId: req.user.userId,
        organizationIds: orgs.map((org) => org.id),
        organizationId: acting.id,
        mayWrite: mayWriteArtists(acting),
      };
      req.artistViewer = viewer;
      // The audit writer reads these two for the row's actor and organization.
      req.festivalRole = acting.role;
      req.organizationId = acting.id;
      return next();
    } catch (error) {
      log.error('manage artist access failed', { error: (error as Error).message });
      return sendError(res, 500, 'Failed to check your access', ErrorCodes.INTERNAL_ERROR);
    }
  };

  function sendArtistError(res: any, error: unknown, what: string) {
    if (error instanceof ArtistError) return sendError(res, error.status, error.message, ErrorCodes[error.code], error.details);
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === '40P01' || code === '40001') return sendError(res, 503, 'Festie is busy. Try again.', ErrorCodes.SERVICE_UNAVAILABLE);
    log.error(what, { error: (error as Error)?.message });
    return sendError(res, 500, `Failed to ${what}`, ErrorCodes.INTERNAL_ERROR);
  }

  // The artists a member may see, by name. The festival's own artists come with its payload.
  router.get('/', access(false), rateLimit(60, 'manage-artist-list'), validateQuery(schemas.organizerArtistListQuery), async (req: any, res: any) => {
    try {
      const { q, limit } = req.validatedQuery;
      return sendSuccess(res, { artists: await stores.artists.list({ query: q, limit: limit ?? 20 }, req.artistViewer) });
    } catch (error) {
      return sendArtistError(res, error, 'load artists');
    }
  });

  router.post('/match', access(false), rateLimit(60, 'manage-artist-match'), validate(schemas.artistMatch), async (req: any, res: any) => {
    try {
      return sendSuccess(res, { results: await stores.artists.match(req.validatedBody.items, req.artistViewer) });
    } catch (error) {
      return sendArtistError(res, error, 'match artists');
    }
  });

  // The suggestions of the member's organizations, so a row can read "Pending review" and show the decision.
  router.get('/suggestions', access(false), rateLimit(60, 'manage-artist-suggestions'), async (req: any, res: any) => {
    try {
      return sendSuccess(res, { suggestions: await stores.artists.ownSuggestions(req.artistViewer) });
    } catch (error) {
      return sendArtistError(res, error, 'load your suggestions');
    }
  });

  router.post('/', access(true), rateLimit(10, 'manage-artist-create'), validate(schemas.organizerArtistCreate), async (req: any, res: any) => {
    try {
      const { organizationId: _organizationId, ...input } = req.validatedBody;
      const artist = await stores.artists.create({ ...input, userId: req.user.userId }, req.artistViewer);
      await writeAudit(req, res, {
        action: AUDIT_ACTIONS.ARTIST_CREATED,
        targetType: 'artist',
        targetId: artist.id,
        details: { name: artist.name, label: artist.label_auto ? '' : artist.label },
      });
      res.status(201);
      return sendSuccess(res, { artist: viewerArtist(artist) });
    } catch (error) {
      return sendArtistError(res, error, 'create the artist');
    }
  });

  // Where the artist plays, for the festivals the member may see. A stranger's draft is neither named nor counted.
  router.get('/:id/impact', access(false), validateParams(schemas.genericIdParams), async (req: any, res: any) => {
    try {
      return sendSuccess(res, await stores.artists.impact(req.validatedParams.id, new Date(), req.artistViewer));
    } catch (error) {
      return sendArtistError(res, error, 'count where the artist plays');
    }
  });

  router.patch(
    '/:id',
    access(true),
    rateLimit(30, 'manage-artist-update'),
    validateParams(schemas.genericIdParams),
    validate(schemas.organizerArtistUpdate),
    async (req: any, res: any) => {
      try {
        const { expectedUpdatedAt, changes } = req.validatedBody;
        const result = await stores.artists.organizerUpdate(
          req.validatedParams.id,
          { expectedUpdatedAt, changes, ip: getRequestIp(req) },
          req.artistViewer,
        );
        // The store wrote the audit row in the transaction.
        res.locals.auditWritten = true;
        if (result.status === 'suggested') {
          res.status(202);
          return sendSuccess(res, {
            status: 'suggested',
            suggestionId: result.suggestionId,
            message: 'Sent for review. Until an admin decides, every festival shows the current details.',
          });
        }
        await deps.afterArtistSync?.(result.synced);
        log.info('artist:updated', { artistId: req.validatedParams.id, festivals: result.synced.length, organizer: true });
        return sendSuccess(res, {
          status: 'saved',
          artist: viewerArtist(result.artist),
          festivalsUpdated: result.synced.length,
          // A fill of a shared artist's empty link saved at once and is flagged for the admin's review.
          flagged: result.fill,
        });
      } catch (error) {
        return sendArtistError(res, error, 'update the artist');
      }
    },
  );

  return router;
}
