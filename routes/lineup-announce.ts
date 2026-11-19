/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Lineup and days announcements — manual push, inbox and email alerts to followers.
 *
 * GET  /api/v1/admin/festivals/:id/lineup-announcement  -> dry run: who would hear that the lineup is out
 * POST /api/v1/admin/festivals/:id/lineup-announcement  -> { queued: true, recipients }
 * GET  /api/v1/admin/festivals/:id/days-announcement    -> dry run: how many acts have a day, who would hear
 * POST /api/v1/admin/festivals/:id/days-announcement    -> { queued: true, recipients, emailRecipients }
 *
 * No save, import or publish sends either alert; an admin sends it once the data is final.
 */

import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { createAdminAuditWriter } from '../lib/audit-middleware.js';

// Why "Announce days" refuses, as the message the admin sees and the status it carries.
const DAYS_REFUSALS: Record<string, [number, string]> = {
  draft: [409, 'Publish the festival before you announce its days.'],
  set_times_out: [409, 'Set times are already out. The set-times alert covered this.'],
  no_days: [400, 'Give acts a day before you announce days.'],
  no_audience: [400, 'No one follows this festival or has joined it yet.'],
  already_heard: [400, 'Everyone who follows has already heard.'],
};

export default function createLineupAnnounceRoute(deps: any) {
  const {
    express,
    log,
    festivalAccess,
    rateLimit,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    stores,
    getFestivalById,
    getRequestIp,
    reengagement,
    reengagementExecutor,
  } = deps;
  const writeAdminAudit = createAdminAuditWriter({ stores, log, getRequestIp });

  const router = express.Router();

  router.get('/:id/lineup-announcement', festivalAccess({ action: 'lineup.drop' }), async (req: any, res: any) => {
    try {
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const { reason: _reason, ...count } = await reengagementExecutor.countLineupDrop(festivalId);
      if (!count.festivalName) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      return sendSuccess(res, count);
    } catch (err: any) {
      log.error('lineup announcement count error', { error: err?.message });
      return sendError(res, 500, 'Failed to count recipients', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/:id/lineup-announcement', festivalAccess({ action: 'lineup.drop' }), rateLimit(3, 'lineup-announce'), async (req: any, res: any) => {
    try {
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (festival && !festival.publishedAt) {
        // The push deep-links to the festival, which attendees cannot open while it is a draft.
        return sendError(res, 409, 'Publish the festival before you announce its lineup.', ErrorCodes.INVALID_INPUT);
      }
      const { festivalName, recipients, followers, priorAttendees } = await reengagementExecutor.countLineupDrop(festivalId);
      if (!festivalName) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      // Push may be fully deduped while email still retries (its own dedup key), so only block when nobody is eligible.
      if (followers + priorAttendees === 0) {
        return sendError(
          res,
          400,
          'No one to notify. No one follows this festival or went to an earlier edition.',
          ErrorCodes.INVALID_INPUT,
        );
      }
      await reengagement.sendLineupDrop(festivalId);
      await writeAdminAudit(req, res, {
        action: AUDIT_ACTIONS.LINEUP_ANNOUNCED,
        targetType: 'festival',
        targetId: festivalId,
        details: { recipients },
      });
      return sendSuccess(res, { queued: true, recipients });
    } catch (err: any) {
      log.error('lineup announcement error', { error: err?.message });
      return sendError(res, 500, 'Failed to send announcement', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.get('/:id/days-announcement', festivalAccess({ action: 'lineup.drop' }), async (req: any, res: any) => {
    try {
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const count = await reengagementExecutor.countDaysOut(festivalId);
      if (count.reason === 'festival_not_found' || count.reason === 'no_festival') {
        return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      }
      return sendSuccess(res, count);
    } catch (err: any) {
      log.error('days announcement count error', { error: err?.message });
      return sendError(res, 500, 'Failed to count recipients', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/:id/days-announcement', festivalAccess({ action: 'lineup.drop' }), rateLimit(3, 'days-announce'), async (req: any, res: any) => {
    try {
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const count = await reengagementExecutor.countDaysOut(festivalId);
      if (count.reason === 'festival_not_found' || count.reason === 'no_festival') {
        return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      }
      const refusal = count.reason ? DAYS_REFUSALS[count.reason] : undefined;
      if (refusal) return sendError(res, refusal[0], refusal[1], ErrorCodes.INVALID_INPUT);
      await reengagement.sendDaysOut(festivalId);
      await writeAdminAudit(req, res, {
        action: AUDIT_ACTIONS.DAYS_ANNOUNCED,
        targetType: 'festival',
        targetId: festivalId,
        details: {
          recipients: count.recipients,
          emailRecipients: count.emailRecipients,
          actsWithDay: count.actsWithDay,
          actsTotal: count.actsTotal,
        },
      });
      return sendSuccess(res, { queued: true, recipients: count.recipients, emailRecipients: count.emailRecipients });
    } catch (err: any) {
      log.error('days announcement error', { error: err?.message });
      return sendError(res, 500, 'Failed to send announcement', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
