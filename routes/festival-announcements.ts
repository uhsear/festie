// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Festival announcements (T44): admin notices to everyone who joined a festival.
 *
 * Admin, mounted at /api/v1/admin/festivals behind adminAuth:
 *   GET    /:id/announcements                  -> { festivalName, recipients, announcements }
 *   POST   /:id/announcements                  -> 201 { announcement, recipients }
 *   DELETE /:id/announcements/:announcementId  -> { announcement }
 * Public, mounted at /api/v1/festivals:
 *   GET    /:id/announcements                  -> FestivalAnnouncement[] for the banner
 *
 * Delivery is lib/announcements.ts; a send-now POST only nudges it.
 */

import crypto from 'crypto';

const MAX_LATE_MS = 60_000;
const MAX_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
const PER_HOUR_LIMIT = 3;

/** The banner feed shows only what attendees need; createdBy is an admin id. */
function toPublic(row: any) {
  const { id, festivalId, severity, title, body, screen, sentAt } = row;
  return { id, festivalId, severity, title, body, screen, sentAt };
}

export function createAdminAnnouncementRoutes(deps: any) {
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
    announcer,
    schemas,
    validate,
    setNoStore,
  } = deps;

  const router = express.Router();

  // An audit failure never fails the request; the flag stops the generic middleware writing a second row.
  async function writeAudit(req: any, res: any, festivalId: string, action: string, details: any) {
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
      log.warn('festival announcement audit write failed', { festivalId, action, error: err?.message });
    }
    res.locals.auditWritten = true;
  }

  async function countRecipients(festivalId: string): Promise<number> {
    return (await stores.profiles.userIdsByFestival(festivalId)).length;
  }

  router.get('/:id/announcements', adminAuth, async (req: any, res: any) => {
    setNoStore(res);
    try {
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      const [recipients, announcements] = await Promise.all([
        countRecipients(festivalId),
        stores.announcements.listForAdmin(festivalId),
      ]);
      return sendSuccess(res, { festivalName: festival.name, recipients, announcements });
    } catch (err: any) {
      log.error('festival announcements list error', { error: err?.message });
      return sendError(res, 500, 'Failed to load announcements', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post(
    '/:id/announcements',
    adminAuth,
    rateLimit(10, 'festival-announce'),
    validate(schemas.festivalAnnouncement),
    async (req: any, res: any) => {
      try {
        const festivalId = sanitizeIdentifier(req.params.id, 100);
        if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
        const festival = await getFestivalById(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        if (!festival.publishedAt) {
          return sendError(res, 409, 'Publish the festival before you send announcements.', ErrorCodes.INVALID_INPUT);
        }
        const { severity, title, body, screen, sendAt: requested } = req.validatedBody;
        const now = Date.now();
        const sendAtMs = requested ? Date.parse(requested) : now;
        if (sendAtMs < now - MAX_LATE_MS || sendAtMs > now + MAX_AHEAD_MS) {
          return sendError(res, 400, 'Pick a time in the next 14 days.', ErrorCodes.INVALID_INPUT);
        }
        const sendAt = new Date(sendAtMs).toISOString();
        if ((await stores.announcements.countNear(festivalId, sendAt)) >= PER_HOUR_LIMIT) {
          return sendError(
            res,
            429,
            'This festival already has 3 announcements within an hour of that time. Wait, or cancel one.',
            ErrorCodes.RATE_LIMITED,
          );
        }
        const announcement = await stores.announcements.create({
          id: crypto.randomUUID(),
          festivalId,
          severity,
          title,
          body,
          screen,
          sendAt,
          createdBy: req.user?.userId ?? null,
        });
        const recipients = await countRecipients(festivalId);
        await writeAudit(req, res, festivalId, 'festival_announcement_send', {
          announcementId: announcement.id,
          severity,
          screen,
          title,
          scheduled: Boolean(requested),
          sendAt,
          recipients,
        });
        if (!requested) {
          announcer.deliverDue().catch((err: any) => log.warn('announcement delivery failed', { error: err.message }));
        }
        res.status(201);
        return sendSuccess(res, { announcement, recipients });
      } catch (err: any) {
        log.error('festival announcement create error', { error: err?.message });
        return sendError(res, 500, 'Failed to create announcement', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.delete(
    '/:id/announcements/:announcementId',
    adminAuth,
    rateLimit(20, 'festival-announce-cancel'),
    async (req: any, res: any) => {
      try {
        const festivalId = sanitizeIdentifier(req.params.id, 100);
        if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
        const announcementId = sanitizeIdentifier(req.params.announcementId, 100);
        if (!announcementId) return sendError(res, 404, 'Announcement not found', ErrorCodes.NOT_FOUND);
        const announcement = await stores.announcements.cancel(festivalId, announcementId);
        if (!announcement) return sendError(res, 404, 'Announcement not found', ErrorCodes.NOT_FOUND);
        await writeAudit(req, res, festivalId, 'festival_announcement_cancel', {
          announcementId,
          wasSent: Boolean(announcement.sentAt),
        });
        return sendSuccess(res, { announcement });
      } catch (err: any) {
        log.error('festival announcement cancel error', { error: err?.message });
        return sendError(res, 500, 'Failed to cancel announcement', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}

export function createPublicAnnouncementRoutes(deps: any) {
  const { express, log, rateLimit, sanitizeIdentifier, sendSuccess, sendError, ErrorCodes, stores, getFestivalById, setNoStore } =
    deps;

  const router = express.Router();

  // No auth: guests see banners too. A missing or draft festival answers [] so the feed cannot reveal drafts.
  router.get('/:id/announcements', rateLimit(120, 'festival-announcements'), async (req: any, res: any) => {
    setNoStore(res);
    try {
      const festivalId = sanitizeIdentifier(req.params.id, 100);
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await getFestivalById(festivalId);
      if (!festival?.publishedAt) return sendSuccess(res, []);
      const rows = await stores.announcements.listActive(festivalId);
      return sendSuccess(res, rows.map(toPublic));
    } catch (err: any) {
      log.error('festival announcements feed error', { error: err?.message });
      return sendError(res, 500, 'Failed to load announcements', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
}
