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

export type FestivalRole = 'viewer' | 'editor' | 'owner' | 'admin';
const ROLE_RANK: Record<FestivalRole, number> = { viewer: 1, editor: 2, owner: 3, admin: 4 };
type ActionSpec = { role: FestivalRole; write: boolean; activeOnly?: boolean };

// Every festival-scoped route names one action here. `role` is the lowest role that may call it, `write`
// marks a change, and `activeOnly` marks a write that a pending organization may not make even on a draft.
// A platform admin passes every action. A member passes only on the /manage mount (see festivalAccess).
export const FESTIVAL_ACTIONS = {
  'festival.view': { role: 'viewer', write: false },
  'festival.edit': { role: 'editor', write: true },
  'festival.impact': { role: 'owner', write: false },
  'festival.delete': { role: 'owner', write: true },
  'festival.restore': { role: 'admin', write: true },
  'publish.decide': { role: 'admin', write: true },
  'links.edit': { role: 'editor', write: true },
  'lineup.import': { role: 'editor', write: true },
  'lineup.history': { role: 'viewer', write: false },
  'lineup.drop': { role: 'admin', write: true },
  'map.edit': { role: 'editor', write: true, activeOnly: true },
  'announcement.manage': { role: 'admin', write: true },
} as const satisfies Record<string, ActionSpec>;
export type FestivalAction = keyof typeof FESTIVAL_ACTIONS;

// Actions on a body that names an organization instead of a festival (a create).
export const ORG_ACTIONS = {
  'festival.create': { role: 'owner', write: true },
} as const satisfies Record<string, ActionSpec>;
export type OrgAction = keyof typeof ORG_ACTIONS;

type Refusal = { status: number; code: 'FORBIDDEN'; message: string };
export type FestivalAllow = (
  req: any,
  festival: { id: string; organizationId: string | null; publishedAt: Date | null },
  membership: { role: FestivalRole; status: string; verified: boolean; name: string },
) => true | Refusal;

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

  // Sends the 401 and returns null when there is no valid session; otherwise sets req.user and friends.
  async function attachUserSession(req: any, res: any) {
    const resolved = await resolveUserRequestSession(req);
    if (!resolved) {
      sendError(res, 401, 'Please log in', ErrorCodes.AUTH_REQUIRED);
      return null;
    }
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.user = resolved.session;
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.userToken = resolved.token;
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.userAuthSource = resolved.source;
    return resolved;
  }

  async function adminAuth(req: any, res: any, next: any) {
    const resolved = await attachUserSession(req, res);
    if (!resolved) return;
    const isAdmin = await stores.roles.hasRole(resolved.session.userId, 'admin');
    if (!isAdmin) return sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.isAdmin = true;
    res.setHeader('Vary', 'Cookie');
    return next();
  }

  // Only the manage router sets req.organizerMount, and the flag can switch every organizer role off.
  const organizerMountOn = (req: any) => req.organizerMount === true && config.ORGANIZER_PLATFORM_ENABLED === true;

  // Signed-in caller: 'admin', 'member' (a non-admin on the /manage mount), or null after the response went out.
  // A non-admin anywhere else gets adminAuth's 403, so organization roles grant nothing outside /manage.
  async function resolveCaller(req: any, res: any): Promise<'admin' | 'member' | null> {
    const resolved = await attachUserSession(req, res);
    if (!resolved) return null;
    const isAdmin = await stores.roles.hasRole(resolved.session.userId, 'admin');
    if (!isAdmin && !organizerMountOn(req)) {
      sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);
      return null;
    }
    res.setHeader('Vary', 'Cookie');
    if (!isAdmin) return 'member';
    // eslint-disable-next-line require-atomic-updates -- req is request-scoped, not shared
    req.isAdmin = true;
    return 'admin';
  }

  // The role and organization-status rules of a member. Returns the refusal text, or null when allowed.
  function memberRefusal(
    spec: ActionSpec,
    membership: { role: FestivalRole; status: string; name: string },
    published: boolean,
  ): string | null {
    if (ROLE_RANK[membership.role] < ROLE_RANK[spec.role]) {
      if (spec.role === 'owner') return `Only an owner of ${membership.name} can do this.`;
      if (spec.role === 'editor') return `Only an owner or editor of ${membership.name} can do this.`;
      return 'Admin access required';
    }
    if (!spec.write) return null;
    if (membership.status === 'suspended') {
      return "Your organization's access is paused. Your live festivals stay visible to attendees.";
    }
    if (membership.status === 'pending' && (published || spec.activeOnly)) {
      return 'Festie is checking your organization. You can edit drafts now. Live festivals and uploads unlock when we approve you.';
    }
    return null;
  }

  const identifierOf = (raw: unknown) => (typeof raw === 'string' && sanitizeIdentifier(raw, 100) === raw ? raw : undefined);

  /* eslint-disable require-atomic-updates -- both guards write only to req, which is request-scoped, not shared */
  // Gate for a route scoped to one festival. A platform admin passes on every mount. A confirmed member of the
  // festival's organization passes only on the /manage mount, with the role of the action. Anyone else is
  // refused: 403 off /manage, and 404 on it so another tenant's festival looks missing. The tags let the
  // access-matrix test find it. `allow` adds per-route rules that a member must also pass.
  function festivalAccess({ action, param = 'id', allow }: { action: FestivalAction; param?: string; allow?: FestivalAllow }) {
    const spec: ActionSpec = FESTIVAL_ACTIONS[action];
    if (!spec) throw new Error(`Unknown festival action "${action}"`);
    const guard = async (req: any, res: any, next: any) => {
      const caller = await resolveCaller(req, res);
      if (!caller) return;
      const festivalId = identifierOf(req.params[param]);
      if (caller === 'admin') {
        req.festivalRole = 'admin';
        // Handlers may trust req.festivalId, so it stays unset for an id that fails validation.
        req.festivalId = festivalId;
        // Audit rows of an organization's festival carry its id, whoever acts.
        req.organizationId = festivalId ? ((await stores.organizations.festivalAccessRow(festivalId))?.organizationId ?? null) : null;
        return next();
      }
      res.setHeader('Cache-Control', 'private, no-store');
      if (!festivalId) return sendError(res, 400, 'Invalid festival ID', ErrorCodes.INVALID_INPUT);
      const festival = await stores.organizations.festivalAccessRow(festivalId);
      const notFound = () => sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      if (!festival || festival.deletedAt || !festival.organizationId) return notFound();
      const membership = await stores.organizations.membership(req.user.userId, festival.organizationId);
      if (!membership) return notFound();
      const refusal = memberRefusal(spec, membership, !!festival.publishedAt);
      if (refusal) return sendError(res, 403, refusal, ErrorCodes.FORBIDDEN);
      const verdict = allow?.(req, festival, membership);
      if (verdict && verdict !== true) return sendError(res, verdict.status, verdict.message, ErrorCodes[verdict.code]);
      req.festivalId = festivalId;
      req.festival = festival;
      req.festivalRole = membership.role;
      req.organizationId = festival.organizationId;
      req.orgStatus = membership.status;
      req.orgVerified = membership.verified;
      return next();
    };
    guard.action = action;
    guard.param = param;
    return guard;
  }

  // Gate for a route whose body names the organization (a create). Same caller rules as festivalAccess:
  // an admin needs the organization to exist, a member needs a role in it, and a stranger sees 404.
  function orgAccess({ action }: { action: OrgAction }) {
    const spec: ActionSpec = ORG_ACTIONS[action];
    if (!spec) throw new Error(`Unknown organization action "${action}"`);
    const guard = async (req: any, res: any, next: any) => {
      const caller = await resolveCaller(req, res);
      if (!caller) return;
      if (caller === 'member') res.setHeader('Cache-Control', 'private, no-store');
      const organizationId = identifierOf(req.body?.organizationId);
      if (!organizationId) return sendError(res, 400, 'Choose an organization.', ErrorCodes.INVALID_INPUT);
      const notFound = () => sendError(res, 404, 'Organization not found', ErrorCodes.NOT_FOUND);
      if (caller === 'admin') {
        if (!(await stores.organizations.getById(organizationId))) return notFound();
        req.festivalRole = 'admin';
        req.orgStatus = 'active';
      } else {
        const membership = await stores.organizations.membership(req.user.userId, organizationId);
        if (!membership) return notFound();
        const refusal = memberRefusal(spec, membership, false);
        if (refusal) return sendError(res, 403, refusal, ErrorCodes.FORBIDDEN);
        req.festivalRole = membership.role;
        req.orgStatus = membership.status;
        req.orgVerified = membership.verified;
      }
      req.organizationId = organizationId;
      return next();
    };
    guard.orgAction = action;
    return guard;
  }
  /* eslint-enable require-atomic-updates */

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
    const resolved = await attachUserSession(req, res);
    if (!resolved) return;
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
    orgAccess,
    userAuth,
    hasRecentAuth,
    requireRecentAuth,
  };
}
