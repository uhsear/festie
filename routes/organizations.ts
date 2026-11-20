// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Admin routes for organizations, mounted at /api/v1/admin/organizations behind adminAuth
 * (lib/festival-mounts.ts). Only a platform admin creates or activates an organization, adds an owner,
 * sets verified_at or suspends. Member changes need a recent password, as other destructive admin actions do.
 */

import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { createAdminAuditWriter } from '../lib/audit-middleware.js';
import { OrganizationError } from '../lib/db/stores/organizations.js';

export default function createOrganizationsRoutes(deps: any) {
  const {
    express,
    log,
    stores,
    schemas,
    validate,
    validateQuery,
    validateParams,
    rateLimit,
    requireRecentAuth,
    createOpaqueId,
    getRequestIp,
    setNoStore,
    sendSuccess,
    sendError,
    ErrorCodes,
  } = deps;

  const router = express.Router();
  const writeAdminAudit = createAdminAuditWriter({ stores, log, getRequestIp });
  const audit = (req: any, res: any, action: string, organizationId: string, details: Record<string, unknown> = {}) =>
    writeAdminAudit(req, res, { action, targetType: 'organization', targetId: organizationId, organizationId, details });

  // A store refusal (missing organization, last owner, duplicate member) keeps its status; anything else is a 500.
  function fail(res: any, error: unknown, what: string) {
    if (error instanceof OrganizationError) return sendError(res, error.status, error.message, ErrorCodes[error.code]);
    log.error(`${what} failed`, { error: (error as Error).message });
    return sendError(res, 500, `Failed to ${what}`, ErrorCodes.INTERNAL_ERROR);
  }

  const notFound = (res: any) => sendError(res, 404, 'Organization not found.', ErrorCodes.NOT_FOUND);

  router.post('/', rateLimit(20, 'admin-org-create'), validate(schemas.organizationCreate), async (req: any, res: any) => {
    try {
      const { name, kind, website } = req.validatedBody;
      const organization = await stores.organizations.create({
        id: createOpaqueId('org'),
        name,
        kind,
        website: website ?? null,
        status: 'pending',
        createdBy: req.user.userId,
      });
      await audit(req, res, AUDIT_ACTIONS.ORGANIZATION_CREATED, organization.id, { name, kind });
      res.status(201);
      return sendSuccess(res, organization);
    } catch (error) {
      return fail(res, error, 'create organization');
    }
  });

  router.get('/', rateLimit(60, 'admin-org-list'), validateQuery(schemas.organizationList), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const { status, ownerless } = req.validatedQuery;
      return sendSuccess(res, await stores.organizations.list({ status, ownerless: ownerless === 'true' }));
    } catch (error) {
      return fail(res, error, 'list organizations');
    }
  });

  router.get('/:id', rateLimit(60, 'admin-org-get'), validateParams(schemas.organizationIdParams), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const { id } = req.validatedParams;
      const organization = await stores.organizations.getById(id);
      if (!organization) return notFound(res);
      const [members, pending, festivals] = await Promise.all([
        stores.organizations.listMembers(id),
        stores.organizations.listPending(id),
        stores.organizations.listFestivals([id]),
      ]);
      return sendSuccess(res, { ...organization, members, pending, festivals });
    } catch (error) {
      return fail(res, error, 'load organization');
    }
  });

  router.put(
    '/:id/status',
    rateLimit(30, 'admin-org-write'),
    validateParams(schemas.organizationIdParams),
    validate(schemas.organizationStatus),
    async (req: any, res: any) => {
      try {
        const { id } = req.validatedParams;
        const { status } = req.validatedBody;
        const organization = await stores.organizations.setStatus(id, status);
        if (!organization) return notFound(res);
        await audit(
          req,
          res,
          status === 'active' ? AUDIT_ACTIONS.ORGANIZATION_ACTIVATED : AUDIT_ACTIONS.ORGANIZATION_SUSPENDED,
          id,
        );
        return sendSuccess(res, organization);
      } catch (error) {
        return fail(res, error, 'change organization status');
      }
    },
  );

  router.put(
    '/:id/verified',
    rateLimit(30, 'admin-org-write'),
    validateParams(schemas.organizationIdParams),
    validate(schemas.organizationVerified),
    async (req: any, res: any) => {
      try {
        const { id } = req.validatedParams;
        const { verified } = req.validatedBody;
        const organization = await stores.organizations.setVerified(id, verified);
        if (!organization) return notFound(res);
        await audit(req, res, verified ? AUDIT_ACTIONS.ORGANIZATION_VERIFIED : AUDIT_ACTIONS.ORGANIZATION_UNVERIFIED, id);
        return sendSuccess(res, organization);
      } catch (error) {
        return fail(res, error, 'change organization verification');
      }
    },
  );

  // A confirmed account joins at once. Any other address is stored as pending and claimed through GET /manage/me.
  router.post(
    '/:id/members',
    rateLimit(30, 'admin-org-write'),
    requireRecentAuth,
    validateParams(schemas.organizationIdParams),
    validate(schemas.organizationMemberAdd),
    async (req: any, res: any) => {
      try {
        const { id } = req.validatedParams;
        const { email, role } = req.validatedBody;
        const added = await stores.organizations.addByEmail(id, email, role, req.user.userId);
        if (added.kind === 'member') {
          await audit(req, res, AUDIT_ACTIONS.ORGANIZATION_MEMBER_ADDED, id, { userId: added.userId, role, via: 'admin' });
        } else {
          await audit(req, res, AUDIT_ACTIONS.ORGANIZATION_PENDING_MEMBER_ADDED, id, { email, role });
        }
        res.status(201);
        return sendSuccess(res, added);
      } catch (error) {
        return fail(res, error, 'add member');
      }
    },
  );

  router.put(
    '/:id/members/:userId',
    rateLimit(30, 'admin-org-write'),
    requireRecentAuth,
    validateParams(schemas.organizationMemberParams),
    validate(schemas.organizationMemberRole),
    async (req: any, res: any) => {
      try {
        const { id, userId } = req.validatedParams;
        const { role } = req.validatedBody;
        const changed = await stores.organizations.changeRole(id, userId, role);
        await audit(req, res, AUDIT_ACTIONS.ORGANIZATION_MEMBER_ROLE_CHANGED, id, changed);
        return sendSuccess(res, changed);
      } catch (error) {
        return fail(res, error, 'change member role');
      }
    },
  );

  router.delete(
    '/:id/members/:userId',
    rateLimit(30, 'admin-org-write'),
    requireRecentAuth,
    validateParams(schemas.organizationMemberParams),
    async (req: any, res: any) => {
      try {
        const { id, userId } = req.validatedParams;
        const removed = await stores.organizations.removeMember(id, userId);
        await audit(req, res, AUDIT_ACTIONS.ORGANIZATION_MEMBER_REMOVED, id, removed);
        return sendSuccess(res, removed);
      } catch (error) {
        return fail(res, error, 'remove member');
      }
    },
  );

  router.delete(
    '/:id/pending-members/:email',
    rateLimit(30, 'admin-org-write'),
    requireRecentAuth,
    validateParams(schemas.organizationPendingParams),
    async (req: any, res: any) => {
      try {
        const { id, email } = req.validatedParams;
        if (!(await stores.organizations.removePending(id, email))) {
          return sendError(res, 404, 'No pending member with that email.', ErrorCodes.NOT_FOUND);
        }
        await audit(req, res, AUDIT_ACTIONS.ORGANIZATION_PENDING_MEMBER_REMOVED, id, { email });
        return sendSuccess(res, { email });
      } catch (error) {
        return fail(res, error, 'remove pending member');
      }
    },
  );

  return router;
}
