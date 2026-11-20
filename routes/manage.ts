// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The organizer router, mounted at /api/v1/manage behind userAuth (lib/festival-mounts.ts).
 *
 * It is the only place where an organization member is granted a role (festivalAccess reads
 * req.organizerMount, which only this file sets). Own handlers: GET /me, GET /festivals, POST /festivals, and
 * POST|DELETE /festivals/:id/publish-request (submit for review and withdraw).
 * Every other path is forwarded to an existing router, and only when it is on MANAGE_WHITELIST. A path
 * that is not listed answers 404 and never reaches those routers, so a route added to them later stays
 * admin-only until someone lists it here and the access-matrix test covers it.
 */

import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { auditContext } from '../lib/audit-middleware.js';
import { publishChecklist, submitBlockers } from '../lib/helpers/validation.js';
import { appOrigin } from '../lib/notifications/links.js';
import { firstRuleMessage, organizerFestivalRules } from '../lib/schemas/organizer-rules.js';
import type { FestivalAction } from '../lib/app-context/session.js';

type ForwardTarget = 'festivals' | 'lineupImport' | 'siteplan';

export type ManageEntry = {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  /** Where the target router is mounted under /manage. */
  mount: '/festivals' | '';
  /** The route's own path inside that router. */
  path: string;
  target: ForwardTarget;
  /** A festivalAccess action for a route that has none of its own (a read the public mount also serves). */
  guard?: FestivalAction;
  /** Path segments that are routes of the target router, not ids. */
  reserved?: string[];
};

const RESERVED_IDS = ['archived', 'follows'];

// plan-v3 section 3.6. GET /festivals (the router's GET '/') is absent on purpose, so the shared admin list
// cache is never filled for an organizer, and so are restore, the decline of a request and every announcement route.
export const MANAGE_WHITELIST: ManageEntry[] = [
  { method: 'GET', mount: '/festivals', path: '/:id', target: 'festivals', guard: 'festival.view', reserved: RESERVED_IDS },
  { method: 'PUT', mount: '/festivals', path: '/:id', target: 'festivals', reserved: RESERVED_IDS },
  { method: 'DELETE', mount: '/festivals', path: '/:id', target: 'festivals', reserved: RESERVED_IDS },
  { method: 'GET', mount: '/festivals', path: '/:id/impact', target: 'festivals' },
  // Direct publish: the route lets in only a member of a verified organization, and an admin.
  { method: 'POST', mount: '/festivals', path: '/:id/publish', target: 'festivals' },
  { method: 'POST', mount: '/festivals', path: '/:id/import-lineup/preview', target: 'lineupImport' },
  { method: 'POST', mount: '/festivals', path: '/:id/import-lineup', target: 'lineupImport' },
  { method: 'GET', mount: '/festivals', path: '/:id/imports', target: 'lineupImport' },
  { method: 'POST', mount: '/festivals', path: '/:id/imports/:importId/undo', target: 'lineupImport' },
  { method: 'PUT', mount: '/festivals', path: '/:festivalId/sets/:setId/link', target: 'festivals' },
  { method: 'GET', mount: '/festivals', path: '/:festivalId/sets/links', target: 'festivals' },
  { method: 'POST', mount: '', path: '/festivals/:id/siteplan-image', target: 'siteplan' },
];

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `/festivals/:id/impact` becomes /^\/festivals\/(?<id>[^/]+)\/impact$/, so the guard reads the params itself.
function pathPattern(entry: ManageEntry): RegExp {
  const segments = (entry.mount + entry.path).split('/').slice(1);
  const body = segments
    .map((segment, index) => {
      if (!segment.startsWith(':')) return escapeRegex(segment);
      const reserved = entry.reserved && index === segments.length - 1 ? `(?!(?:${entry.reserved.join('|')})$)` : '';
      return `${reserved}(?<${segment.slice(1)}>[^/]+)`;
    })
    .join('\\/');
  return new RegExp(`^\\/${body}$`);
}

export default function createManageRoutes(
  deps: any,
  forwarded: { festivalRoutes: any; lineupImportRoutes: any; siteplanRoutes: any },
) {
  const {
    express,
    config,
    log,
    stores,
    festivalAccess,
    orgAccess,
    rateLimit,
    validate,
    getRequestIp,
    sanitizeFestivalPayload,
    validateFestivalIssues,
    sendSuccess,
    sendError,
    ErrorCodes,
  } = deps;

  const router = express.Router();

  const compiled = MANAGE_WHITELIST.map((entry) => ({
    entry,
    pattern: pathPattern(entry),
    guard: entry.guard ? festivalAccess({ action: entry.guard, param: 'id' }) : null,
  }));

  // Every request below runs on the manage mount, so festivalAccess and orgAccess may grant a role. This is the
  // only place that sets req.organizerMount. The forwarding guard further down still lists what may be forwarded.
  // Every manage response is per user. Handlers of the forwarded routers set their own Cache-Control, so the
  // header is pinned here: a later setHeader for it is ignored.
  router.use((req: any, res: any, next: any) => {
    req.organizerMount = true;
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name: string, value: any) => (/^cache-control$/i.test(name) ? res : setHeader(name, value));
    setHeader('Vary', 'Cookie');
    setHeader('Cache-Control', 'private, no-store');
    next();
  });

  async function writeAudit(
    req: any,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>,
    context = auditContext(req),
  ) {
    try {
      await stores.auditLog.insert({
        ...context,
        actorId: req.user?.userId,
        action,
        targetType,
        targetId,
        detailsJson: JSON.stringify(details),
        ip: getRequestIp(req),
      });
    } catch (error) {
      log.warn('manage audit write failed', { action, error: (error as Error).message });
    }
  }

  // The caller's organizations. First it claims every pending membership that matches the confirmed email, so a
  // person added by email before they had an account sees the organization on the next load.
  router.get('/me', rateLimit(60, 'manage-me'), async (req: any, res: any) => {
    try {
      const userId = req.user.userId;
      const claimed = await stores.organizations.claimPending(userId);
      for (const row of claimed) {
        await writeAudit(
          req,
          AUDIT_ACTIONS.ORGANIZATION_MEMBER_ADDED,
          'organization',
          row.organizationId,
          { userId, role: row.role, via: 'email' },
          { actorType: 'organizer', organizationId: row.organizationId },
        );
      }
      const user = await stores.users.getById(userId);
      const organizations = await stores.organizations.listForUser(userId);
      return sendSuccess(res, {
        emailConfirmed: !!user?.emailVerifiedAt,
        organizations: organizations.map(({ id, name, role, status, verified }: any) => ({ id, name, role, status, verified })),
      });
    } catch (error) {
      log.error('manage me failed', { error: (error as Error).message });
      return sendError(res, 500, 'Failed to load your organizations', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // The festivals of the caller's organizations, drafts and soft-deleted ones included. It reads the database
  // directly, never the shared list cache that GET /festivals fills.
  router.get('/festivals', rateLimit(120, 'manage-festivals'), async (req: any, res: any) => {
    try {
      const organizations = await stores.organizations.listForUser(req.user.userId);
      const festivals = await stores.organizations.listFestivals(organizations.map((org: any) => org.id));
      return sendSuccess(res, festivals);
    } catch (error) {
      log.error('manage festival list failed', { error: (error as Error).message });
      return sendError(res, 500, 'Failed to load festivals', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // A new festival is a draft of the organization, with a server-made id. Set ids from the client are dropped.
  router.post(
    '/festivals',
    orgAccess({ action: 'festival.create' }),
    rateLimit(10, 'manage-festival-create'),
    validate(deps.schemas.organizerFestivalCreate),
    async (req: any, res: any) => {
      try {
        const { organizationId, ...input } = req.validatedBody;
        if (req.festivalRole !== 'admin') {
          const counts = await stores.organizations.festivalCounts(organizationId);
          if (req.orgStatus === 'pending' && counts.drafts >= config.ORGANIZER_PENDING_FESTIVAL_CAP) {
            return sendError(
              res,
              403,
              `You can have ${config.ORGANIZER_PENDING_FESTIVAL_CAP} drafts while Festie checks your organization.`,
              ErrorCodes.FORBIDDEN,
            );
          }
          if (req.orgStatus === 'active' && counts.total >= config.ORGANIZER_ACTIVE_FESTIVAL_CAP) {
            return sendError(res, 403, `An organization can hold ${config.ORGANIZER_ACTIVE_FESTIVAL_CAP} festivals. Contact Festie for more.`, ErrorCodes.FORBIDDEN);
          }
        }
        const rules = organizerFestivalRules(appOrigin(config)).safeParse(input);
        if (!rules.success) {
          return sendError(res, 400, firstRuleMessage(rules.error), ErrorCodes.INVALID_INPUT, {
            issues: rules.error.issues.map((issue: any) => ({ path: issue.path.join('.'), message: issue.message })),
          });
        }
        const issues = validateFestivalIssues(config, input);
        if (issues.length > 0) {
          const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
          return sendError(res, 400, `${issues[0].message}${more}`, ErrorCodes.INVALID_INPUT, { issues });
        }
        const festival = sanitizeFestivalPayload({
          ...input,
          days: input.days?.map((day: any) => ({ ...day, sets: day.sets?.map(({ id: _id, ...set }: any) => set) })),
        });
        await stores.festivals.create({
          ...festival,
          publishedAt: null,
          updatedBy: req.user.userId,
          createdBy: req.user.userId,
          organizationId,
        });
        deps.invalidateFestivalCache();
        deps.invalidateFestivalListCache?.();
        await writeAudit(req, AUDIT_ACTIONS.FESTIVAL_CREATED, 'festival', festival.id, { name: festival.name });
        res.status(201);
        return sendSuccess(res, { ...festival, organizationId, publishedAt: null });
      } catch (error) {
        log.error('manage festival create failed', { error: (error as Error).message });
        return sendError(res, 500, 'Failed to create festival', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Submit a draft for review. An owner of an active organization may; the request waits for an admin. The
  // checklist gate ignores the days item, so a festival with names only can be submitted (master plan C10),
  // but publishing still needs dated days. A second submit keeps the first time and writes no second audit row.
  router.post(
    '/festivals/:id/publish-request',
    festivalAccess({ action: 'publish.request' }),
    rateLimit(10, 'manage-publish-request'),
    async (req: any, res: any) => {
      try {
        const festival = await stores.festivals.getById(req.festivalId);
        if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
        if (festival.publishedAt) return sendError(res, 409, 'This festival is already live.', ErrorCodes.CONFLICT);
        const checklist = publishChecklist(config, festival);
        if (submitBlockers(festival, checklist).length > 0) {
          return sendError(res, 409, 'Finish the checklist before you submit.', ErrorCodes.PUBLISH_BLOCKED, { checklist });
        }
        const requested = await stores.festivalReview.requestPublish(festival.id);
        if (!requested) return sendError(res, 409, 'This festival is already live.', ErrorCodes.CONFLICT);
        if (!requested.already) {
          await writeAudit(req, AUDIT_ACTIONS.FESTIVAL_PUBLISH_REQUESTED, 'festival', festival.id, { name: festival.name });
        }
        deps.invalidateFestivalListCache?.();
        return sendSuccess(res, { requestedAt: requested.requestedAt, checklist });
      } catch (error) {
        log.error('manage publish request failed', { error: (error as Error).message });
        return sendError(res, 500, 'Failed to submit for review', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Take a waiting request back. The draft stays as it is.
  router.delete(
    '/festivals/:id/publish-request',
    festivalAccess({ action: 'publish.withdraw' }),
    rateLimit(10, 'manage-publish-withdraw'),
    async (req: any, res: any) => {
      try {
        if (!(await stores.festivalReview.withdrawPublish(req.festivalId))) {
          if (!(await stores.festivalReview.reviewState(req.festivalId))) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
          return sendError(res, 409, 'No review request is waiting for this festival.', ErrorCodes.CONFLICT);
        }
        await writeAudit(req, AUDIT_ACTIONS.FESTIVAL_PUBLISH_WITHDRAWN, 'festival', req.festivalId, {});
        return sendSuccess(res, { withdrawn: true });
      } catch (error) {
        log.error('manage publish withdraw failed', { error: (error as Error).message });
        return sendError(res, 500, 'Failed to withdraw the request', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Everything else: forward a listed route, 404 the rest.
  router.use(async (req: any, res: any, next: any) => {
    const hit = compiled.find((c) => c.entry.method === req.method && c.pattern.test(req.path));
    if (!hit) return sendError(res, 404, 'Not found', ErrorCodes.NOT_FOUND);
    if (!hit.guard) return next();
    const groups = hit.pattern.exec(req.path)?.groups ?? {};
    try {
      req.params = Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, decodeURIComponent(value as string)]));
    } catch {
      return sendError(res, 404, 'Not found', ErrorCodes.NOT_FOUND);
    }
    return hit.guard(req, res, next);
  });

  router.use('/festivals', forwarded.festivalRoutes, forwarded.lineupImportRoutes);
  router.use(forwarded.siteplanRoutes);
  // A listed route the forwarded routers did not answer (a whitelist entry with no matching route).
  router.use((_req: any, res: any) => sendError(res, 404, 'Not found', ErrorCodes.NOT_FOUND));

  return router;
}
