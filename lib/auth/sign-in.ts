/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Account creation and the sign-in tail shared by the password routes
 * (routes/auth.ts) and provider sign-in (routes/oauth.ts).
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { sendVerificationEmail } from '../email';
import { describeDevice } from '../helpers/device-label';
import type {} from '../types';

export const USERNAME_RULE_MESSAGE = 'Username must be 2-30 characters (letters, numbers, spaces, hyphens, underscores)';

/**
 * Create a new user, link orphan festival profiles, and optionally send
 * a verification email. Returns the created user record.
 *
 * `emailVerified` (provider sign-up, T45): the provider already verified the
 * address, so it is stamped verified and no verification email is sent.
 *
 * Callers are responsible for session creation and HTTP response.
 */
export async function createUserWithProfile(userData: any, deps: any) {
  const { cleanUsername, passwordHash, newUserId, cleanEmail, dateOfBirth, emailVerified = false } = userData;
  const { stores, config, log, invalidateUserCache } = deps;

  // Create user in database
  const user = await stores.users.create({
    id: newUserId,
    username: cleanUsername,
    passwordHash,
    email: cleanEmail || null,
    dateOfBirth: dateOfBirth || null,
    createdAt: new Date().toISOString(),
    tosAcceptedAt: new Date().toISOString(),
    tosVersion: 1,
    ...(emailVerified && cleanEmail ? { emailVerifiedAt: new Date().toISOString() } : {}),
  });
  invalidateUserCache();

  // Auto-link orphan profiles that match the new username (single batch query)
  await stores.profiles.claimOrphanProfiles(user.id, cleanUsername);

  // Send verification email if an unverified email was provided
  if (cleanEmail && !emailVerified) {
    try {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      await stores.pool.query(
        "INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::INTERVAL)",
        [user.id, tokenHash, cleanEmail, config.EMAIL_VERIFY_TOKEN_TTL_HOURS],
      );
      const verifyUrl = `${config.PUBLIC_ORIGIN}/api/v1/auth/verify-email?token=${verifyToken}`;
      await sendVerificationEmail({ to: cleanEmail, username: cleanUsername, verifyUrl, config, log });
    } catch (emailErr: any) {
      log.error('register:verify-email-send-failed', { error: emailErr.message, userId: user.id });
      // Don't fail registration if email send fails
    }
  }

  return user;
}

/**
 * Issue a refresh token for mobile clients and persist it.
 * Returns the raw refresh token string, or null if refresh tokens are disabled.
 */
export async function issueRefreshToken(userId: string, sessionToken: string, deps: any) {
  const { stores, config, createOpaqueId } = deps;
  if (!stores.refreshTokens) return null;
  const { hashSessionToken: hashToken } = deps;
  const refreshToken = createOpaqueId('rt');
  await stores.refreshTokens.create({
    token: hashToken(refreshToken),
    userId,
    sessionToken: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL),
  });
  return refreshToken;
}

// Same native test the token responses use (x-festie-client, or no Origin).
export function deviceOf(req: Request) {
  return describeDevice(req.get('user-agent'), req.get('x-festie-client') === 'native' || !req.get('origin'));
}

/**
 * Username and capacity checks shared by /register and provider sign-up.
 * Returns the error message, or null. The email check runs only when an
 * email is passed.
 */
export async function checkRegistrationConflicts(cleanUsername: string, cleanEmail: string | null, deps: any) {
  const { stores, config } = deps;
  const [existingUser, userCount] = await Promise.all([
    stores.users.getByUsername(cleanUsername),
    stores.users.countActive(),
  ]);
  if (existingUser) return 'Username already taken';
  if (userCount >= config.MAX_USERS) return 'Maximum users reached';

  if (cleanEmail) {
    const emailExists = await stores.pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [cleanEmail],
    );
    if (emailExists.rows.length > 0) return 'Email address already in use';
  }
  return null;
}

/**
 * The shared tail of a successful sign-in (password /login and provider
 * sign-in): reactivate a soft-deleted account, open a session, set the
 * cookie, issue a refresh token and send the user with roles.
 */
export async function finishSignIn(
  req: Request,
  res: Response,
  user: any,
  deps: any,
  { status = 200, extra = {} }: { status?: number; extra?: Record<string, unknown> } = {},
) {
  const { stores, log, invalidateUserCache, createUserSession, setNoStore, setUserSessionCookie } = deps;
  const reactivated = Boolean(user.deletedAt);
  if (reactivated) {
    await stores.users.reactivate(user.id);
    const restoredProfiles = await stores.profiles.restoreByUserId(user.id);
    invalidateUserCache();
    log.info('account:reactivated', { userId: user.id, username: user.username, restoredProfiles });
  }

  const token = await createUserSession(user.id, user.username, deviceOf(req));
  setNoStore(res);
  setUserSessionCookie(res, token);
  const refreshToken = await issueRefreshToken(user.id, token, deps);

  const { serializePublicUser, sendSuccess } = deps;
  const roles = await stores.roles.getUserRoles(user.id);
  // H4: body tokens only for the native bearer client (see register note);
  // the web cookie client relies on the httpOnly cookie set above.
  // Native bearer clients get body tokens; web cookie clients don't. New
  // mobile builds send X-Festie-Client; for backward-compat, a missing
  // Origin header also signals native (RN fetch omits Origin; browsers
  // always send it), so this is safe to deploy before the mobile OTA lands.
  const wantsBodyTokens = req.get('x-festie-client') === 'native' || !req.get('origin');
  res.status(status);
  return sendSuccess(res, {
    ...extra,
    user: serializePublicUser(user),
    ...(wantsBodyTokens ? { token, refreshToken } : {}),
    roles,
    ...(reactivated ? { reactivated: true } : {}),
  });
}
