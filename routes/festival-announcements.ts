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
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { auditContext } from '../lib/audit-middleware.js';
import { CAP_REACHED } from '../lib/response.js';
import { organizerAudience } from '../lib/organizer-engagement.js';
import type { RouteDeps } from '../lib/types';

const MAX_LATE_MS = 60_000;
const MAX_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
const PER_HOUR_LIMIT = 3;

/** The banner feed shows only what attendees need; createdBy is an admin id. */
function toPublic(row: any) {
  const { id, festivalId, severity, title, body, screen, sentAt } = row;
  return { id, festivalId, severity, title, body, screen, sentAt };
}

export function createAdminAnnouncementRoutes(deps: RouteDeps) {
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
    announcer,
    schemas,
    validate,
    setNoStore,
    config,
  } = deps;

  const router = express.Router();
  // festivalAccess sets festivalRole on every request it lets through: 'admin', or the role of a member on /manage.
  const isMember = (req: any) => req.festivalRole !== undefined && req.festivalRole !== 'admin';

  // An audit failure never fails the request; the flag stops the generic middleware writing a second row.
  async function writeAudit(req: any, res: any, festivalId: string, action: string, details: any) {
    try {
      await stores.auditLog.insert({
        id: crypto.randomUUID(),
        ...auditContext(req),
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

  router.get('/:id/announcements', festivalAccess({ action: 'announcement.manage' }), async (req: any, res: any) => {
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
      // The creator is an account id; a member of an organization sees none, an admin's included.
      const shown = isMember(req)
        ? announcements.map(({ createdBy: _createdBy, recipientCount, ...row }: any) => ({ ...row, recipientCount: organizerAudience(recipientCount ?? 0) }))
        : announcements;
      return sendSuccess(res, { festivalName: festival.name, recipients: isMember(req) ? organizerAudience(recipients) : recipients, announcements: shown });
    } catch (err: any) {
      log.error('festival announcements list error', { error: err?.message });
      return sendError(res, 500, 'Failed to load announcements', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post(
    '/:id/announcements',
    festivalAccess({ action: 'announcement.manage' }),
    rateLimit(10, 'festival-announce'),
    validate(schemas.festivalAnnouncement),
    async (req: any, res: any) => {
      try {
        const festivalId = sanitizeIdentifier(req.params.id, 100);
        if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
        const festival = await getFestivalById(festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        if (!festival.publishedAt) {
          return sendError(res, 409, 'Publish the festival before you send announcements.', ErrorCodes.DRAFT);
        }
        const { severity, title, body, screen, sendAt: requested } = req.validatedBody;
        const member = isMember(req);
        // Urgent stays Festie's (lib/schemas.ts). An organization's banner reaches everyone who joined; its push needs a
        // verified organization, and every organization shares one daily cap.
        if (member && severity === 'urgent') {
          return sendError(res, 403, 'Only Festie can send an urgent announcement.', ErrorCodes.FORBIDDEN);
        }
        const capMessage = () => `Your organization can send ${config.ORGANIZER_ANNOUNCEMENT_DAILY_CAP} announcements a day. Try again tomorrow.`;
        // A cheap early answer; the insert below enforces the cap again under the organization lock.
        if (member && (await stores.announcements.countByOrganizationToday(req.organizationId)) >= config.ORGANIZER_ANNOUNCEMENT_DAILY_CAP) {
          return sendError(res, 429, capMessage(), ErrorCodes.RATE_LIMITED, CAP_REACHED);
        }
        const push = !member || req.orgVerified === true;
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
            CAP_REACHED,
          );
        }
        const row = {
          id: crypto.randomUUID(),
          festivalId,
          severity,
          title,
          body,
          screen,
          sendAt,
          createdBy: req.user?.userId ?? null,
          push,
        };
        // An organization's daily cap is counted and the row inserted under the organization lock, so parallel posts cannot pass it.
        const announcement = member
          ? await stores.announcements.createWithinOrganizationCap({ ...row, organizationId: req.organizationId }, config.ORGANIZER_ANNOUNCEMENT_DAILY_CAP)
          : await stores.announcements.create({ ...row, organizationId: null });
        if (!announcement) return sendError(res, 429, capMessage(), ErrorCodes.RATE_LIMITED, CAP_REACHED);
        const recipients = await countRecipients(festivalId);
        await writeAudit(req, res, festivalId, AUDIT_ACTIONS.FESTIVAL_ANNOUNCEMENT_SENT, {
          announcementId: announcement.id,
          severity,
          screen,
          title,
          scheduled: Boolean(requested),
          sendAt,
          recipients,
          push,
        });
        if (!requested) {
          announcer.deliverDue().catch((err: any) => log.warn('announcement delivery failed', { error: err.message }));
        }
        res.status(201);
        const { createdBy: _createdBy, recipientCount: _recipientCount, ...shown } = announcement;
        return sendSuccess(res, { announcement: member ? shown : announcement, recipients: member ? organizerAudience(recipients) : recipients });
      } catch (err: any) {
        log.error('festival announcement create error', { error: err?.message });
        return sendError(res, 500, 'Failed to create announcement', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.delete(
    '/:id/announcements/:announcementId',
    festivalAccess({ action: 'announcement.manage' }),
    rateLimit(20, 'festival-announce-cancel'),
    async (req: any, res: any) => {
      try {
        const festivalId = sanitizeIdentifier(req.params.id, 100);
        if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
        const announcementId = sanitizeIdentifier(req.params.announcementId, 100);
        if (!announcementId) return sendError(res, 404, 'Announcement not found', ErrorCodes.NOT_FOUND);
        const announcement = await stores.announcements.cancel(festivalId, announcementId);
        if (!announcement) return sendError(res, 404, 'Announcement not found', ErrorCodes.NOT_FOUND);
        await writeAudit(req, res, festivalId, AUDIT_ACTIONS.FESTIVAL_ANNOUNCEMENT_CANCELLED, {
          announcementId,
          wasSent: Boolean(announcement.sentAt),
        });
        const { createdBy: _createdBy, ...shown } = announcement;
        return sendSuccess(res, { announcement: isMember(req) ? shown : announcement });
      } catch (err: any) {
        log.error('festival announcement cancel error', { error: err?.message });
        return sendError(res, 500, 'Failed to cancel announcement', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}

export function createPublicAnnouncementRoutes(deps: RouteDeps) {
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
