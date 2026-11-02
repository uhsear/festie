import { Router } from 'express';
import { randomUUID } from 'crypto';

/**
 * Crew packing board (M2 logistics) — a shared "who's bringing what" checklist.
 * A new crew sub-resource cloning routes/crew-polls.ts exactly: userAuth +
 * getMember gate + rate limit + io.to('crew:'+id).emit + activity log.
 */
export default function createCrewPackingRoutes(deps: any) {
  const {
    log,
    userAuth,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    stores,
    schemas,
    validate,
    validateParams,
    io,
    emitter,
  } = deps;

  const router = Router({ mergeParams: true });

  // ── GET /:crewId/packing ───────────────────────────────────────
  router.get(
    '/:crewId/packing',
    userAuth,
    rateLimit(120, 'crew-packing-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;
        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const items = await stores.crewPacking.listByCrew(crewId);
        return sendSuccess(res, { items });
      } catch (err: any) {
        log.error('get packing error', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to list packing items', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/packing ──────────────────────────────────────
  router.post(
    '/:crewId/packing',
    userAuth,
    rateLimit(30, 'crew-packing-create'),
    validateParams(schemas.crewIdParams),
    validate(schemas.packingCreate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const { label, claimed } = req.validatedBody;
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const count = await stores.crewPacking.countByCrew(crewId);
        if (count >= 200) return sendError(res, 409, 'Max 200 packing items per crew', ErrorCodes.CONFLICT);

        const item = await stores.crewPacking.create({
          id: 'pack-' + randomUUID(),
          crewId,
          createdBy: userId,
          label,
          // brought_by is the claimer's user id, so a claim is always the caller's own.
          broughtBy: claimed === true ? userId : null,
          claimed: claimed === true,
        });

        io.to('crew:' + crewId).emit('crew:packing-created', { crewId, item });
        const activity = { crewId, userId, type: 'packing-created', detail: item.label.slice(0, 100) };
        await stores.activity
          .log(activity)
          .then((id: string) => emitter.crewActivityLogged({ crewId, item: { id, ...activity } }))
          .catch(() => {});
        return sendSuccess(res, { item });
      } catch (err: any) {
        log.error('create packing item error', { error: err.message });
        return sendError(res, 500, 'Failed to add packing item', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/packing/batch ────────────────────────────────
  // Adds a template or pasted list in one write. Labels already on the list,
  // or repeated in the request, are skipped (trimmed, case-insensitive).
  router.post(
    '/:crewId/packing/batch',
    userAuth,
    rateLimit(10, 'crew-packing-batch'),
    validateParams(schemas.crewIdParams),
    validate(schemas.packingBatch),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const current = await stores.crewPacking.listByCrew(crewId);
        const seen = new Set(current.map((i: any) => String(i.label).trim().toLowerCase()));
        const kept: string[] = [];
        for (const raw of req.validatedBody.labels as string[]) {
          const label = raw.trim();
          const key = label.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          kept.push(label);
        }
        if (kept.length === 0) return sendSuccess(res, { items: [] });

        const count = await stores.crewPacking.countByCrew(crewId);
        if (count + kept.length > 200) {
          return sendError(res, 409, 'A crew list can hold 200 items. Remove some first.', ErrorCodes.CONFLICT);
        }

        const items = await stores.crewPacking.createMany(crewId, userId, kept);
        io.to('crew:' + crewId).emit('crew:packing-created', { crewId, items });
        const activity = {
          crewId,
          userId,
          type: 'packing-created',
          detail: `Added ${items.length} ${items.length === 1 ? 'item' : 'items'}`,
        };
        await stores.activity
          .log(activity)
          .then((id: string) => emitter.crewActivityLogged({ crewId, item: { id, ...activity } }))
          .catch(() => {});
        return sendSuccess(res, { items });
      } catch (err: any) {
        log.error('batch packing items error', { error: err.message });
        return sendError(res, 500, 'Failed to add packing items', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── PUT /:crewId/packing/:itemId ───────────────────────────────
  router.put(
    '/:crewId/packing/:itemId',
    userAuth,
    rateLimit(60, 'crew-packing-update'),
    validateParams(schemas.crewIdItemIdParams),
    validate(schemas.packingUpdate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const itemId = sanitizeIdentifier(req.validatedParams.itemId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crewPacking.getById(itemId);
        if (!existing || existing.crew_id !== crewId) {
          return sendError(res, 404, 'Packing item not found', ErrorCodes.NOT_FOUND);
        }

        const body = req.validatedBody;
        const nameOf = async (id: string) => {
          const members = await stores.crews.getMembers(crewId);
          const m = members.find((x: any) => x.userId === id);
          return m?.name || m?.username || 'A former member';
        };
        const holder = existing.claimed && existing.brought_by ? existing.brought_by : null;
        const wantsClaim = body.claimed ?? (body.broughtBy !== undefined ? body.broughtBy !== null : undefined);
        const fields: Record<string, any> = {};
        if (body.label !== undefined) fields.label = body.label;
        let holderAfter = holder;
        if (wantsClaim === true) {
          if (holder && holder !== userId) {
            return sendError(res, 409, `${await nameOf(holder)} is already bringing this.`, ErrorCodes.CONFLICT);
          }
          Object.assign(fields, { claimed: true, broughtBy: userId });
          if (holder !== userId) fields.packed = false;
          holderAfter = userId;
        } else if (wantsClaim === false) {
          if (holder && holder !== userId && membership.role !== 'owner') {
            const name = await nameOf(holder);
            return sendError(
              res,
              403,
              `Only ${name} or the crew owner can take this off their list.`,
              ErrorCodes.FORBIDDEN,
            );
          }
          Object.assign(fields, { claimed: false, broughtBy: null, packed: false });
          holderAfter = null;
        }
        if (body.packed !== undefined) {
          if (holderAfter !== userId) {
            return sendError(res, 403, 'Only the person bringing this can mark it packed.', ErrorCodes.FORBIDDEN);
          }
          fields.packed = body.packed;
        }

        const item = await stores.crewPacking.update(itemId, fields);
        io.to('crew:' + crewId).emit('crew:packing-updated', { crewId, item });
        return sendSuccess(res, { item });
      } catch (err: any) {
        log.error('update packing item error', { error: err.message });
        return sendError(res, 500, 'Failed to update packing item', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/packing/:itemId ────────────────────────────
  router.delete(
    '/:crewId/packing/:itemId',
    userAuth,
    rateLimit(30, 'crew-packing-delete'),
    validateParams(schemas.crewIdItemIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const itemId = sanitizeIdentifier(req.validatedParams.itemId);
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const existing = await stores.crewPacking.getById(itemId);
        if (!existing || existing.crew_id !== crewId) {
          return sendError(res, 404, 'Packing item not found', ErrorCodes.NOT_FOUND);
        }
        if (existing.created_by !== userId && membership.role !== 'owner') {
          return sendError(res, 403, 'Only creator or owner can remove item', ErrorCodes.FORBIDDEN);
        }

        await stores.crewPacking.delete(itemId);
        io.to('crew:' + crewId).emit('crew:packing-deleted', { crewId, itemId });
        return sendSuccess(res, { deleted: true });
      } catch (err: any) {
        log.error('delete packing item error', { error: err.message });
        return sendError(res, 500, 'Failed to remove packing item', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
