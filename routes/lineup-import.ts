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
 * A row with only names (and links) has no day, stage or time: it adds to the announced lineup.
 * Rows name artists by key or by id; two live artists with one key stop the commit until a row names the id.
 * Imports never delete sets. The lineup announcement and the per-date set-times alert are separate,
 * manual admin actions: a commit sends neither. A set that gets its first time on a date whose alert
 * already went out alerts the people who picked it (lib/picker-alerts.ts). Other time changes stay silent.
 * A commit and an undo also drop the festival list cache, and on a published festival emit
 * festival:updated, so open clients reload and the announced lineup shows what the sets now cover.
 * Both then run the interest conversion (lib/lineup.ts), which turns marks on covered acts into picks.
 * Undo first takes back the picks that conversion made on the sets it deletes.
 *
 * The import does not search Spotify: one wrong guess would reach every festival that shares the
 * artist. Links come from the Link column or the Artists tab. Inside the commit and the undo
 * transaction every artist element is tied to its artists row (resolveArtistRefs), so a set gets
 * the canonical name and links. A link that differs from the artist's links is not used.
 */

import crypto from 'crypto';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { createAdminAuditWriter } from '../lib/audit-middleware.js';
import { lineupImportRequestSchema } from '../lib/schemas.js';
import { planPickerAlerts } from '../lib/picker-alerts.js';
import {
  artistLookupKeys,
  planLineupImport,
  withLockedArtists,
  type ArtistRef,
  type LineupImportPlan,
  type LineupImportWrites,
} from '../lib/lineup-import-plan.js';

const SKIPPED_MESSAGE = 'Matches an existing set. Not updated because Update sets that match was off.';
const ANNOUNCED_SKIPPED_MESSAGE = 'Matches an announced lineup entry. Not updated because Update sets that match was off.';

const makeId = (prefix: string) => `${prefix}-${crypto.randomBytes(6).toString('hex')}`;

/** One result entry per request row, plus the counts the admin sees after a commit. */
function buildResult(plan: LineupImportPlan, writes: LineupImportWrites, importId: string, warnings: string[], sep: string) {
  const insertByIndex = new Map(writes.inserts.map((s) => [s.index, s]));
  const updated = new Set(writes.updates.map((u) => u.index));
  const announcedAdded = new Set(writes.announced.inserts.map((e) => e.index));
  const announcedUpdated = new Set(writes.announced.updates.map((e) => e.index));
  const rows = plan.rows.map((r, i) => {
    const artist = r.artists.join(` ${sep} `);
    const insert = insertByIndex.get(i);
    if (insert) return { row: r.row, status: 'created' as const, setId: insert.id, artist, message: 'Added.' };
    if (announcedAdded.has(i)) return { row: r.row, status: 'created' as const, artist, message: 'Added to the announced lineup.' };
    if (updated.has(i) || announcedUpdated.has(i)) {
      return { row: r.row, status: 'updated' as const, setId: r.setId, artist, message: `Updated: ${r.changes.join('; ')}.` };
    }
    if (r.skipped) return { row: r.row, status: 'skipped' as const, setId: r.setId, artist, message: r.skipped };
    if (r.status === 'changed') {
      const message = r.target === 'announced' ? ANNOUNCED_SKIPPED_MESSAGE : SKIPPED_MESSAGE;
      return { row: r.row, status: 'skipped' as const, setId: r.setId, artist, message };
    }
    return { row: r.row, status: 'unchanged' as const, setId: r.setId, artist, message: 'No change.' };
  });
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return {
    importId,
    created: writes.inserts.length,
    updated: writes.updates.length,
    announced: writes.announced.inserts.length,
    announcedUpdated: writes.announced.updates.length,
    unchanged: count('unchanged'),
    skipped: count('skipped'),
    newStages: writes.newStages.length,
    newDays: writes.newDays.length,
    spotifyMatched: writes.spotifyMatched,
    rows,
    // Rows that kept their stored day come first, so the admin sees what the import did not apply.
    warnings: [
      ...[...plan.rows].sort((a, b) => Number(!!b.skipped) - Number(!!a.skipped)).flatMap((r) => r.warnings.map((w) => `Row ${r.row}: ${w}`)),
      ...warnings,
    ],
  };
}

export default function createLineupImportRoute(deps: any) {
  const {
    express,
    log,
    config,
    festivalAccess,
    setNoStore,
    rateLimit,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    stores,
    invalidateFestivalCache,
    getRequestIp,
    emitter,
  } = deps;
  const writeAdminAudit = createAdminAuditWriter({ stores, log, getRequestIp });

  const router = express.Router();

  // Sets changed, so the list's lineupCount is stale and open clients must reload.
  // A draft has no attendees, and the event goes to every socket.
  function announceSetsChanged(festival: any) {
    deps.invalidateFestivalListCache?.();
    if (festival?.publishedAt) emitter?.festivalUpdated?.({ festival });
  }

  // After a commit: a set that got its first time on a released date tells the people who picked it. The
  // festival is read before and after the commit, outside its transaction, so a concurrent edit can cause
  // one missed or extra alert. Fire and forget: the import has committed, so a failure here only logs.
  function alertPickersOfFirstTimes(before: any) {
    if (!before.publishedAt) return;
    void (async () => {
      const after = await stores.festivals.getById(before.id);
      if (!after) return;
      const { changes, pickersBySet } = await planPickerAlerts({ stores, before, after, tbaOnly: true });
      if (changes.length > 0) await emitter?.scheduleChanged?.({ festival: after, changes, pickersBySet });
    })().catch((err: any) => log.warn('import picker alerts failed', { festivalId: before.id, error: err?.message }));
  }

  function writeAuditRow(req: any, res: any, action: string, festivalId: string, details: any) {
    return writeAdminAudit(req, res, { action, targetType: 'festival', targetId: festivalId, details });
  }

  // A Link column value for an empty platform of an artist that exists: written after the import
  // commits, through the artist's own locks (festivals first, then the artist), so every festival that
  // lists the artist gets it. A failure is logged and never fails the import.
  async function applyLinkFills(fills: Array<{ artistId: string; url: string }>, userId: string | null, ip: string | null) {
    for (const fill of fills) {
      try {
        const result = await stores.artists.fillLink(fill.artistId, { link: fill.url, userId, ip });
        await deps.afterArtistSync?.(result.synced);
      } catch (error: any) {
        log.warn('import link not added to the artist', { artistId: fill.artistId, error: error?.message });
      }
    }
  }

  // Validates the body and loads the festival. Sends the error response and returns null on failure.
  async function loadRequest(req: any, res: any) {
    const validation = lineupImportRequestSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, 400, 'Invalid import payload', ErrorCodes.VALIDATION_ERROR, {
        fields: validation.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return null;
    }
    const festivalId = req.festivalId;
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
    // One lookup serves the preview and the commit's re-plan. Commit checks the ids again under lock.
    const { keys, ids } = artistLookupKeys(festival, body.rows);
    const artists = await stores.lineupImports.lookupArtists(keys, ids);
    const base = {
      rows: body.rows,
      options: { updateExisting: body.updateExisting, createMissing: body.createMissing, moveDays: body.moveDays },
      config,
      artists,
    };
    return { festivalId, festival, body, base };
  }

  router.post(
    '/:id/import-lineup/preview',
    festivalAccess({ action: 'lineup.import' }),
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

  router.post('/:id/import-lineup', festivalAccess({ action: 'lineup.import' }), rateLimit(5, 'lineup-import'), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const loaded = await loadRequest(req, res);
      if (!loaded) return;
      const { festivalId, festival, base } = loaded;

      const warnings: string[] = [];
      const outcome = await stores.lineupImports.commit(
        festivalId,
        (current: any, locked?: Map<string, ArtistRef>) =>
          planLineupImport({ festival: current, ...base, artists: locked ? withLockedArtists(base.artists, locked) : base.artists, makeId }),
        { createdBy: req.user?.userId ?? null },
      );
      if ('notFound' in outcome) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      if (!outcome.committed) return sendSuccess(res, { committed: false, plan: outcome.plan });

      invalidateFestivalCache();
      announceSetsChanged(festival);
      await applyLinkFills(outcome.refs?.linkFills ?? [], req.user?.userId ?? null, getRequestIp(req));
      if (outcome.refs?.ignoredLinkEdits) {
        warnings.push(
          `${outcome.refs.ignoredLinkEdits} ${outcome.refs.ignoredLinkEdits === 1 ? 'link differs' : 'links differ'} from the artist's links and ${outcome.refs.ignoredLinkEdits === 1 ? 'was' : 'were'} not used. Change them on the Artists tab.`,
        );
      }
      if (outcome.writes.inserts.some((s: any) => s.artists.some((a: any) => !Object.keys(a.links ?? {}).length))) {
        warnings.push('Add links on the Artists tab. The import does not search Spotify.');
      }
      // After the response is built, so the save never waits. It logs its own failure.
      void deps.interestConversion?.convert(festivalId);
      alertPickersOfFirstTimes(festival);
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
      await writeAuditRow(req, res, AUDIT_ACTIONS.LINEUP_IMPORTED, festivalId, {
        importId: result.importId,
        created: result.created,
        updated: result.updated,
        announced: result.announced,
        announcedUpdated: result.announcedUpdated,
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

  router.get('/:id/imports', festivalAccess({ action: 'lineup.history' }), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = req.festivalId;
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
    festivalAccess({ action: 'lineup.import' }),
    rateLimit(5, 'lineup-import-undo'),
    async (req: any, res: any) => {
      try {
        setNoStore(res);
        const festivalId = req.festivalId;
        const importId = sanitizeIdentifier(req.params.importId, 100);
        if (!festivalId || !importId) return sendError(res, 404, 'Import not found.', ErrorCodes.NOT_FOUND);
        // Read before the undo commits: a failed read then fails the request while nothing has changed.
        const festival = await stores.festivals.getById(festivalId);
        const outcome = await stores.lineupImports.undo(festivalId, importId);
        if ('notFound' in outcome) return sendError(res, 404, 'Import not found.', ErrorCodes.NOT_FOUND);
        if ('olderThanUpgrade' in outcome) {
          return sendError(
            res,
            400,
            'This import is older than the artist upgrade. Edit the sets by hand instead.',
            ErrorCodes.INVALID_INPUT,
          );
        }
        if ('refused' in outcome) {
          return sendError(
            res,
            400,
            'Only the newest import can be undone. Undo newer imports first.',
            ErrorCodes.INVALID_INPUT,
          );
        }
        invalidateFestivalCache();
        announceSetsChanged(festival);
        // Marks that lost their automatic picks reach open devices, then conversion runs again in case
        // a set that stayed still covers a marked act.
        void deps.interestConversion
          ?.announce(outcome.changedProfileIds ?? [])
          .then(() => deps.interestConversion.convert(festivalId));
        log.info('lineup import undone', { festivalId, importId, ...outcome.result, kept: outcome.result.kept.length });
        await writeAuditRow(req, res, AUDIT_ACTIONS.LINEUP_IMPORT_UNDONE, festivalId, {
          importId,
          removed: outcome.result.removed,
          restored: outcome.result.restored,
          removedEntries: outcome.result.removedEntries,
          restoredEntries: outcome.result.restoredEntries,
          removedStages: outcome.result.removedStages,
          removedDays: outcome.result.removedDays,
          autoPicksRemoved: outcome.result.autoPicksRemoved,
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
