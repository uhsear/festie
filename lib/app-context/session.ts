/**
 * Session management + auth middleware.
 *
 * Extracted from `lib/app-context/index.js`. This module handles:
 *   - Session creation (with concurrent-session eviction via Socket.IO)
 *   - Session validation against the session store
 *   - Session invalidation (logout / password change)
 *   - `resolveUserRequestSession` — combines cookie/token resolution with
 *     session validation
 *   - `userAuth` / `adminAuth` Express middleware
 *
 * The factory receives lazy IO access (`getIO`) rather than a direct
 * reference because Socket.IO is created after the app context. This
 * preserves the existing `_io` lazy-binding pattern from the composer.
 */

import crypto from 'crypto';

import { hashSessionToken } from '../crypto-auth';
import { sanitizeIdentifier } from '../helpers/sanitize';

export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

// Every festival-scoped route names one action here. `role` is the lowest role that may call it and
// `write` marks a change. Only admins pass today: organizations do not exist yet, so the role and
// write fields are not read until organizer access arrives with its per-action predicates.
export const FESTIVAL_ACTIONS = {
  'festival.edit': { role: 'editor', write: true },
  'festival.impact': { role: 'owner', write: false },
  'festival.delete': { role: 'admin', write: true },
  'festival.restore': { role: 'admin', write: true },
  'publish.decide': { role: 'admin', write: true },
  'links.edit': { role: 'editor', write: true },
  'lineup.import': { role: 'editor', write: true },
  'lineup.history': { role: 'viewer', write: false },
  'lineup.drop': { role: 'admin', write: true },
  'map.edit': { role: 'editor', write: true },
  'announcement.manage': { role: 'admin', write: true },
} as const;
export type FestivalAction = keyof typeof FESTIVAL_ACTIONS;

// Gate for a route scoped to one crew. Mount after userAuth and validateParams(crewIdParams). Handlers
// read the caller's membership row (for example `role`) from `req.membership`.
export function crewMembership({ stores, log, sendError, ErrorCodes }: any) {
  return async (req: any, res: any, next: any) => {
    try {
      const crewId = sanitizeIdentifier(req.validatedParams.crewId);
      const membership = await stores.crews.getMember(crewId, req.user.userId);
      if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
      req.membership = membership;
      return next();
    } catch (err: any) {
      log.error('crew membership check failed', { error: err.message, crewId: req.validatedParams?.crewId });
      return sendError(res, 500, 'Failed to verify crew membership', ErrorCodes.INTERNAL_ERROR);
    }
  };
}

/**
 * Build session + auth helpers bound to the supplied deps.
 */
export function createSessionHelpers({
  config,
  stores,
  getIO,
  resolveRequestToken,
  disconnectSocket,
  emitPresence,
  disconnectUserSockets,
  fetchRevocationSockets,
  sendError,
  ErrorCodes,
}: {
  config: any;
  stores: any;
  getIO: any;
  resolveRequestToken: any;
  disconnectSocket: any;
  emitPresence: any;
  disconnectUserSockets: any;
  fetchRevocationSockets: any;
  sendError: any;
  ErrorCodes: any;
}) {
  async function createUserSession(userId: any, username: any, deviceLabel: string | null = null, replaceToken: string | null = null) {
    const token = crypto.randomBytes(32).toString('hex');
    const evictedHashes = await stores.sessions.createUserSession({
      token: hashSessionToken(token),
      userId,
      username,
      createdAt: new Date(),
      lastAccess: new Date(),
      maxPerUser: config.USER_SESSION_MAX,
      deviceLabel,
      replaceToken: replaceToken ? hashSessionToken(replaceToken) : null,
    });
    const io = getIO();
    if (evictedHashes && evictedHashes.length > 0 && io) {
      const hashSet = new Set(evictedHashes);
      const presenceTargets = new Set<any>();
      for (const socket of await fetchRevocationSockets(io)) {
        if (!socket.data?.userSessionToken) continue;
        if (hashSet.has(hashSessionToken(socket.data.userSessionToken))) {
          disconnectSocket(socket, io, presenceTargets);
        }
      }
      for (const festivalId of presenceTargets) emitPresence(festivalId, io);
    }
    return token;
  }

  async function validateUserSession(token: any) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    return stores.sessions.validateUserSession(hashSessionToken(token), config.SESSION_TTL);
  }

  async function invalidateUserSessions(userId: any, exceptToken: any = null) {
    await stores.sessions.deleteUserSessions(userId, exceptToken ? hashSessionToken(exceptToken) : null);
    const io = getIO();
    if (io) await disconnectUserSockets(userId, io, exceptToken);
  }

  async function resolveUserRequestSession(req: any) {
    const { token, source } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);
    const session = await validateUserSession(token);
    if (!session) return null;
    return { token, source, session };
  }

  async function adminAuth(req: any, res: any, next: any) {
    const resolved = await resolveUserRequestSession(req);
    if (!resolved) return sendError(res, 401, 'Please log in', ErrorCodes.AUTH_REQUIRED);
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.user = resolved.session;
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.userToken = resolved.token;
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.userAuthSource = resolved.source;
    const isAdmin = await stores.roles.hasRole(resolved.session.userId, 'admin');
    if (!isAdmin) return sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.isAdmin = true;
    res.setHeader('Vary', 'Cookie');
    return next();
  }

  // Gate for a route scoped to one festival. A non-admin gets adminAuth's 403 on every mount:
  // organizer roles are not granted anywhere yet. The tags let the access-matrix test find it.
  function festivalAccess({ action, param = 'id' }: { action: FestivalAction; param?: string }) {
    if (!FESTIVAL_ACTIONS[action]) throw new Error(`Unknown festival action "${action}"`);
    const guard = (req: any, res: any, next: any) =>
      adminAuth(req, res, () => {
        req.festivalRole = 'admin';
        const raw = req.params[param];
        // Handlers may trust req.festivalId, so it stays unset for an id that fails validation.
        req.festivalId = sanitizeIdentifier(raw, 100) === raw ? raw : undefined;
        return next();
      });
    guard.action = action;
    guard.param = param;
    return guard;
  }

  // True when the session's password was re-entered (POST /auth/reauth) within
  // REAUTH_WINDOW_MS. Reads the reauthAt that validateUserSession loaded.
  function hasRecentAuth(req: any) {
    const reauthAt = req.user?.reauthAt ? new Date(req.user.reauthAt).getTime() : NaN;
    return Number.isFinite(reauthAt) && Date.now() - reauthAt <= REAUTH_WINDOW_MS;
  }

  // Gate for destructive admin actions. Mount after adminAuth/userAuth.
  function requireRecentAuth(req: any, res: any, next: any) {
    if (!hasRecentAuth(req)) {
      return sendError(res, 403, 'Confirm your password to continue.', ErrorCodes.REAUTH_REQUIRED);
    }
    return next();
  }

  async function userAuth(req: any, res: any, next: any) {
    const resolved = await resolveUserRequestSession(req);
    if (!resolved) return sendError(res, 401, 'Please log in', ErrorCodes.AUTH_REQUIRED);
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.user = resolved.session;
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.userToken = resolved.token;
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.userAuthSource = resolved.source;
    res.setHeader('Vary', 'Cookie');
    return next();
  }

  return {
    createUserSession,
    validateUserSession,
    invalidateUserSessions,
    resolveUserRequestSession,
    adminAuth,
    festivalAccess,
    userAuth,
    hasRecentAuth,
    requireRecentAuth,
  };
}
