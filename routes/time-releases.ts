/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Per-date set-time releases: the admin sends "set times are out" for one festival date at a time.
 *
 * GET  /api/v1/admin/festivals/:id/time-releases  -> the release panel: per date timed and total sets,
 *                                                    claim state, the recipient ceiling and the preview text
 * POST /api/v1/admin/festivals/:id/time-releases  -> 202 { queued, dates, skipped, recipients }
 *
 * No save, import or publish sends the alert. POST claims each date in festival_time_releases first
 * (one INSERT, so two overlapping requests cannot both win a date), then enqueues one send per event
 * key. A date that is already claimed is skipped, and a claim stuck for over ten minutes is taken over.
 */

import crypto from 'crypto';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { isFestivalOver, timeReleaseCopy } from '../lib/notifications/reengagement.js';

type DayCount = { date: string; label: string; timed: number; total: number };

/** One entry per dated day, sorted by date, counting the sets that have a start time. */
function countByDate(festival: any): DayCount[] {
  const byDate = new Map<string, DayCount>();
  for (const day of festival.days || []) {
    if (!day?.date) continue;
    const entry = byDate.get(day.date) ?? { date: day.date, label: day.label || day.date, timed: 0, total: 0 };
    for (const set of day.sets || []) {
      entry.total += 1;
      if (set.startTime) entry.timed += 1;
    }
    byDate.set(day.date, entry);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export default function createTimeReleasesRoute(deps: any) {
  const {
    express,
    log,
    adminAuth,
    rateLimit,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    stores,
    getRequestIp,
    reengagement,
    reengagementExecutor,
    schemas,
    validate,
    setNoStore,
  } = deps;

  const router = express.Router();

  async function recordRelease(req: any, res: any, festivalId: string, details: any) {
    try {
      await stores.auditLog.insert({
        id: crypto.randomUUID(),
        actorType: 'admin',
        actorId: req.user?.userId,
        action: AUDIT_ACTIONS.TIMES_RELEASED,
        targetType: 'festival',
        targetId: festivalId,
        detailsJson: JSON.stringify(details),
        ip: getRequestIp(req),
      });
    } catch (err: any) {
      log.warn('time release audit write failed', { festivalId, error: err?.message });
    }
    // Tells the generic audit middleware this request already has its row.
    res.locals.auditWritten = true;
  }

  router.get('/:id/time-releases', adminAuth, async (req: any, res: any) => {
    try {
      setNoStore(res);
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await stores.festivals.getById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      const counts = countByDate(festival);
      const rows = await stores.timeReleases.list(festivalId);
      const rowByDate = new Map<string, any>(rows.map((r: any) => [r.date, r]));
      const { recipients: recipientsNow, emailRecipients, emailCut, emailOff } =
        await reengagementExecutor.countTimeRelease(festivalId);
      const dates = counts.map((day) => {
        const row = rowByDate.get(day.date);
        return {
          ...day,
          claimedAt: row?.claimedAt ?? null,
          sentAt: row?.sentAt ?? null,
          recipients: row?.recipients ?? null,
          previewTitle: timeReleaseCopy(festival.name, [day.label]).title,
        };
      });
      const current = new Set(counts.map((day) => day.date));
      const orphanDates = rows
        .filter((r: any) => !current.has(r.date))
        .map((r: any) => ({ date: r.date, claimedAt: r.claimedAt, sentAt: r.sentAt }));
      return sendSuccess(res, {
        festivalName: festival.name,
        canSend: !!festival.publishedAt && !isFestivalOver(festival.days, festival.timeZone),
        recipientsNow,
        // Email goes out only with a postal address, and at most the daily budget; emailCut people get none.
        emailRecipients,
        emailCut,
        emailOff,
        defaultBody: timeReleaseCopy(festival.name, []).body,
        dates,
        orphanDates,
      });
    } catch (err: any) {
      log.error('time releases load error', { error: err?.message });
      return sendError(res, 500, 'Failed to load set-time releases', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post(
    '/:id/time-releases',
    adminAuth,
    rateLimit(10, 'time-release'),
    validate(schemas.timeReleaseSend),
    async (req: any, res: any) => {
      try {
        const festivalId = sanitizeIdentifier(req.params.id, 100);
        if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
        const { note, confirmPartial } = req.validatedBody;
        const dates: string[] = [...new Set<string>(req.validatedBody.dates)].sort();

        const festival = await stores.festivals.getById(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        if (!festival.publishedAt) {
          return sendError(res, 409, 'Publish the festival before you send its set times.', ErrorCodes.DRAFT);
        }
        if (isFestivalOver(festival.days, festival.timeZone)) {
          return sendError(res, 409, 'This festival is over, so it cannot send set times.', ErrorCodes.FESTIVAL_OVER);
        }

        const counts = new Map(countByDate(festival).map((day) => [day.date, day]));
        for (const date of dates) {
          if (!counts.get(date)?.timed) {
            return sendError(
              res,
              400,
              `${date} is not a day of this festival with a timed set. Give a set on that day a start time first.`,
              ErrorCodes.INVALID_INPUT,
            );
          }
        }
        // The server enforces this, so a script or the mobile app cannot skip the check.
        const partial = dates.map((date) => counts.get(date)!).filter((day) => day.timed < day.total);
        if (partial.length > 0 && confirmPartial !== true) {
          return sendError(
            res,
            409,
            `Not every set has a time on ${partial.map((day) => day.label).join(', ')}. Send anyway to release it as it is.`,
            ErrorCodes.PARTIAL_RELEASE,
            { partial },
          );
        }

        const recipients = (await reengagementExecutor.resolveFollowersAndProfileHolders(festivalId)).length;
        const eventKey = `times:${festivalId}:${crypto.randomUUID()}`;
        const claimed = await stores.timeReleases.claim(festivalId, dates, eventKey, note ?? null);
        const claimedDates = new Set(claimed.map((r: any) => r.date));
        // A date claimed earlier whose send never finished: take it over. It keeps its own event key.
        const reclaimed = await stores.timeReleases.reclaimStuck(
          festivalId,
          dates.filter((date) => !claimedDates.has(date)),
        );
        const taken = [...claimed, ...reclaimed];
        if (taken.length === 0) {
          const releases = (await stores.timeReleases.list(festivalId))
            .filter((r: any) => dates.includes(r.date))
            .map((r: any) => ({ date: r.date, claimedAt: r.claimedAt, sentAt: r.sentAt }));
          return sendError(
            res,
            409,
            'Those dates were already released. To correct a time, send a festival announcement.',
            ErrorCodes.ALREADY_RELEASED,
            { releases },
          );
        }

        const datesByKey = new Map<string, string[]>();
        for (const row of taken) datesByKey.set(row.eventKey, [...(datesByKey.get(row.eventKey) ?? []), row.date]);
        for (const key of datesByKey.keys()) await reengagement.sendTimeRelease(festivalId, key);

        const takenDates = taken.map((r: any) => r.date).sort();
        await recordRelease(req, res, festivalId, {
          dates: takenDates,
          recipients,
          customLine: !!note,
          partial: partial.map((day) => day.date).filter((date) => takenDates.includes(date)),
        });
        res.status(202);
        return sendSuccess(res, {
          queued: true,
          dates: takenDates,
          skipped: dates.filter((date) => !takenDates.includes(date)),
          recipients,
        });
      } catch (err: any) {
        log.error('time release error', { error: err?.message });
        return sendError(res, 500, 'Failed to send set times', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
