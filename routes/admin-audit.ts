// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
/**
 * Admin audit-log query routes
 * Extracted from routes/admin.js during the 2026-04-14 file-size split.
 * Mounts: /audit
 */
export default function mountAdminAuditRoutes({ router, deps, ctx }: any): void {
  const {
    log,
    setNoStore,
    sendSuccess, sendError, ErrorCodes,
    adminAuth,
    stores,
    schemas, validateQuery,
    getUsers,
  } = deps;
  const { getFriendlyAction } = ctx;

  // ── GET /audit — query audit log with filters ────────────
  router.get('/audit', adminAuth, validateQuery(schemas.adminAuditQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const { actor_id: actorId, action, resource_type: resourceType, cursor, limit, scope, actor } = req.validatedQuery;
      const actorType = scope === 'all' ? null : scope;
      const from = req.validatedQuery.from ? new Date(req.validatedQuery.from).toISOString() : null;
      const to = req.validatedQuery.to ? new Date(req.validatedQuery.to).toISOString() : null;

      const users = await getUsers();
      const usernameById = new Map<string, string>(users.map((u: any) => [u.id, u.username]));

      // Resolve the username filter to an id; an unknown name matches nothing.
      let resolvedActorId = actorId || null;
      if (actor) {
        const wanted = actor.toLowerCase();
        const match = users.find((u: any) => String(u.username).toLowerCase() === wanted);
        if (!match) return sendSuccess(res, [], { total: 0, limit, nextCursor: null });
        resolvedActorId = match.id;
      }

      const filters = { actorId: resolvedActorId, actorType, action: action || null, resourceType: resourceType || null, from, to };
      const [{ rows, nextCursor }, total] = await Promise.all([
        stores.auditLog.query({ ...filters, limit, cursor: cursor || null }),
        stores.auditLog.count(filters),
      ]);

      const entries = rows.map((row: any) => ({
        ...row,
        friendlyAction: getFriendlyAction(row.action),
        actorUsername: usernameById.get(row.actorId) || row.actorId,
        targetLabel: row.details?.targetUsername || row.details?.name || `${row.targetType} ${row.targetId ?? ''}`.trim(),
      }));

      return sendSuccess(res, entries, { total, limit, nextCursor });
    } catch (error: any) {
      log.error('admin audit query failed', { error: error.message });
      return sendError(res, 500, 'Failed to query audit log', ErrorCodes.INTERNAL_ERROR);
    }
  });
}
