/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Lineup Import Routes — preview, commit, history and undo
 *
 * POST /api/v1/admin/festivals/:id/import-lineup/preview   → LineupImportPlan
 * POST /api/v1/admin/festivals/:id/import-lineup           → { committed: false, plan } | { committed: true, result, plan }
 * GET  /api/v1/admin/festivals/:id/imports                 → { festivalName, imports }
 * POST /api/v1/admin/festivals/:id/imports/:importId/undo  → LineupImportUndoResult
 *
 * The client parses the CSV or TSV file and posts JSON rows (lineupImportRequestSchema).
 * planLineupImport decides each row; commit plans again inside the write transaction.
 * Imports never delete sets and never notify users: the lineup announcement is a
 * separate, manual admin action.
 *
 * If SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are configured, commit searches
 * Spotify once for the artists of new sets that have no link.
 */

import crypto from 'crypto';
import { lineupImportRequestSchema } from '../lib/schemas.js';
import {
  artistsNeedingLinks,
  planLineupImport,
  type LineupImportPlan,
  type LineupImportWrites,
  type SpotifyHit,
} from '../lib/lineup-import-plan.js';

const SKIPPED_MESSAGE = 'Matches an existing set. Not updated because Update sets that match was off.';

const makeId = (prefix: string) => `${prefix}-${crypto.randomBytes(6).toString('hex')}`;

/** One result entry per request row, plus the counts the admin sees after a commit. */
function buildResult(plan: LineupImportPlan, writes: LineupImportWrites, importId: string, warnings: string[], sep: string) {
  const insertByIndex = new Map(writes.inserts.map((s) => [s.index, s]));
  const updated = new Set(writes.updates.map((u) => u.index));
  const rows = plan.rows.map((r, i) => {
    const artist = r.artists.join(` ${sep} `);
    const insert = insertByIndex.get(i);
    if (insert) return { row: r.row, status: 'created' as const, setId: insert.id, artist, message: 'Added.' };
    if (updated.has(i)) {
      return { row: r.row, status: 'updated' as const, setId: r.setId, artist, message: `Updated: ${r.changes.join('; ')}.` };
    }
    if (r.status === 'changed') return { row: r.row, status: 'skipped' as const, setId: r.setId, artist, message: SKIPPED_MESSAGE };
    return { row: r.row, status: 'unchanged' as const, setId: r.setId, artist, message: 'No change.' };
  });
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return {
    importId,
    created: count('created'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    skipped: count('skipped'),
    newStages: writes.newStages.length,
    newDays: writes.newDays.length,
    spotifyMatched: writes.spotifyMatched,
    rows,
    warnings: [...plan.rows.flatMap((r) => r.warnings.map((w) => `Row ${r.row}: ${w}`)), ...warnings],
  };
}

export default function createLineupImportRoute(deps: any) {
  const {
    express,
    log,
    config,
    adminAuth,
    setNoStore,
    rateLimit,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    stores,
    invalidateFestivalCache,
    getRequestIp,
  } = deps;

  const router = express.Router();

  // Spotify integration — optional, only if credentials configured
  let spotify: any = null;
  const spotifyClientId = config.SPOTIFY_CLIENT_ID;
  const spotifyClientSecret = config.SPOTIFY_CLIENT_SECRET;
  if (spotifyClientId && spotifyClientSecret) {
    import('../lib/spotify.js')
      .then((mod) => {
        spotify = (mod as any).default || mod;
        log.info('spotify integration enabled for lineup import');
      })
      .catch(() => {
        log.warn('spotify module not available');
      });
  }

  async function writeAuditRow(req: any, res: any, action: string, festivalId: string, details: any) {
    if (stores.auditLog) {
      try {
        await stores.auditLog.insert({
          id: crypto.randomUUID(),
          actorType: 'admin',
          actorId: req.user?.userId,
          action,
          targetType: 'festival',
          targetId: festivalId,
          detailsJson: JSON.stringify(details),
          ip: getRequestIp(req),
        });
      } catch (err: any) {
        log.warn('lineup import audit write failed', { festivalId, action, error: err?.message });
      }
    }
    // Tells the generic audit middleware this request already has its row.
    res.locals.auditWritten = true;
  }

  async function searchSpotify(names: string[], warnings: string[]) {
    if (!spotify || names.length === 0) return undefined;
    try {
      const hits: Map<string, SpotifyHit> = await spotify.bulkSearchArtists(names, spotifyClientId, spotifyClientSecret, { log });
      return new Map([...hits].map(([name, hit]) => [name.toLowerCase(), hit]));
    } catch (err: any) {
      log.warn('spotify auto-linking failed, continuing without', { error: err?.message });
      warnings.push('Spotify search failed, so sets were imported without Spotify links.');
      return undefined;
    }
  }

  // Validates the body and loads the festival. Sends the error response and returns null on failure.
  async function loadRequest(req: any, res: any) {
    const validation = lineupImportRequestSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, 400, 'Invalid import payload', ErrorCodes.INVALID_INPUT);
      return null;
    }
    const festivalId = sanitizeIdentifier(req.params.id, 100);
    if (!festivalId) {
      sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      return null;
    }
    const festival = await stores.festivals.getById(festivalId);
    if (!festival) {
      sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      return null;
    }
    const body = validation.data;
    const base = {
      rows: body.rows,
      options: { updateExisting: body.updateExisting, createMissing: body.createMissing },
      config,
    };
    return { festivalId, festival, body, base };
  }

  router.post(
    '/:id/import-lineup/preview',
    adminAuth,
    rateLimit(30, 'lineup-import-preview'),
    async (req: any, res: any) => {
      try {
        setNoStore(res);
        const loaded = await loadRequest(req, res);
        if (!loaded) return;
        return sendSuccess(res, planLineupImport({ festival: loaded.festival, ...loaded.base }).plan);
      } catch (error: any) {
        log.error('lineup import preview failed', { error: error.message, festivalId: req.params.id });
        return sendError(res, 500, 'Failed to preview the import', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.post('/:id/import-lineup', adminAuth, rateLimit(5, 'lineup-import'), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const loaded = await loadRequest(req, res);
      if (!loaded) return;
      const { festivalId, festival, body, base } = loaded;

      const warnings: string[] = [];
      const first = planLineupImport({ festival, ...base });
      const clean = first.plan.counts.error === 0 && first.plan.problems.length === 0;
      const spotifyMap = clean && !body.skipSpotify ? await searchSpotify(artistsNeedingLinks(first.writes), warnings) : undefined;

      const outcome = await stores.lineupImports.commit(
        festivalId,
        (current: any) => planLineupImport({ festival: current, ...base, spotify: spotifyMap, makeId }),
        { createdBy: req.user?.userId ?? null },
      );
      if ('notFound' in outcome) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      if (!outcome.committed) return sendSuccess(res, { committed: false, plan: outcome.plan });

      invalidateFestivalCache();
      const result = buildResult(outcome.plan, outcome.writes, outcome.importId, warnings, festival.b2bSeparator || 'b2b');
      log.info('lineup imported', {
        festivalId,
        importId: result.importId,
        created: result.created,
        updated: result.updated,
        spotifyMatched: result.spotifyMatched,
        warnings: result.warnings.length,
        ip: getRequestIp(req),
      });
      await writeAuditRow(req, res, 'lineup_import', festivalId, {
        importId: result.importId,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped: result.skipped,
        newStages: result.newStages,
        newDays: result.newDays,
      });
      return sendSuccess(res, { committed: true, result, plan: outcome.plan });
    } catch (error: any) {
      log.error('lineup import failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to import lineup', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.get('/:id/imports', adminAuth, async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const history = await stores.lineupImports.list(festivalId);
      if (!history) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      return sendSuccess(res, history);
    } catch (error: any) {
      log.error('lineup import history failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to load import history', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post(
    '/:id/imports/:importId/undo',
    adminAuth,
    rateLimit(5, 'lineup-import-undo'),
    async (req: any, res: any) => {
      try {
        setNoStore(res);
        const festivalId = sanitizeIdentifier(req.params.id, 100);
        const importId = sanitizeIdentifier(req.params.importId, 100);
        if (!festivalId || !importId) return sendError(res, 404, 'Import not found.', ErrorCodes.NOT_FOUND);
        const outcome = await stores.lineupImports.undo(festivalId, importId);
        if ('notFound' in outcome) return sendError(res, 404, 'Import not found.', ErrorCodes.NOT_FOUND);
        if ('refused' in outcome) {
          return sendError(
            res,
            400,
            'Only the newest import can be undone. Undo newer imports first.',
            ErrorCodes.INVALID_INPUT,
          );
        }
        invalidateFestivalCache();
        log.info('lineup import undone', { festivalId, importId, ...outcome.result, kept: outcome.result.kept.length });
        await writeAuditRow(req, res, 'lineup_import_undo', festivalId, {
          importId,
          removed: outcome.result.removed,
          restored: outcome.result.restored,
          removedStages: outcome.result.removedStages,
          removedDays: outcome.result.removedDays,
          kept: outcome.result.kept.length,
        });
        return sendSuccess(res, outcome.result);
      } catch (error: any) {
        log.error('lineup import undo failed', { error: error.message, festivalId: req.params.id });
        return sendError(res, 500, 'Failed to undo the import', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
