/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Lineup Import Route — Parse CSV/TSV/text lineup into festival sets
 *
 * POST /api/v1/admin/festivals/:id/import-lineup
 * Body: { text, format?: "csv"|"tsv"|"auto", skipSpotify?, dryRun?, updateExisting? }
 *
 * The import adds new sets and, with updateExisting, updates the stage and times of sets
 * that already match by artist + day. It never deletes. dryRun returns the same
 * row-by-row result without writing anything.
 *
 * Expected formats:
 *   CSV: artist,stage,day,startTime,endTime[,linkUrl]
 *   TSV: artist\tstage\tday\tstartTime\tendTime[\tlinkUrl]
 *   Auto: Detects delimiter from first line
 *
 * Header row is optional — detected by checking if first row contains
 * "artist" (case-insensitive). Columns can be in any order if header present.
 * Without header: assumed order is artist, stage, day, startTime, endTime.
 *
 * If SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are configured, auto-populates
 * link_url with Spotify artist page URLs for new sets that don't already have one.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { sanitizeLinkRecord } from '../lib/schemas.js';
import { validateFestival, validateTime } from '../lib/helpers/validation.js';

const importLineupSchema = z.object({
  text: z.string().min(1).max(100_000),
  format: z.enum(['csv', 'tsv', 'auto']).default('auto'),
  skipSpotify: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  updateExisting: z.boolean().default(false),
});

// Artist name in lower case with spaces collapsed: the match identity inside a day.
const normName = (s: any) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export default function createLineupImportRoute(deps: any) {
  const {
    express,
    log,
    config,
    adminAuth,
    setNoStore,
    rateLimit,
    getFestivalById,
    sanitizeIdentifier,
    sanitizeString,
    sendSuccess,
    sendError,
    ErrorCodes,
    stores,
    invalidateFestivalCache,
    getRequestIp,
    reengagement,
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

  function detectDelimiter(firstLine: any) {
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    return tabCount > commaCount ? '\t' : ',';
  }

  function parseLine(line: any, delimiter: any) {
    if (delimiter === ',') {
      const fields: any[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      fields.push(current.trim());
      return fields;
    }
    return line.split(delimiter).map((f: any) => f.trim());
  }

  function normalizeTime(raw: any) {
    if (!raw) return '';
    const stripped = raw.trim().replace(/\s+/g, ' ');
    if (/^\d{1,2}:\d{2}$/.test(stripped)) return stripped.padStart(5, '0');
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(stripped)) return stripped.slice(0, 5).padStart(5, '0');
    const match12 = stripped.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (match12) {
      let h = parseInt(match12[1], 10);
      const m = parseInt(match12[2] || '0', 10);
      const period = match12[3].toLowerCase();
      if (period === 'pm' && h < 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return stripped;
  }

  // Returns the normalized time, '' for an empty cell, and records a problem for junk.
  function readTime(raw: string, label: string, line: number, problems: string[]) {
    if (!raw) return '';
    const time = normalizeTime(raw);
    if (!validateTime(time)) {
      problems.push(`Line ${line}: ${label} time "${raw}" is not a time. Use HH:MM or 8:00 PM.`);
      return '';
    }
    return time;
  }

  // Splits the file into data rows. Returns an error message when the file cannot be read at all.
  function parseRows(text: string, format: string, warnings: string[]) {
    const lines = text.split(/\r?\n/).filter((l: any) => l.trim());
    if (lines.length === 0) return { error: 'No data to import', parsed: [] as any[] };
    const delimiter = format === 'csv' ? ',' : format === 'tsv' ? '\t' : detectDelimiter(lines[0]);
    const headerLower = parseLine(lines[0], delimiter).map((f: any) => f.toLowerCase().replace(/[^a-z]/g, ''));
    const hasHeader = headerLower.includes('artist') || headerLower.includes('name');

    let columnMap: any;
    if (hasHeader) {
      const HEADER_TO_FIELD: any = {
        artist: 'artist',
        name: 'artist',
        act: 'artist',
        stage: 'stage',
        day: 'day',
        date: 'day',
        start: 'startTime',
        starttime: 'startTime',
        end: 'endTime',
        endtime: 'endTime',
        link: 'linkUrl',
        linkurl: 'linkUrl',
        url: 'linkUrl',
        spotify: 'linkUrl',
      };
      columnMap = {};
      for (let i = 0; i < headerLower.length; i++) {
        const field = HEADER_TO_FIELD[headerLower[i]];
        if (field && columnMap[field] === undefined) columnMap[field] = i;
      }
    } else {
      columnMap = { artist: 0, stage: 1, day: 2, startTime: 3, endTime: 4 };
    }
    if (columnMap.artist === undefined) {
      return { error: 'Could not find artist/name column in import data', parsed: [] as any[] };
    }

    const dataLines = hasHeader ? lines.slice(1) : lines;
    const parsed: any[] = [];
    for (let i = 0; i < dataLines.length; i++) {
      const line = hasHeader ? i + 2 : i + 1;
      const fields = parseLine(dataLines[i], delimiter);
      if (parsed.length >= config.MAX_IMPORT_SETS) {
        warnings.push(`Line ${line}: max import limit (${config.MAX_IMPORT_SETS}) reached, remaining lines skipped`);
        break;
      }
      const artist = sanitizeString(fields[columnMap.artist] || '', 300);
      if (!artist) {
        warnings.push(`Line ${line}: empty artist, skipped`);
        continue;
      }
      const rawLink = columnMap.linkUrl !== undefined ? (fields[columnMap.linkUrl] || '').trim() : '';
      // Allowlist link schemes (drop javascript:/data: etc.) before persisting.
      const safeLinks = rawLink ? sanitizeLinkRecord({ spotify: rawLink }) : {};
      if (rawLink && !safeLinks.spotify) warnings.push(`Line ${line}: link dropped (unsupported URL scheme)`);
      parsed.push({
        line,
        artist,
        rawStage: sanitizeString(fields[columnMap.stage] || '', 100),
        rawDay: sanitizeString(fields[columnMap.day] || '', 100),
        rawStart: (fields[columnMap.startTime] || '').trim().slice(0, 20),
        rawEnd: (fields[columnMap.endTime] || '').trim().slice(0, 20),
        safeLinks,
        safeLink: safeLinks.spotify || null,
      });
    }
    return { error: null, parsed };
  }

  // Matches parsed file rows against stored sets and decides each row's status.
  // Writes nothing. Matched sets keep their ids so picks and ratings survive.
  function planImport(festival: any, parsed: any[], updateExisting: boolean) {
    const stages: any[] = festival.stages || [];
    const days: any[] = festival.days || [];
    const stageLookup = new Map<string, string>();
    for (const stage of stages) {
      stageLookup.set(stage.name.toLowerCase(), stage.id);
      stageLookup.set(stage.id, stage.id);
    }
    const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name ?? null;
    const dayLookup = new Map<string, number>();
    // Day numbers are 1-based. Blank labels and dates are not keys, so an empty cell never matches.
    days.forEach((day, i) => {
      if (day.label) dayLookup.set(day.label.toLowerCase(), i);
      if (day.date) dayLookup.set(day.date, i);
      dayLookup.set(String(i + 1), i);
    });
    const stored: any[] = days.flatMap((day, dayIndex) =>
      (day.sets || []).map((set: any) => ({ ...set, dayIndex, norm: normName(set.artist) })),
    );

    const matchedIds = new Set<string>();
    const firstLineOf = new Map<string, number>();
    const rows: any[] = [];
    const inserts: any[] = [];
    const updates: any[] = [];

    for (const p of parsed) {
      const problems: string[] = [];
      let stageId: string | null = null;
      if (p.rawStage) {
        stageId = stageLookup.get(p.rawStage.toLowerCase()) ?? null;
        if (!stageId) {
          problems.push(
            `Line ${p.line}: stage "${p.rawStage}" is not in this festival. Fix the name or add the stage first.`,
          );
        }
      }
      const dayIndex = p.rawDay ? (dayLookup.get(p.rawDay.toLowerCase()) ?? dayLookup.get(p.rawDay)) : undefined;
      if (dayIndex === undefined) {
        problems.push(
          `Line ${p.line}: day "${p.rawDay}" is not in this festival. Use a day label, a date (YYYY-MM-DD) or a day number.`,
        );
      }
      const start = readTime(p.rawStart, 'start', p.line, problems);
      const end = readTime(p.rawEnd, 'end', p.line, problems);

      let match: any = null;
      let ambiguous = false;
      if (dayIndex !== undefined) {
        const cands = stored.filter((s) => s.dayIndex === dayIndex && s.norm === normName(p.artist));
        if (cands.length === 1) match = cands[0];
        else if (cands.length > 1) {
          const narrowed = stageId ? cands.filter((s) => s.stageId === stageId) : [];
          if (narrowed.length === 1) match = narrowed[0];
          else {
            ambiguous = true;
            cands.forEach((c) => matchedIds.add(c.id));
            problems.push(
              `Line ${p.line}: "${p.artist}" matches ${cands.length} sets on ${days[dayIndex].label}. Add the stage column so the row matches one set.`,
            );
          }
        }
      }
      if (match) matchedIds.add(match.id);
      const finalStage = stageId ?? match?.stageId ?? null;
      if (!match && !ambiguous && !p.rawStage) {
        problems.push(`Line ${p.line}: stage is empty. Add the stage name for new sets.`);
      }
      if (dayIndex !== undefined && !ambiguous) {
        const dupId = match ? `id:${match.id}` : `new:${normName(p.artist)}|${dayIndex}|${finalStage ?? ''}`;
        const firstLine = firstLineOf.get(dupId);
        if (firstLine !== undefined) problems.push(`Line ${p.line} repeats line ${firstLine}.`);
        else firstLineOf.set(dupId, p.line);
      }

      // An empty time cell keeps the stored value; it never clears it.
      const finalStart = start || match?.startTime || '';
      const finalEnd = end || match?.endTime || '';
      const row: any = {
        line: p.line,
        artist: p.artist,
        stageName: stageName(finalStage),
        dayLabel: dayIndex !== undefined ? days[dayIndex].label : null,
        startTime: finalStart || null,
        endTime: finalEnd || null,
        status: 'error',
      };
      if (problems.length > 0) {
        row.message = problems.join(' ');
      } else if (match) {
        const changed =
          finalStage !== match.stageId ||
          finalStart !== (match.startTime || '') ||
          finalEnd !== (match.endTime || '');
        if (!changed) row.status = 'unchanged';
        else if (updateExisting) {
          row.status = 'update';
          updates.push({ id: match.id, dayIndex, stageId: finalStage, startTime: finalStart, endTime: finalEnd });
        } else {
          row.status = 'skipped';
          row.message = 'Differs from the stored set. Turn on "Update sets that match" to apply.';
        }
      } else {
        row.status = 'new';
        inserts.push({
          id: `set-import-${crypto.randomBytes(6).toString('hex')}`,
          artist: p.artist,
          artists: [{ name: p.artist, links: p.safeLinks }],
          stageId: finalStage,
          dayIndex,
          startTime: finalStart,
          endTime: finalEnd,
          linkUrl: p.safeLink,
        });
      }
      rows.push(row);
    }

    const counts = { new: 0, update: 0, unchanged: 0, error: 0 };
    for (const row of rows) if (row.status in counts) counts[row.status as keyof typeof counts]++;
    const missing = stored
      .filter((s) => !matchedIds.has(s.id))
      .map((s) => ({ id: s.id, artist: s.artist, dayLabel: days[s.dayIndex].label }));
    return { rows, inserts, updates, counts, missing };
  }

  // Festival-level problems that the import itself would add (for example overlaps).
  // Errors already present in the stored festival are ignored so old data never blocks an import.
  function newEditorErrors(festival: any, inserts: any[], updates: any[]) {
    const byId = new Map(updates.map((u) => [u.id, u]));
    const merged = {
      ...festival,
      days: (festival.days || []).map((day: any, dayIndex: number) => ({
        ...day,
        sets: [
          ...(day.sets || []).map((set: any) => (byId.has(set.id) ? { ...set, ...byId.get(set.id) } : set)),
          ...inserts.filter((s) => s.dayIndex === dayIndex),
        ],
      })),
    };
    const before = new Set(validateFestival(config, festival));
    return validateFestival(config, merged).filter((e: string) => !before.has(e));
  }

  async function writeAuditRow(req: any, res: any, festivalId: string, details: any) {
    if (stores.auditLog) {
      try {
        await stores.auditLog.insert({
          id: crypto.randomUUID(),
          actorType: 'admin',
          actorId: req.user?.userId,
          action: 'lineup_import',
          targetType: 'festival',
          targetId: festivalId,
          detailsJson: JSON.stringify(details),
          ip: getRequestIp(req),
        });
      } catch (err: any) {
        log.warn('lineup import audit write failed', { festivalId, error: err?.message });
      }
    }
    // Tells the generic audit middleware this request already has its row.
    res.locals.auditWritten = true;
  }

  // Spotify auto-linking — fill gaps where linkUrl is null (new sets only)
  async function addSpotifyLinks(inserts: any[], warnings: string[]) {
    let matched = 0;
    const needsLink = inserts.filter((s) => !s.linkUrl);
    if (!spotify || needsLink.length === 0) return matched;
    try {
      const results = await spotify.bulkSearchArtists(
        needsLink.map((s) => s.artist),
        spotifyClientId,
        spotifyClientSecret,
        { log },
      );
      for (const set of needsLink) {
        const hit = results.get(set.artist);
        if (!hit?.spotifyUrl) continue;
        set.linkUrl = hit.spotifyUrl;
        set.artists[0].links.spotify = hit.spotifyUrl;
        if (hit.imageUrl) set.artists[0].photo = hit.imageUrl;
        if (hit.genres?.length) set.artists[0].genres = hit.genres;
        matched++;
      }
      log.info('spotify auto-linking complete', { total: needsLink.length, matched });
    } catch (err: any) {
      log.warn('spotify auto-linking failed, continuing without', { error: err.message });
      warnings.push('Spotify auto-linking failed — sets imported without Spotify links');
    }
    return matched;
  }

  router.post('/:id/import-lineup', adminAuth, rateLimit(20, 'lineup-import'), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const validation = importLineupSchema.safeParse(req.body);
      if (!validation.success) {
        return sendError(res, 400, 'Invalid import payload', ErrorCodes.INVALID_INPUT);
      }

      const { text, format, skipSpotify, dryRun, updateExisting } = validation.data;
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      const warnings: string[] = [];
      const { error: parseError, parsed } = parseRows(text, format, warnings);
      if (parseError) return sendError(res, 400, parseError, ErrorCodes.INVALID_INPUT);
      if (parsed.length === 0) {
        return sendError(res, 400, 'No valid sets found in import data', ErrorCodes.INVALID_INPUT);
      }

      const errors: string[] = [];
      if (!(festival.stages || []).length) {
        errors.push('This festival has no stages yet. Add the stages in the editor first.');
      }
      if (!(festival.days || []).length) errors.push('This festival has no days yet. Add the days in the editor first.');
      const plan =
        errors.length > 0
          ? { rows: [] as any[], inserts: [] as any[], updates: [] as any[], counts: { new: 0, update: 0, unchanged: 0, error: 0 }, missing: [] as any[] }
          : planImport(festival, parsed, updateExisting);
      if (errors.length === 0) errors.push(...newEditorErrors(festival, plan.inserts, plan.updates));

      const data: any = {
        dryRun,
        counts: plan.counts,
        rows: plan.rows,
        missing: plan.missing,
        errors,
        warnings,
        imported: 0,
        updated: 0,
        spotifyMatched: 0,
      };
      if (dryRun) return sendSuccess(res, data);
      if (plan.counts.error > 0 || errors.length > 0) {
        return sendError(res, 400, 'Fix the rows marked in red, then import again.', ErrorCodes.INVALID_INPUT, {
          preview: data,
        });
      }

      if (!skipSpotify) data.spotifyMatched = await addSpotifyLinks(plan.inserts, warnings);
      const nextOrder = new Map<number, number>();
      const inserts = plan.inserts.map((set) => {
        const next = nextOrder.get(set.dayIndex) ?? (festival.days[set.dayIndex].sets?.length || 0);
        nextOrder.set(set.dayIndex, next + 1);
        return { ...set, sortOrder: next };
      });
      await stores.festivals.applyLineupImport(festivalId, inserts, plan.updates);
      invalidateFestivalCache();
      data.imported = inserts.length;
      data.updated = plan.updates.length;

      log.info('lineup imported', {
        festivalId,
        imported: data.imported,
        updated: data.updated,
        spotifyMatched: data.spotifyMatched,
        warnings: warnings.length,
        ip: getRequestIp(req),
      });
      await writeAuditRow(req, res, festivalId, {
        imported: data.imported,
        updated: data.updated,
        unchanged: plan.counts.unchanged,
        skipped: plan.rows.filter((r) => r.status === 'skipped').length,
      });

      // M3 re-engagement: a recurring festival just published its lineup → notify
      // prior-year attendees of the same-named festival (handled in the trigger:
      // event-gated, per-type opt-out + DND + deduped, full fan-out). When Redis is
      // up this enqueues onto the durable re-engagement queue (issue #20) so delivery
      // survives restarts + retries; otherwise it runs inline. Fire-and-forget here.
      if (data.imported > 0 && reengagement?.sendLineupDrop) {
        reengagement
          .sendLineupDrop(festivalId)
          .catch((err: any) => log.warn('lineup_drop notify failed', { festivalId, error: err?.message }));
      }
      return sendSuccess(res, data);
    } catch (error: any) {
      log.error('lineup import failed', { error: error.message, festivalId: req.params.id });
      return sendError(res, 500, 'Failed to import lineup', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
