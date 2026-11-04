/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Authentication Routes
 * POST /register - Register new user (optional email for verification)
 * POST /verify-token - Get CSRF token for login form
 * POST /login - Authenticate user and set session cookie
 * POST /logout - Invalidate session and clear cookie
 * POST /change-password - Change password (authenticated)
 * POST /reauth - Re-enter the password, or a linked Google or Apple token, to open the 15-minute
 *   window for destructive actions
 * (Email routes split to email-auth.js: forgot-password, verify-email, resend-verification.
 *  The unverified-write POST /update-email was removed; POST /api/v1/account/email replaces it.)
 */

import crypto from 'crypto';
import type { Request, Response, Router } from 'express';
import { REAUTH_WINDOW_MS } from '../lib/app-context/session';
import {
  checkRegistrationConflicts,
  createUserWithProfile,
  deviceOf,
  finishSignIn,
  issueRefreshToken,
  USERNAME_RULE_MESSAGE,
} from '../lib/auth/sign-in';
import { acceptProviderToken, ProviderRejection } from '../lib/oauth/accept';
// Request augmentation (validatedBody, user, userToken, …) now lives centrally
// in lib/types/request.ts. Importing the types barrel pulls in its global
// side-effect so this module sees the augmented Request.
import type {} from '../lib/types';

/**
 * Track a failed login attempt: increment metrics, record per-user failure,
 * and lock the account if the failure threshold is reached.
 */
async function handleLoginFailure(user: any, deps: any) {
  const { stores, config, log, state } = deps;
  if (state?.metrics) {
    state.metrics.authFailures = (state.metrics.authFailures || 0) + 1;
  }
  if (user && stores.loginFailures) {
    // Failures older than the lockout window stop counting.
    const prior = await stores.loginFailures.get(user.id);
    if (prior?.lastFailureAt && Date.now() - new Date(prior.lastFailureAt).getTime() > config.LOGIN_LOCKOUT_MS) {
      await stores.loginFailures.reset(user.id);
    }
    await stores.loginFailures.record(user.id);
    const failures = await stores.loginFailures.get(user.id);
    if (failures && failures.consecutiveFailures >= config.MAX_LOGIN_FAILURES) {
      const lockUntil = new Date(Date.now() + config.LOGIN_LOCKOUT_MS);
      await stores.loginFailures.lock(user.id, lockUntil);
      log.warn('account locked', { userId: user.id, failures: failures.consecutiveFailures });
    }
  }
}

/**
 * Compute the opaque session identifier (SHA-256 of token hash, first 16 hex chars).
 */
function computeSessionOpaqueId(tokenHash: string) {
  return crypto.createHash('sha256').update(tokenHash).digest('hex').slice(0, 16);
}

/**
 * Disconnect sockets belonging to a user whose session token hash matches
 * `targetTokenHash`, emitting a revocation event before disconnecting.
 */
function disconnectSessionSockets(userId: string, targetTokenHash: string, reason: string, deps: any) {
  const { io, hashSessionToken: hashToken } = deps;
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data?.userId === userId) {
      const socketTokenHash = socket.data.userSessionToken ? hashToken(socket.data.userSessionToken) : null;
      if (socketTokenHash === targetTokenHash) {
        socket.emit('session:revoked', { reason });
        socket.disconnect(true);
      }
    }
  }
}

export default function createAuthRoutes(deps: any): Router {
  const {
    express,
    config,
    log,
    sanitizeString,
    validateUsername,
    checkPasswordPolicy,
    hashPassword,
    verifyPassword,
    createUserSession,
    validateUserSession,
    invalidateUserSessions,
    resolveRequestToken,
    setNoStore,
    setUserSessionCookie,
    clearUserSessionCookie,
    userAuth,
    getUserById,
    getUsers: _getUsers,
    disconnectUserSockets,
    createOpaqueId,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    io,
    DUMMY_PASSWORD_HASH,
    schemas,
    validate,
    stores,
    invalidateUserCache,

    _pool,
    _state,
    _hashSessionToken,
    _createAuditLog,
    _getRequestIp,
  } = deps;

  const router = express.Router();

  async function validateRegistrationInput(body: any) {
    const { username, password, confirmPassword, email: rawEmail } = body;
    const cleanUsername = sanitizeString(username, 30);
    if (!validateUsername(cleanUsername)) {
      return { error: USERNAME_RULE_MESSAGE };
    }
    const pwError = checkPasswordPolicy(password, { username: cleanUsername, email: rawEmail });
    if (pwError) {
      return { error: pwError };
    }
    if (password !== confirmPassword) {
      return { error: 'Passwords do not match' };
    }
    return { cleanUsername, cleanEmail: rawEmail ? String(rawEmail).trim().toLowerCase() : null };
  }

  // Anonymous ?ref= sign-up count (migration 070): a day and a ref, nothing that
  // identifies the person. A counting failure is logged and never fails sign-up.
  async function countSignupRef(ref: string | undefined) {
    if (!ref) return;
    try {
      await stores.pool.query(
        `INSERT INTO signup_ref_counts (day, ref, signups) VALUES (CURRENT_DATE, $1, 1)
         ON CONFLICT (day, ref) DO UPDATE SET signups = signup_ref_counts.signups + 1`,
        [ref],
      );
    } catch (error: any) {
      log.warn('signup ref count failed', { error: error.message });
    }
  }

  router.post(
    '/register',
    rateLimit(5, 'register', { keyFromBody: (req: any) => req.body?.username }),
    validate(schemas.register),
    async (req: Request, res: Response) => {
      try {
        const validated = await validateRegistrationInput(req.validatedBody as any);
        if (validated.error) return sendError(res, 400, validated.error, ErrorCodes.INVALID_INPUT);
        const { cleanUsername, cleanEmail } = validated;

        const conflict = await checkRegistrationConflicts(cleanUsername!, cleanEmail!, deps);
        if (conflict) {
          const code = conflict === 'Maximum users reached' ? ErrorCodes.MAX_LIMIT_REACHED : ErrorCodes.ALREADY_EXISTS;
          return sendError(res, 400, conflict, code);
        }

        const passwordHash = await hashPassword((req.validatedBody as any).password);
        const newUserId = createOpaqueId('user');
        const dateOfBirth = (req.validatedBody as any).dateOfBirth;
        const user = await createUserWithProfile({ cleanUsername, passwordHash, newUserId, cleanEmail, dateOfBirth }, deps);
        await countSignupRef((req.validatedBody as any).ref);

        const token = await createUserSession(user.id, user.username, deviceOf(req));
        setNoStore(res);
        setUserSessionCookie(res, token);
        const refreshToken = await issueRefreshToken(user.id, token, deps);

        const { serializePublicUser } = deps;
        const _roles = await stores.roles.getUserRoles(user.id);
        res.status(201);
        // H4: only the native (bearer-mode) client receives the session +
        // refresh tokens in the body — it has no cookie jar and authenticates
        // with the Authorization header. The web (cookie-mode) client gets the
        // httpOnly cookie set above and must NOT receive a replayable token in
        // the body. The mobile shared api-layer flags itself via X-Festie-Client.
        // Native bearer clients get body tokens; web cookie clients don't. New
        // mobile builds send X-Festie-Client; for backward-compat, a missing
        // Origin header also signals native (RN fetch omits Origin; browsers
        // always send it), so this is safe to deploy before the mobile OTA lands.
        const wantsBodyTokens = req.get('x-festie-client') === 'native' || !req.get('origin');
        return sendSuccess(res, {
          user: serializePublicUser(user),
          ...(wantsBodyTokens ? { token, refreshToken } : {}),
          emailVerificationSent: !!cleanEmail,
        });
      } catch (error: any) {
        // getByUsername skips accounts in their deletion window, but the unique
        // index still holds the name (and a concurrent sign-up can race the check).
        if (error?.code === '23505') {
          const email = String(error.constraint ?? '').includes('email');
          return sendError(res, 409, email ? 'Email address already in use' : 'That username is taken.', ErrorCodes.ALREADY_EXISTS);
        }
        log.error('register failed', { error: error.message });
        return sendError(res, 500, 'Registration failed', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Usernames cannot contain '@', so an '@' means sign-in by email. An active
  // account wins; otherwise a soft-deleted one inside its 30-day window.
  async function resolveLoginUser(username: string) {
    const ident = String(username).trim();
    if (ident.includes('@')) {
      const email = ident.toLowerCase();
      return (await stores.users.getByEmail(email)) ?? stores.users.findDeletedByEmail(email);
    }
    return (await stores.users.getByUsername(ident)) ?? stores.users.findDeletedByUsername(ident);
  }

  async function checkAccountLockout(user: any, res: Response) {
    if (!user) return false;
    const failures = await stores.loginFailures?.get(user.id);
    if (failures?.lockedUntil && new Date() < new Date(failures.lockedUntil)) {
      const retryAfterSec = Math.ceil((new Date(failures.lockedUntil).getTime() - new Date().getTime()) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      sendError(res, 423, 'Account temporarily locked due to too many failed attempts', ErrorCodes.ACCOUNT_LOCKED);
      return true;
    }
    return false;
  }

  router.post('/login', rateLimit(10, 'login', { keyFromBody: (req: any) => req.body?.username }), validate(schemas.login), async (req: Request, res: Response) => {
    try {
      const { username, password } = req.validatedBody as any;
      if (!username || !password) {
        return sendError(res, 400, 'Username and password required', ErrorCodes.MISSING_FIELD);
      }
      const user = await resolveLoginUser(username);

      if (await checkAccountLockout(user, res)) return;

      if (user && !deps.consumeUserAuthRateLimit(user.id, config.AUTH_RATE_LIMIT_MAX)) {
        const jitter = 100 + Math.floor(Math.random() * 100);
        return setTimeout(
          () => sendError(res, 429, 'Too many login attempts for this account', ErrorCodes.RATE_LIMITED),
          jitter,
        );
      }

      const passwordValid = await verifyPassword(String(password), user?.passwordHash || DUMMY_PASSWORD_HASH);
      if (!user || !passwordValid) {
        await handleLoginFailure(user, deps);
        const jitter = 500 + Math.floor(Math.random() * 1000);
        log.warn('authentication failed', { username: user ? user.username : 'unknown', ip: req.ip });
        return setTimeout(
          () => sendError(res, 401, 'Wrong username, email or password.', ErrorCodes.INVALID_CREDENTIALS),
          jitter,
        );
      }

      if (stores.loginFailures) await stores.loginFailures.reset(user.id);

      return await finishSignIn(req, res, user, deps);
    } catch (error: any) {
      log.error('login failed', { error: error.message });
      return sendError(res, 500, 'Login failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/verify', rateLimit(30, 'verify-token'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const { token } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);
      const session = await validateUserSession(token);
      if (!session) return sendError(res, 401, 'Invalid or expired session', ErrorCodes.AUTH_REQUIRED);
      const user = await getUserById(session.userId);
      if (!user) return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
      const { serializePublicUser, stores: depStores } = deps;
      const roles = await depStores.roles.getUserRoles(session.userId);
      return sendSuccess(res, { valid: true, user: serializePublicUser(user), roles });
    } catch (error: any) {
      log.error('verify failed', { error: error.message });
      return sendError(res, 500, 'Verify failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // GET /me — mobile-friendly current user endpoint (same as verify but GET)
  router.get('/me', userAuth, rateLimit(120, 'get-me'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
      const { serializePublicUser, stores: depStores } = deps;
      const profiles = depStores.profiles.getByUserId
        ? await depStores.profiles.getByUserId(req.user.userId)
        : (await deps.getProfiles()).filter((p: any) => p.userId === req.user.userId);
      const roles = await depStores.roles.getUserRoles(req.user.userId);
      const pendingEmail = await depStores.emailTokens.getPendingEmailChange(user.id, user.email ?? null);
      return sendSuccess(res, {
        user: serializePublicUser(user),
        roles,
        festivals: profiles.map((p: any) => ({ festivalId: p.festivalId, profileId: p.id })),
        pendingEmail,
      });
    } catch (error: any) {
      log.error('get user failed', { error: error.message });
      return sendError(res, 500, 'Failed to get user info', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/logout', rateLimit(10, 'logout'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const { token } = resolveRequestToken(req, 'x-user-token', config.USER_SESSION_COOKIE);

      const { hashSessionToken } = deps;
      if (token) {
        await stores.sessions.deleteUserSession(hashSessionToken(token));
        const disconnectSessionTokens = deps.disconnectSessionTokens;
        disconnectSessionTokens([token], io);
      }
      clearUserSessionCookie(res);
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      log.error('logout failed', { error: error.message });
      return sendError(res, 500, 'Logout failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // Token refresh — exchange a valid session for a fresh token (mobile apps)
  router.post('/refresh', userAuth, rateLimit(20, 'session-refresh'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      // Invalidate the old session, issue a new one
      const { stores: storesRef, hashSessionToken: hashToken, disconnectSessionTokens } = deps;
      if (req.userToken) {
        await storesRef.sessions.deleteUserSession(hashToken(req.userToken));
        // Disconnect sockets still using the old token to prevent stale connections
        disconnectSessionTokens([req.userToken], io);
      }
      const token = await createUserSession(req.user.userId, req.user.username, deviceOf(req));
      setUserSessionCookie(res, token);
      const { serializePublicUser } = deps;
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
      // H4: native bearer client gets the new token in the body (no cookie jar);
      // web cookie client relies on the refreshed httpOnly cookie set above.
      // Native bearer clients get body tokens; web cookie clients don't. New
      // mobile builds send X-Festie-Client; for backward-compat, a missing
      // Origin header also signals native (RN fetch omits Origin; browsers
      // always send it), so this is safe to deploy before the mobile OTA lands.
      const wantsBodyTokens = req.get('x-festie-client') === 'native' || !req.get('origin');
      return sendSuccess(res, { user: serializePublicUser(user), ...(wantsBodyTokens ? { token } : {}) });
    } catch (error: any) {
      log.error('token refresh failed', { error: error.message });
      return sendError(res, 500, 'Token refresh failed', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /refresh-token — exchange refresh token for new session + new refresh token ──
  router.post(
    '/refresh-token',
    rateLimit(20, 'refresh-token'),
    validate(schemas.refreshToken),
    async (req: Request, res: Response) => {
      try {
        setNoStore(res);
        const { refreshToken: incomingRefreshToken } = req.validatedBody as any;
        if (!stores.refreshTokens) {
          return sendError(res, 501, 'Refresh tokens not supported', ErrorCodes.INTERNAL_ERROR);
        }

        const { hashSessionToken: hashToken } = deps;
        const hashedToken = hashToken(incomingRefreshToken);
        const stored = await stores.refreshTokens.validate(hashedToken);
        if (!stored) {
          return sendError(res, 401, 'Invalid or expired refresh token', ErrorCodes.TOKEN_EXPIRED);
        }

        // Spend the old token atomically before minting anything: of two
        // concurrent calls with one token, only one wins the claim.
        const claimed = await stores.refreshTokens.claim(hashedToken);
        if (!claimed) {
          log.warn('auth:refresh-race', { userId: stored.userId });
          return sendError(res, 401, 'Invalid or expired refresh token', ErrorCodes.TOKEN_EXPIRED);
        }

        const user = await getUserById(claimed.userId);
        if (!user) {
          return sendError(res, 401, 'User not found', ErrorCodes.AUTH_REQUIRED);
        }

        // Issue new session token
        const newSessionToken = await createUserSession(user.id, user.username, deviceOf(req));
        setUserSessionCookie(res, newSessionToken);

        const newRefreshToken = createOpaqueId('rt');
        await stores.refreshTokens.create({
          token: hashToken(newRefreshToken),
          userId: user.id,
          sessionToken: hashToken(newSessionToken),
          expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL),
        });

        const { serializePublicUser } = deps;
        const _roles = await stores.roles.getUserRoles(user.id);
        // H4: body tokens only for the native bearer client; the web cookie
        // client gets the rotated httpOnly cookie set above.
        // Native bearer clients get body tokens; web cookie clients don't. New
        // mobile builds send X-Festie-Client; for backward-compat, a missing
        // Origin header also signals native (RN fetch omits Origin; browsers
        // always send it), so this is safe to deploy before the mobile OTA lands.
        const wantsBodyTokens = req.get('x-festie-client') === 'native' || !req.get('origin');
        return sendSuccess(res, {
          user: serializePublicUser(user),
          ...(wantsBodyTokens ? { token: newSessionToken, refreshToken: newRefreshToken } : {}),
        });
      } catch (error: any) {
        log.error('refresh-token failed', { error: error.message });
        return sendError(res, 500, 'Token refresh failed', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /sessions — list active sessions for current user ─────────────
  // Session management: Justified. Users need control over active sessions for security on shared devices.
  // Especially important for festival-goer accounts which may be accessed by friends.
  router.get('/sessions', userAuth, rateLimit(60, 'get-sessions'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);

      const { hashSessionToken: hashToken } = deps;
      const sessions = await stores.sessions.listUserSessions(req.user.userId);
      const currentTokenHash = req.userToken ? hashToken(req.userToken) : null;
      const items = sessions.map((s: any) => ({
        id: computeSessionOpaqueId(s.token),
        createdAt: new Date(s.createdAt).toISOString(),
        lastAccess: new Date(s.lastAccess).toISOString(),
        current: s.token === currentTokenHash,
        device: s.deviceLabel ?? null,
      }));
      return sendSuccess(res, items);
    } catch (error: any) {
      log.error('list sessions failed', { error: error.message });
      return sendError(res, 500, 'Failed to list sessions', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /sessions/:id — revoke a specific session ──────────────────
  router.delete('/sessions/:id', userAuth, rateLimit(10, 'del-session'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);

      const { hashSessionToken: hashToken } = deps;
      const sessionId = req.params.id as string;
      if (!sessionId || sessionId.length !== 16 || !/^[a-f0-9]+$/i.test(sessionId)) {
        return sendError(res, 400, 'Invalid session ID', ErrorCodes.INVALID_INPUT);
      }

      const sessions = await stores.sessions.listUserSessions(req.user.userId);
      const target = sessions.find((s: any) => computeSessionOpaqueId(s.token) === sessionId);
      if (!target) return sendError(res, 404, 'Session not found', ErrorCodes.NOT_FOUND);

      const currentTokenHash = req.userToken ? hashToken(req.userToken) : null;
      if (target.token === currentTokenHash) {
        return sendError(res, 400, 'Cannot revoke current session. Use /logout instead.', ErrorCodes.INVALID_INPUT);
      }

      await stores.sessions.deleteUserSession(target.token);
      disconnectSessionSockets(req.user.userId, target.token, 'Session revoked by user', deps);

      log.info('session:revoked', { userId: req.user.userId, sessionId });
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      log.error('revoke session failed', { error: error.message });
      return sendError(res, 500, 'Failed to revoke session', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /sessions — revoke all sessions except current ─────────────
  router.delete('/sessions', userAuth, rateLimit(5, 'del-all-sessions'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const { hashSessionToken: hashToken } = deps;
      const currentTokenHash = req.userToken ? hashToken(req.userToken) : null;

      // Notify other sockets before invalidateUserSessions disconnects them (it spares the current session)
      for (const [, socket] of io.sockets.sockets) {
        if (socket.data?.userId === req.user.userId) {
          const socketTokenHash = socket.data.userSessionToken ? hashToken(socket.data.userSessionToken) : null;
          if (socketTokenHash !== currentTokenHash) {
            socket.emit('session:revoked', { reason: 'All other sessions revoked' });
          }
        }
      }
      await invalidateUserSessions(req.user.userId, req.userToken);

      log.info('sessions:revoke-all', { userId: req.user.userId });
      return sendSuccess(res, { success: true });
    } catch (error: any) {
      log.error('revoke all sessions failed', { error: error.message });
      return sendError(res, 500, 'Failed to revoke sessions', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post(
    '/change-password',
    userAuth,
    rateLimit(5, 'change-password'),
    validate(schemas.changePassword),
    async (req: Request, res: Response) => {
      try {
        const { currentPassword, newPassword, confirmPassword } = req.validatedBody as any;
        if (!currentPassword || !newPassword || !confirmPassword) {
          return sendError(res, 400, 'Current and new password required', ErrorCodes.MISSING_FIELD);
        }
        const pwError = checkPasswordPolicy(newPassword, { username: req.user?.username });
        if (pwError) {
          return sendError(res, 400, pwError, ErrorCodes.INVALID_INPUT);
        }
        if (newPassword !== confirmPassword) {
          return sendError(res, 400, 'New passwords do not match', ErrorCodes.INVALID_INPUT);
        }

        // Hash new password outside the write lock to minimize lock time
        const newPasswordHash = await hashPassword(newPassword);

        // Verify current password first
        const user = await getUserById(req.user.userId);
        if (!user) {
          return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        }
        if (!(await verifyPassword(currentPassword, user.passwordHash))) {
          return sendError(res, 400, 'Your current password is not correct.', ErrorCodes.PASSWORD_INCORRECT);
        }

        // Update password in database
        await stores.users.update(req.user.userId, { passwordHash: newPasswordHash });
        invalidateUserCache();
        // Invalidate all existing sessions immediately after password change
        // to close the window where old sessions remain valid
        await invalidateUserSessions(req.user.userId);
        // Also revoke long-lived refresh tokens so a held token chain cannot
        // mint new sessions after the credential change (H2).
        if (stores.refreshTokens) await stores.refreshTokens.revokeAll(req.user.userId);
        // The email-change security notice tells the owner to change their
        // password. That advice only works if it also revokes the pending
        // change link the attacker minted, so do it here beside the other
        // revocations. `user.email` is spared so an unclicked signup or resend
        // token for the address already on file survives.
        await stores.emailTokens.invalidatePendingEmailChanges(req.user.userId, user.email ?? null);
        disconnectUserSockets(req.user.userId, io);
        const token = await createUserSession(req.user.userId, req.user.username, deviceOf(req));
        setNoStore(res);
        setUserSessionCookie(res, token);
        // H4: body token only for the native bearer client (see login).
        const wantsBodyTokens = req.get('x-festie-client') === 'native' || !req.get('origin');
        return sendSuccess(res, { success: true, ...(wantsBodyTokens ? { token } : {}) });
      } catch (error: any) {
        log.error('change-password failed', { error: error.message });
        return sendError(res, 500, 'Failed to change password', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // Stamp the current session as freshly re-authenticated. requireRecentAuth
  // (lib/app-context/session.ts) lets destructive admin actions through for
  // the next 15 minutes. A rotated session token starts without the stamp.
  router.post(
    '/reauth',
    userAuth,
    rateLimit(5, 'reauth'),
    validate(schemas.reauth),
    async (req: Request, res: Response) => {
      try {
        const body = req.validatedBody as any;
        const user = await getUserById(req.user.userId);
        if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        if ('provider' in body) {
          // A fresh token from a Google or Apple account linked to this user (T45).
          const { claims } = await acceptProviderToken(body.provider, body, deps);
          const identity = await stores.identities.findBySubject(body.provider, claims.subject);
          if (identity?.userId !== user.id) {
            return sendError(res, 403, 'That account is not linked to you.', ErrorCodes.IDENTITY_NOT_LINKED);
          }
        } else if (!(await verifyPassword(body.password, user.passwordHash))) {
          // A provider-only user has no password hash and lands here too.
          return sendError(res, 403, 'That password is not right. Try again.', ErrorCodes.PASSWORD_INCORRECT);
        }
        const { hashSessionToken: hashToken } = deps;
        await stores.sessions.markReauthenticated(hashToken(req.userToken));
        setNoStore(res);
        return sendSuccess(res, { reauthUntil: new Date(Date.now() + REAUTH_WINDOW_MS).toISOString() });
      } catch (error: any) {
        if (error instanceof ProviderRejection) return sendError(res, error.status, error.message, error.code);
        log.error('reauth failed', { error: error.message });
        return sendError(res, 500, 'Failed to confirm password', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
