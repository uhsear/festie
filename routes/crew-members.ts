import { Router } from 'express';
import { parseJsonObject } from '../lib/db/connection';
import { logCrewActivity } from '../lib/db/stores/activity';
import { dropLivePosition } from '../lib/live-location-cache.js';
import { evictCrewRoomSockets } from '../lib/presence.js';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { createAdminAuditWriter } from '../lib/audit-middleware.js';

export default function createCrewMemberRoutes(deps: any) {
  const {
    log,
    pool,
    userAuth,
    adminAuth,
    setNoStore,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    stores,
    schemas,
    validate,
    validateQuery,
    validateParams,
    io,
    emitter,
    redis,
    crewNotify,
    getRequestIp,
  } = deps;
  const writeAdminAudit = createAdminAuditWriter({ stores, log, getRequestIp });

  const { resolveCrewOwnership, serializeCrewWithMembers } = deps._crewHelpers;

  const router = Router({ mergeParams: true });

  /**
   * H1: evict a removed user's live socket(s) from the crew room server-side.
   *
   * Socket.IO only drops a socket from a room on disconnect — never on an
   * application-level authz change. So when a member leaves or is kicked, their
   * still-connected socket keeps receiving every location:peer-update and
   * sos:raised broadcast (a cross-tenant privacy leak), and keeps a stamped
   * sharingCrewId it could inject from. Force the socket out of the room, clear
   * its crew/sharing stamps, tell peers to drop its live marker (it may have
   * been sharing over a socket or over HTTP), and tell the evicted client to
   * tear down its crew + SOS UI.
   *
   * Best-effort: a failure here must never fail the HTTP removal (the DB row is
   * already gone). io may be absent in some test/CLI contexts.
   * @param crewId - the crew the user was removed from
   * @param removedUserId - the user whose sockets must leave the room
   * @param reason - 'left' for a voluntary leave, 'kicked' for removal by an owner/admin
   */
  async function evictUserFromCrewRoom(crewId: string, removedUserId: string, reason: 'left' | 'kicked') {
    // A background (HTTP) sharer has no sharing socket, so evict the cached fix
    // and tell peers to drop the marker once, whatever sockets the user holds.
    void dropLivePosition(redis, crewId, removedUserId);
    if (!io || typeof io.in !== 'function') return;
    const room = `crew:${crewId}`;
    try {
      emitter.toRoom(room, 'location:peer-stopped', {
        _v: 1,
        crewId,
        userId: removedUserId,
        reason,
      });
      await evictCrewRoomSockets(io, crewId, removedUserId);
    } catch (error: any) {
      // ERROR, not warn: this is the enforcement half of a revocation. The DB
      // membership row is already gone, but a socket that was not evicted keeps
      // its crew room, so it continues receiving crew broadcasts — including
      // other members' live GPS — until it disconnects. Silence here reads
      // exactly like success, which is the worst property a security control can
      // have. Surfaced loudly so it reaches Sentry and the error-rate alert.
      log.error('crew room eviction FAILED — removed user may still receive crew broadcasts', {
        error: error?.message,
        crewId,
        removedUserId,
        consequence: 'socket not evicted from crew room',
      });
    }
  }

  // ── GET /search-users — Admin: search users for crew add ──────
  router.get(
    '/search-users',
    adminAuth,
    rateLimit(30, 'crew-user-search'),
    validateQuery(schemas.crewUserSearchQuery),
    async (req: any, res: any) => {
      try {
        setNoStore(res);
        const q = (req.validatedQuery.q || '').trim();
        if (!q || q.length < 1) return sendSuccess(res, []);

        // Escape LIKE metacharacters to prevent wildcard injection
        const escaped = q.replace(/[%_\\]/g, '\\$&');

        // Targeted query instead of readAll() + filter
        const { rows: matches } = await pool.query(
          'SELECT id, username FROM users WHERE username ILIKE $1 AND deleted_at IS NULL LIMIT 20',
          [`%${escaped}%`],
        );

        return sendSuccess(res, matches);
      } catch (error: any) {
        log.error('crew user search failed', { error: error.message });
        return sendError(res, 500, 'Failed to search users', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/leave — Leave a crew ────────────────────────
  router.delete(
    '/:crewId/leave',
    userAuth,
    rateLimit(10, 'crew-leave'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const crew = await stores.crews.getById(crewId);
        if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

        const membership = await stores.crews.getMember(crewId, req.user.userId);
        if (!membership) return sendError(res, 403, 'Not a member of this crew', ErrorCodes.FORBIDDEN);

        if (membership.role === 'owner') {
          return sendError(res, 400, 'Transfer ownership before leaving', ErrorCodes.FORBIDDEN);
        }

        await stores.crews.removeMember(crewId, req.user.userId);

        if (emitter) {
          emitter.toCrew(crewId, 'crew:member-left', {
            crewId,
            userId: req.user.userId,
            username: req.user.username,
          });
        }
        await logCrewActivity(deps, { crewId, userId: req.user.userId, type: 'member-left' });
        // H1: force the leaver's still-connected socket(s) out of the crew room
        // so they stop receiving live location/SOS and can't keep injecting.
        await evictUserFromCrewRoom(crewId, req.user.userId, 'left');

        log.info('crew:left', { crewId, userId: req.user.userId });
        return sendSuccess(res, { success: true });
      } catch (error: any) {
        log.error('crew leave failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to leave crew', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/members/:userId — Kick a member (owner only)
  router.delete(
    '/:crewId/members/:userId',
    userAuth,
    rateLimit(10, 'crew-kick'),
    validateParams(schemas.crewIdUserIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        const targetUserId = req.validatedParams.userId;
        if (!crewId) return sendError(res, 400, 'Invalid IDs', ErrorCodes.INVALID_INPUT);

        const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'kick members');
        if (!resolved) return;
        const { crew: kickCrew } = resolved;

        if (targetUserId === req.user.userId) {
          return sendError(res, 400, 'Cannot kick yourself', ErrorCodes.INVALID_INPUT);
        }

        const target = await stores.crews.getMember(crewId, targetUserId);
        if (!target) return sendError(res, 404, 'Member not found', ErrorCodes.NOT_FOUND);

        await stores.crews.removeMember(crewId, targetUserId);

        if (emitter) {
          emitter.toCrew(crewId, 'crew:member-kicked', {
            crewId,
            userId: targetUserId,
          });
        }
        await logCrewActivity(deps, { crewId, userId: targetUserId, type: 'member-kicked' });
        crewNotify?.toUsers({
          crewId,
          crewName: kickCrew.name,
          userIds: [targetUserId],
          kind: 'member',
          text: `You were removed from ${kickCrew.name}.`,
        });
        // H1: force the kicked member's still-connected socket(s) out of the
        // crew room so they stop receiving live location/SOS and can't inject.
        await evictUserFromCrewRoom(crewId, targetUserId, 'kicked');

        log.info('crew:member-kicked', { crewId, targetUserId, byUserId: req.user.userId });
        return sendSuccess(res, { success: true });
      } catch (error: any) {
        log.error('crew kick failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to kick member', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── PUT /:crewId/transfer — Transfer ownership (owner only) ────
  router.put(
    '/:crewId/transfer',
    userAuth,
    rateLimit(5, 'crew-transfer'),
    validateParams(schemas.crewIdParams),
    validate(schemas.crewTransfer),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'transfer');
        if (!resolved) return;

        const targetUserId = sanitizeIdentifier(req.validatedBody.userId, 100);
        if (!targetUserId) return sendError(res, 400, 'Target user ID required', ErrorCodes.MISSING_FIELD);
        if (targetUserId === req.user.userId) return sendError(res, 400, 'Already the owner', ErrorCodes.INVALID_INPUT);

        const target = await stores.crews.getMember(crewId, targetUserId);
        if (!target) return sendError(res, 404, 'Target is not a crew member', ErrorCodes.NOT_FOUND);

        // Use transactional transferOwnership when available; fallback to separate calls
        try {
          if (stores.crews.transferOwnership) {
            await stores.crews.transferOwnership(crewId, req.user.userId, targetUserId);
          } else {
            await stores.crews.updateMemberRole(crewId, targetUserId, 'owner');
            await stores.crews.updateMemberRole(crewId, req.user.userId, 'member');
            await pool.query('UPDATE crews SET created_by = $1, updated_at = NOW() WHERE id = $2', [
              targetUserId,
              crewId,
            ]);
          }
        } catch (err: any) {
          // crews_reform_idem_uidx: the target already owns a reform of the same
          // source crew in this festival.
          if (err?.code === '23505') {
            return sendError(
              res,
              409,
              'That member already runs a copy of this crew for this festival. Pick someone else.',
              ErrorCodes.CONFLICT,
            );
          }
          throw err;
        }

        // Re-read so `owner` in the response and the broadcast is the new owner.
        const crew = (await stores.crews.getById(crewId)) ?? resolved.crew;
        const members = await stores.crews.getMembers(crewId);

        if (emitter) {
          const broadcastData = serializeCrewWithMembers(crew, members, null);
          delete broadcastData.inviteCode;
          emitter.toCrew(crewId, 'crew:updated', broadcastData);
        }

        const newOwner = members.find((m: any) => m.userId === targetUserId);
        await logCrewActivity(deps, {
          crewId,
          userId: req.user.userId,
          type: 'owner-changed',
          detail: newOwner?.name || newOwner?.username || null,
        });

        log.info('crew:ownership-transferred', { crewId, from: req.user.userId, to: targetUserId });
        return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
      } catch (error: any) {
        log.error('crew transfer failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to transfer ownership', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /:crewId/overlap — Get crew pick overlap ───────────────
  router.get(
    '/:crewId/overlap',
    userAuth,
    rateLimit(60, 'crew-overlap'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        setNoStore(res);
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const crew = await stores.crews.getById(crewId);
        if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

        const membership = await stores.crews.getMember(crewId, req.user.userId);
        if (!membership) return sendError(res, 403, 'Not a member of this crew', ErrorCodes.FORBIDDEN);

        const rows = await stores.crews.getCrewPickOverlap(crew.festivalId, crewId);

        // Aggregate picks by setId — use null-prototype object to prevent pollution
        const overlap: any = Object.create(null);
        for (const row of rows) {
          // picks_json is a JSONB column — node-postgres returns it as a JS object
          // (a string only on legacy paths). parseJsonObject handles object, string,
          // and null uniformly; a bare JSON.parse here threw on the object and was
          // swallowed, so overlap silently returned {} in production.
          const picks = parseJsonObject(row.picksJson, {});
          for (const [setId, priority] of Object.entries(picks)) {
            if (typeof setId !== 'string' || setId === '__proto__' || setId === 'constructor' || setId === 'prototype')
              continue;
            if (!overlap[setId]) overlap[setId] = [];
            overlap[setId].push({ userId: row.userId, username: row.username, name: row.name || null, priority });
          }
        }

        return sendSuccess(res, {
          crewId,
          festivalId: crew.festivalId,
          memberCount: rows.length,
          overlap,
        });
      } catch (error: any) {
        log.error('crew overlap failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to get overlap', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/members — Admin: add any user to a crew ─────
  router.post(
    '/:crewId/members',
    adminAuth,
    rateLimit(10, 'crew-add-member'),
    validateParams(schemas.crewIdParams),
    validate(schemas.crewAddMember),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const targetUserId = sanitizeIdentifier(req.validatedBody.userId, 100);
        if (!targetUserId) return sendError(res, 400, 'User ID required', ErrorCodes.MISSING_FIELD);

        const crew = await stores.crews.getById(crewId);
        if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

        const targetUser = await stores.users.getById(targetUserId);
        if (!targetUser) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);

        const existing = await stores.crews.getMember(crewId, targetUserId);
        if (existing) return sendError(res, 400, 'Already a member of this crew', ErrorCodes.ALREADY_EXISTS);

        // Check member cap (fast pre-check; addMember enforces it atomically below).
        const memberCount = await stores.crews.getMemberCount(crewId);
        if (memberCount >= crew.maxMembers) {
          return sendError(res, 400, 'Crew is full', ErrorCodes.MAX_LIMIT_REACHED);
        }

        // Pass the cap so the insert closes the count-then-insert race under a row lock.
        const addResult = await stores.crews.addMember(
          { crewId: crew.id, userId: targetUserId, role: 'member' },
          crew.maxMembers,
        );
        if (addResult === 'full') {
          return sendError(res, 400, 'Crew is full', ErrorCodes.MAX_LIMIT_REACHED);
        }

        await writeAdminAudit(req, res, {
          action: AUDIT_ACTIONS.CREW_MEMBER_ADDED,
          targetType: 'user',
          targetId: targetUserId,
          details: { crewId: crew.id, crewName: crew.name, targetUsername: targetUser.username },
        });

        const members = await stores.crews.getMembers(crew.id);

        if (emitter) {
          emitter.toCrew(crew.id, 'crew:member-joined', {
            crewId: crew.id,
            userId: targetUserId,
            username: targetUser.username,
          });
        }

        log.info('crew:admin-add-member', { crewId: crew.id, targetUserId, byAdmin: req.user.userId });
        return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
      } catch (error: any) {
        log.error('crew admin add member failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to add member', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
