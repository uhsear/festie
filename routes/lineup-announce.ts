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

import { verifiedOrganizationOnly } from '../lib/app-context/session.js';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { organizerAudience } from '../lib/organizer-engagement.js';
import { createAdminAuditWriter } from '../lib/audit-middleware.js';
import type { RouteDeps } from '../lib/types';

// Why "Announce days" refuses, as the message the admin sees and the status it carries.
const DAYS_REFUSALS: Record<string, [number, string]> = {
  draft: [409, 'Publish the festival before you announce its days.'],
  set_times_out: [409, 'Set times are already out. The set-times alert covered this.'],
  no_days: [400, 'Give acts a day before you announce days.'],
  no_audience: [400, 'No one follows this festival or has joined it yet.'],
  already_heard: [400, 'Everyone who follows has already heard.'],
};

export default function createLineupAnnounceRoute(deps: RouteDeps) {
  const {
    express,
    log,
    festivalAccess,
    rateLimit,
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

  // A member of a verified organization sends the lineup drop of its own festival: push and inbox only, and the
  // prior-edition audience is limited to the organization's own editions (plan-v3 4.5). An admin send is unscoped.
  const lineupAccess = festivalAccess({ action: 'lineup.announce', allow: verifiedOrganizationOnly });
  const scopeOf = (req: any): string | undefined => (req.festivalRole === 'admin' ? undefined : req.organizationId);

  router.get('/:id/lineup-announcement', lineupAccess, async (req: any, res: any) => {
    try {
      const festivalId = req.festivalId;
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const scope = scopeOf(req);
      const { reason: _reason, ...count } = await reengagementExecutor.countLineupDrop(festivalId, scope);
      if (!count.festivalName) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      // An organizer learns audience sizes only above the floor (owner decision 4); a small audience reads as null.
      const shown = scope
        ? { ...count, recipients: organizerAudience(count.recipients), followers: organizerAudience(count.followers), priorAttendees: organizerAudience(count.priorAttendees) }
        : count;
      return sendSuccess(res, shown);
    } catch (err: any) {
      log.error('lineup announcement count error', { error: err?.message });
      return sendError(res, 500, 'Failed to count recipients', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/:id/lineup-announcement', lineupAccess, rateLimit(3, 'lineup-announce'), async (req: any, res: any) => {
    try {
      const festivalId = req.festivalId;
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (festival && !festival.publishedAt) {
        // The push deep-links to the festival, which attendees cannot open while it is a draft.
        return sendError(res, 409, 'Publish the festival before you announce its lineup.', ErrorCodes.DRAFT);
      }
      const scope = scopeOf(req);
      const { festivalName, recipients, followers, priorAttendees } = await reengagementExecutor.countLineupDrop(festivalId, scope);
      if (!festivalName) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      // Push may be fully deduped while email still retries (its own dedup key), so only block when nobody is eligible.
      // An organizer is never told that the audience is exactly zero (owner decision 4), so an empty one is answered
      // like any other and uses the day's send. Only an admin is told that nobody can be notified.
      if (!scope && followers + priorAttendees === 0) {
        return sendError(
          res,
          400,
          'No one to notify. No one follows this festival or went to an earlier edition.',
          ErrorCodes.INVALID_INPUT,
        );
      }
      // An organization sends the lineup drop of a festival once a day. The claim is atomic, unlike a count of audit rows.
      let claimId: number | null = null;
      if (scope) {
        claimId = await stores.festivalReview.claimLineupAnnounce(festivalId);
        if (claimId === null) {
          return sendError(res, 429, 'This festival already sent its lineup announcement today. Try again tomorrow.', ErrorCodes.RATE_LIMITED);
        }
      }
      try {
        await reengagement.sendLineupDrop(festivalId, scope);
      } catch (err) {
        if (claimId !== null) await stores.festivalReview.releaseLineupAnnounce(claimId);
        throw err;
      }
      await writeAdminAudit(req, res, {
        action: AUDIT_ACTIONS.LINEUP_ANNOUNCED,
        targetType: 'festival',
        targetId: festivalId,
        details: { recipients },
      });
      return sendSuccess(res, { queued: true, recipients: scope ? organizerAudience(recipients) : recipients });
    } catch (err: any) {
      log.error('lineup announcement error', { error: err?.message });
      return sendError(res, 500, 'Failed to send announcement', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.get('/:id/days-announcement', festivalAccess({ action: 'lineup.drop' }), async (req: any, res: any) => {
    try {
      const festivalId = req.festivalId;
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
      const festivalId = req.festivalId;
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
