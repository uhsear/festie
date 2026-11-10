/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Lineup announcement — manual "lineup just dropped" push + email.
 *
 * GET  /api/v1/admin/festivals/:id/lineup-announcement  -> { festivalName, recipients }
 * POST /api/v1/admin/festivals/:id/lineup-announcement  -> { queued: true, recipients }
 *
 * Import no longer sends this automatically; an admin sends it once the lineup is final.
 */

import crypto from 'crypto';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';

export default function createLineupAnnounceRoute(deps: any) {
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
    getFestivalById,
    getRequestIp,
    reengagement,
    reengagementExecutor,
  } = deps;

  const router = express.Router();

  router.get('/:id/lineup-announcement', adminAuth, async (req: any, res: any) => {
    try {
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const { festivalName, recipients } = await reengagementExecutor.countLineupDrop(festivalId);
      if (!festivalName) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      return sendSuccess(res, { festivalName, recipients });
    } catch (err: any) {
      log.error('lineup announcement count error', { error: err?.message });
      return sendError(res, 500, 'Failed to count recipients', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/:id/lineup-announcement', adminAuth, rateLimit(3, 'lineup-announce'), async (req: any, res: any) => {
    try {
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (festival && !festival.publishedAt) {
        // The push deep-links to the festival, which attendees cannot open while it is a draft.
        return sendError(res, 409, 'Publish the festival before you announce its lineup.', ErrorCodes.INVALID_INPUT);
      }
      const { festivalName, recipients, priorAttendees } = await reengagementExecutor.countLineupDrop(festivalId);
      if (!festivalName) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      // Push may be fully deduped while email still retries (its own dedup key), so only block when nobody is eligible.
      if (priorAttendees === 0) {
        return sendError(
          res,
          400,
          'No one to notify. No one follows this festival or went to an earlier edition.',
          ErrorCodes.INVALID_INPUT,
        );
      }
      await reengagement.sendLineupDrop(festivalId);
      if (stores.auditLog) {
        try {
          await stores.auditLog.insert({
            id: crypto.randomUUID(),
            actorType: 'admin',
            actorId: req.user?.userId,
            action: AUDIT_ACTIONS.LINEUP_ANNOUNCED,
            targetType: 'festival',
            targetId: festivalId,
            detailsJson: JSON.stringify({ recipients }),
            ip: getRequestIp(req),
          });
        } catch (err: any) {
          log.warn('lineup announce audit write failed', { festivalId, error: err?.message });
        }
      }
      // Tells the generic audit middleware this request already has its row.
      res.locals.auditWritten = true;
      return sendSuccess(res, { queued: true, recipients });
    } catch (err: any) {
      log.error('lineup announcement error', { error: err?.message });
      return sendError(res, 500, 'Failed to send announcement', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
