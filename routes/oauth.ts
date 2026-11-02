/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Sign in with Google and Apple (T45), mounted at /api/v1/auth.
 * GET  /providers        - public client IDs of the configured providers
 * POST /oauth/nonce      - single-use nonce for the provider sign-in request
 * POST /oauth/complete   - finish a first provider sign-in: username, DOB, Terms
 * POST /oauth/:provider  - sign in with a provider ID token, or start sign-up
 *
 * A provider identity links only by (provider, subject). A provider email that
 * matches an existing account is refused (IDENTITY_EMAIL_IN_USE), never merged:
 * Festie emails are often unverified, so a merge would hand the account to
 * whoever controls the provider account.
 */

import crypto from 'crypto';
import type { Request, Response, Router } from 'express';
import { withTransaction } from '../lib/db/connection';
import type { Identity, IdentityProvider } from '../lib/db/stores/identities';
import {
  checkRegistrationConflicts,
  createUserWithProfile,
  finishSignIn,
  USERNAME_RULE_MESSAGE,
} from '../lib/auth/sign-in';
import { acceptProviderToken, isProviderEnabled, OAUTH_MESSAGES, ProviderRejection } from '../lib/oauth/accept';
import { sha256hex } from '../lib/oauth/verify';
import type {} from '../lib/types';

const NONCE_TTL_SECONDS = 600;
const SIGNUP_TTL_SECONDS = 900;

interface PendingSignup {
  provider: IdentityProvider;
  subject: string;
  email: string | null;
  isPrivateEmail: boolean;
  appleRefreshTokenEnc: string | null;
  name: string | null;
}

/** The public client settings of each configured provider; never a key or secret. */
export function publicProviders(config: any) {
  return {
    google: config.OAUTH_GOOGLE_ENABLED
      ? { webClientId: config.GOOGLE_WEB_CLIENT_ID, iosClientId: config.GOOGLE_IOS_CLIENT_ID || null }
      : null,
    apple: config.OAUTH_APPLE_ENABLED
      ? config.OAUTH_APPLE_WEB_ENABLED
        ? { servicesId: config.APPLE_SERVICES_ID, redirectUri: config.APPLE_WEB_REDIRECT_URI }
        : { servicesId: null, redirectUri: null }
      : null,
  };
}

/** A username suggestion only: the given name, else the email local part. */
export function usernameBase(name: string | null, email: string | null): string {
  const source = name || (email ? email.split('@')[0] : '') || '';
  const base = source.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
  return base.length >= 2 ? base : 'festie-fan';
}

export default function createOAuthRoutes(deps: any): Router {
  const {
    express,
    config,
    log,
    stores,
    rateLimit,
    validate,
    validateParams,
    schemas,
    sendSuccess,
    sendError,
    ErrorCodes,
    sanitizeString,
    validateUsername,
    createOpaqueId,
    getUserById,
    invalidateUserCache,
  } = deps;

  const router = express.Router();

  function sendRejection(res: Response, err: unknown, what: string) {
    if (err instanceof ProviderRejection) return sendError(res, err.status, err.message, err.code);
    log.error(`${what} failed`, { error: (err as Error)?.message });
    return sendError(res, 500, 'Sign-in failed', ErrorCodes.INTERNAL_ERROR);
  }

  async function emailInUse(email: string): Promise<boolean> {
    const { rows } = await stores.pool.query('SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL', [
      email.toLowerCase(),
    ]);
    return rows.length > 0;
  }

  // The identity's user, or the soft-deleted user inside its 30-day window (login reactivates it).
  async function loadIdentityUser(identity: Identity) {
    const active = await getUserById(identity.userId);
    if (active) return active;
    const { rows } = await stores.pool.query(
      "SELECT username FROM users WHERE id = $1 AND deleted_at > NOW() - INTERVAL '30 days'",
      [identity.userId],
    );
    if (!rows[0]) return null;
    const deleted = await stores.users.findDeletedByUsername(rows[0].username);
    return deleted?.id === identity.userId ? deleted : null;
  }

  async function suggestUsername(name: string | null, email: string | null): Promise<string> {
    const base = usernameBase(name, email);
    let candidate = base;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await stores.users.getByUsername(candidate))) return candidate;
      const digits = String(crypto.randomInt(10, 10_000));
      candidate = `${base.slice(0, 30 - digits.length)}${digits}`;
    }
    return candidate;
  }

  // Undo a user created by a sign-up that lost the identity race. Orphan profiles
  // it claimed go back to unclaimed, because festival_profiles.user_id is RESTRICT.
  async function discardUser(userId: string) {
    await withTransaction(stores.pool, async (client: any) => {
      await client.query('UPDATE festival_profiles SET user_id = NULL WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
    });
    invalidateUserCache();
  }

  // Inert until configured: with no provider set, the nonce and sign-up steps answer as /oauth/:provider does.
  function requireAnyProvider(_req: Request, res: Response, next: () => void) {
    if (isProviderEnabled('google', config) || isProviderEnabled('apple', config)) return next();
    return sendError(res, 404, OAUTH_MESSAGES.PROVIDER_NOT_CONFIGURED, ErrorCodes.PROVIDER_NOT_CONFIGURED);
  }

  router.get('/providers', rateLimit(60, 'auth-providers'), (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return sendSuccess(res, publicProviders(config));
  });

  router.post('/oauth/nonce', rateLimit(30, 'oauth-nonce'), requireAnyProvider, async (_req: Request, res: Response) => {
    try {
      const nonce = crypto.randomBytes(32).toString('base64url');
      await stores.identities.putState('nonce', sha256hex(nonce), null, NONCE_TTL_SECONDS);
      res.setHeader('Cache-Control', 'no-store');
      return sendSuccess(res, { nonce });
    } catch (err) {
      return sendRejection(res, err, 'oauth nonce');
    }
  });

  // Registered before /oauth/:provider so 'complete' never reads as a provider.
  router.post(
    '/oauth/complete',
    rateLimit(5, 'oauth-complete'),
    requireAnyProvider,
    validate(schemas.oauthComplete),
    async (req: Request, res: Response) => {
      try {
        const { signupToken, username, dateOfBirth } = req.validatedBody as any;
        // Username checks run before the token is spent, so a taken name can be retried.
        const cleanUsername = sanitizeString(username, 30);
        if (!validateUsername(cleanUsername))
          return sendError(res, 400, USERNAME_RULE_MESSAGE, ErrorCodes.INVALID_INPUT);
        const conflict = await checkRegistrationConflicts(cleanUsername, null, deps);
        if (conflict) {
          const code = conflict === 'Maximum users reached' ? ErrorCodes.MAX_LIMIT_REACHED : ErrorCodes.ALREADY_EXISTS;
          return sendError(res, 400, conflict, code);
        }

        const pending = await stores.identities.takeState('signup', sha256hex(signupToken));
        if (!pending) return sendError(res, 400, OAUTH_MESSAGES.SIGNUP_EXPIRED, ErrorCodes.SIGNUP_EXPIRED);
        const { provider, subject, email, isPrivateEmail, appleRefreshTokenEnc, name } = pending as PendingSignup;
        if (!isProviderEnabled(provider, config))
          return sendError(res, 404, OAUTH_MESSAGES.PROVIDER_NOT_CONFIGURED, ErrorCodes.PROVIDER_NOT_CONFIGURED);

        if (await stores.identities.findBySubject(provider, subject)) {
          return sendError(res, 409, OAUTH_MESSAGES.IDENTITY_LINKED_ELSEWHERE, ErrorCodes.IDENTITY_LINKED_ELSEWHERE);
        }
        if (email && (await emailInUse(email))) {
          return sendError(res, 409, OAUTH_MESSAGES.IDENTITY_EMAIL_IN_USE, ErrorCodes.IDENTITY_EMAIL_IN_USE);
        }

        let user = await createUserWithProfile(
          {
            cleanUsername,
            passwordHash: null,
            newUserId: createOpaqueId('user'),
            cleanEmail: email,
            dateOfBirth,
            emailVerified: Boolean(email),
          },
          deps,
        );
        if (name) {
          user = (await stores.users.update(user.id, { displayName: name })) ?? user;
          invalidateUserCache();
        }

        try {
          await stores.identities.create({
            userId: user.id,
            provider,
            subject,
            email,
            emailVerified: Boolean(email),
            isPrivateEmail,
            appleRefreshTokenEnc,
          });
        } catch (err: any) {
          if (err?.code !== '23505') throw err;
          // A parallel first sign-in for the same subject won the race.
          await discardUser(user.id);
          return sendError(res, 409, OAUTH_MESSAGES.IDENTITY_LINKED_ELSEWHERE, ErrorCodes.IDENTITY_LINKED_ELSEWHERE);
        }

        res.locals.auditDetail = { provider, outcome: 'created' };
        return await finishSignIn(req, res, user, deps, { status: 201, extra: { emailVerificationSent: false } });
      } catch (err) {
        return sendRejection(res, err, 'oauth complete');
      }
    },
  );

  router.post(
    '/oauth/:provider',
    rateLimit(10, 'oauth-signin'),
    validateParams(schemas.oauthProviderParams),
    validate(schemas.oauthSignIn),
    async (req: Request, res: Response) => {
      const { provider } = req.validatedParams as { provider: IdentityProvider };
      try {
        const body = req.validatedBody as any;
        const { claims, appleRefreshTokenEnc } = await acceptProviderToken(provider, body, deps);

        const identity = await stores.identities.findBySubject(provider, claims.subject);
        if (identity) {
          const user = await loadIdentityUser(identity);
          if (!user) throw new ProviderRejection(401, 'PROVIDER_TOKEN_INVALID');
          await stores.identities.touch(identity.id, appleRefreshTokenEnc);
          res.locals.auditDetail = { provider, outcome: 'signed-in' };
          return await finishSignIn(req, res, user, deps, { extra: { status: 'signed-in' } });
        }

        // Never auto-link by email (decision 1), whatever the provider says about it.
        if (claims.email && (await emailInUse(claims.email))) {
          return sendError(res, 409, OAUTH_MESSAGES.IDENTITY_EMAIL_IN_USE, ErrorCodes.IDENTITY_EMAIL_IN_USE);
        }

        const email = claims.emailVerified && claims.email ? claims.email.toLowerCase() : null;
        // Apple sends the name only on the first authorization, never in the token.
        const name =
          sanitizeString([body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ').trim(), 50) || null;
        const signupToken = crypto.randomBytes(32).toString('base64url');
        const pending: PendingSignup = {
          provider,
          subject: claims.subject,
          email,
          isPrivateEmail: claims.isPrivateEmail,
          appleRefreshTokenEnc,
          name,
        };
        await stores.identities.putState('signup', sha256hex(signupToken), pending, SIGNUP_TTL_SECONDS);
        const suggestedUsername = await suggestUsername(body.name?.givenName ?? null, claims.email);

        res.locals.auditDetail = { provider, outcome: 'needs-signup' };
        res.setHeader('Cache-Control', 'no-store');
        return sendSuccess(res, { status: 'needs-signup', signupToken, suggestedUsername, email, name });
      } catch (err) {
        return sendRejection(res, err, 'oauth sign-in');
      }
    },
  );

  return router;
}
