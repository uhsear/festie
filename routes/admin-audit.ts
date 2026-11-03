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
  const { enrichAuditEntries } = ctx;

  // ── GET /audit — query audit log with filters ────────────
  router.get('/audit', adminAuth, validateQuery(schemas.adminAuditQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const { actor_id: actorId, action, resource_type: resourceType, cursor, limit, scope, actor, user } = req.validatedQuery;
      const actorType = scope === 'all' ? null : scope;
      const from = req.validatedQuery.from ? new Date(req.validatedQuery.from).toISOString() : null;
      const to = req.validatedQuery.to ? new Date(req.validatedQuery.to).toISOString() : null;

      // Resolve username filters to ids; an unknown name matches nothing.
      const users = actor || user ? await getUsers() : [];
      const idForUsername = (name: string) => {
        const wanted = name.toLowerCase();
        return users.find((u: any) => String(u.username).toLowerCase() === wanted)?.id ?? null;
      };
      let resolvedActorId = actorId || null;
      if (actor) {
        resolvedActorId = idForUsername(actor);
        if (!resolvedActorId) return sendSuccess(res, [], { total: 0, limit, nextCursor: null });
      }
      let targetId = null;
      if (user) {
        targetId = idForUsername(user);
        if (!targetId) return sendSuccess(res, [], { total: 0, limit, nextCursor: null });
      }

      // A comma list matches any item. `festival.*` matches every name that starts with `festival.`;
      // without `.*` the name must match exactly.
      const items = typeof action === 'string' && action ? action.split(',') : [];
      const actions = items.filter((a: string) => !a.endsWith('.*'));
      const actionPrefixes = items.filter((a: string) => a.endsWith('.*')).map((a: string) => a.slice(0, -1));
      const filters = {
        actorId: resolvedActorId,
        actorType,
        actions: actions.length ? actions : null,
        actionPrefixes: actionPrefixes.length ? actionPrefixes : null,
        targetId,
        resourceType: resourceType || null,
        from,
        to,
      };
      const [{ rows, nextCursor }, total] = await Promise.all([
        stores.auditLog.query({ ...filters, limit, cursor: cursor || null }),
        stores.auditLog.count(filters),
      ]);

      return sendSuccess(res, await enrichAuditEntries(rows), { total, limit, nextCursor });
    } catch (error: any) {
      log.error('admin audit query failed', { error: error.message });
      return sendError(res, 500, 'Failed to query audit log', ErrorCodes.INTERNAL_ERROR);
    }
  });
}
