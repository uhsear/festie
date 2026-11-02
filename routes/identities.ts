/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Sign-in methods of the signed-in account (T45), mounted at /api/v1/auth.
 * GET    /identities            - password set? and the linked Google and Apple accounts
 * POST   /identities/:provider  - link a provider account (recent re-auth)
 * DELETE /identities/:provider  - unlink one, never the last sign-in method (recent re-auth)
 * POST   /set-password          - add a password to a provider-only account (recent re-auth)
 */

import type { Request, Response, Router } from 'express';
import { withTransaction } from '../lib/db/connection';
import type { Identity, IdentityProvider } from '../lib/db/stores/identities';
import { revokeAppleToken } from '../lib/oauth/revoke-user';
import { acceptProviderToken, OAUTH_MESSAGES, ProviderRejection } from '../lib/oauth/accept';
import type {} from '../lib/types';

const MESSAGES = {
  PROVIDER_ALREADY_LINKED: 'You already linked an account from this provider. Unlink it first.',
  LAST_SIGN_IN_METHOD: 'Add another way to sign in before you remove this one.',
  PASSWORD_ALREADY_SET: 'You already have a password. Use Change password instead.',
} as const;

/** The public shape of a linked identity: no subject, no token. */
const publicIdentity = (i: Identity) => ({
  provider: i.provider,
  email: i.email,
  isPrivateEmail: i.isPrivateEmail,
  createdAt: i.createdAt,
});

// Thrown inside the unlink transaction so the delete rolls back.
class LastSignInMethod extends Error {}

export default function createIdentityRoutes(deps: any): Router {
  const {
    express,
    log,
    stores,
    userAuth,
    requireRecentAuth,
    rateLimit,
    validate,
    validateParams,
    schemas,
    sendSuccess,
    sendError,
    ErrorCodes,
    getUserById,
    checkPasswordPolicy,
    hashPassword,
    invalidateUserCache,
    setNoStore,
  } = deps;

  const router = express.Router();

  router.get('/identities', userAuth, rateLimit(60, 'identities'), async (req: Request, res: Response) => {
    try {
      setNoStore(res);
      const user = await getUserById(req.user.userId);
      if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      const identities = await stores.identities.listByUser(user.id);
      return sendSuccess(res, { hasPassword: Boolean(user.passwordHash), identities: identities.map(publicIdentity) });
    } catch (err) {
      log.error('identities list failed', { error: (err as Error).message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to load sign-in methods', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post(
    '/identities/:provider',
    userAuth,
    requireRecentAuth,
    rateLimit(10, 'identity-link'),
    validateParams(schemas.oauthProviderParams),
    validate(schemas.oauthSignIn),
    async (req: Request, res: Response) => {
      const { provider } = req.validatedParams as { provider: IdentityProvider };
      const userId = req.user.userId;
      try {
        setNoStore(res);
        const { claims, appleRefreshTokenEnc } = await acceptProviderToken(provider, req.validatedBody as any, deps);

        // An identity already linked to this user makes the call idempotent.
        const answeredByExisting = async (): Promise<boolean> => {
          const existing = await stores.identities.findBySubject(provider, claims.subject);
          if (!existing) return false;
          if (existing.userId !== userId) {
            sendError(res, 409, OAUTH_MESSAGES.IDENTITY_LINKED_ELSEWHERE, ErrorCodes.IDENTITY_LINKED_ELSEWHERE);
          } else {
            await stores.identities.touch(existing.id, appleRefreshTokenEnc);
            sendSuccess(res, publicIdentity(existing));
          }
          return true;
        };
        if (await answeredByExisting()) return undefined;

        let created: Identity;
        try {
          // The provider email stays on the identity; users.email does not change.
          created = await stores.identities.create({
            userId,
            provider,
            subject: claims.subject,
            email: claims.email ? claims.email.toLowerCase() : null,
            emailVerified: claims.emailVerified,
            isPrivateEmail: claims.isPrivateEmail,
            appleRefreshTokenEnc,
          });
        } catch (err: any) {
          if (err?.code !== '23505') throw err;
          // Either a parallel link of the same subject won, or this user already has the provider.
          if (await answeredByExisting()) return undefined;
          return sendError(res, 409, MESSAGES.PROVIDER_ALREADY_LINKED, ErrorCodes.PROVIDER_ALREADY_LINKED);
        }

        // eslint-disable-next-line require-atomic-updates -- res is request-scoped
        res.locals.auditDetail = { provider, outcome: 'linked' };
        log.info('identity:linked', { userId, provider });
        res.status(201);
        return sendSuccess(res, publicIdentity(created));
      } catch (err) {
        if (err instanceof ProviderRejection) return sendError(res, err.status, err.message, err.code);
        log.error('identity link failed', { error: (err as Error).message, userId, provider });
        return sendError(res, 500, 'Failed to link the account', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.delete(
    '/identities/:provider',
    userAuth,
    requireRecentAuth,
    rateLimit(10, 'identity-unlink'),
    validateParams(schemas.oauthProviderParams),
    async (req: Request, res: Response) => {
      const { provider } = req.validatedParams as { provider: IdentityProvider };
      const userId = req.user.userId;
      try {
        setNoStore(res);
        // The users row lock in countSignInMethods stops two parallel unlinks from both passing.
        const removed = await withTransaction(stores.pool, async (client: any) => {
          const methods = await stores.identities.countSignInMethods(client, userId);
          const row = await stores.identities.deleteForUser(userId, provider, client);
          if (row && methods <= 1) throw new LastSignInMethod();
          return row;
        });
        if (!removed) return sendError(res, 404, 'That account is not linked.', ErrorCodes.NOT_FOUND);

        if (provider === 'apple' && removed.appleRefreshTokenEnc) {
          await revokeAppleToken(removed.appleRefreshTokenEnc, deps);
        }
        // eslint-disable-next-line require-atomic-updates -- res is request-scoped
        res.locals.auditDetail = { provider, outcome: 'unlinked' };
        log.info('identity:unlinked', { userId, provider });
        return sendSuccess(res, { unlinked: provider });
      } catch (err) {
        if (err instanceof LastSignInMethod) {
          return sendError(res, 409, MESSAGES.LAST_SIGN_IN_METHOD, ErrorCodes.LAST_SIGN_IN_METHOD);
        }
        log.error('identity unlink failed', { error: (err as Error).message, userId, provider });
        return sendError(res, 500, 'Failed to unlink the account', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  router.post(
    '/set-password',
    userAuth,
    requireRecentAuth,
    rateLimit(5, 'set-password'),
    validate(schemas.setPassword),
    async (req: Request, res: Response) => {
      try {
        setNoStore(res);
        const { newPassword } = req.validatedBody as any;
        const user = await getUserById(req.user.userId);
        if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        if (user.passwordHash) {
          return sendError(res, 409, MESSAGES.PASSWORD_ALREADY_SET, ErrorCodes.PASSWORD_ALREADY_SET);
        }
        const pwError = checkPasswordPolicy(newPassword, { username: user.username, email: user.email });
        if (pwError) return sendError(res, 400, pwError, ErrorCodes.INVALID_INPUT);

        // Adding a sign-in method revokes nothing, so sessions stay.
        await stores.users.update(user.id, { passwordHash: await hashPassword(newPassword) });
        invalidateUserCache();
        log.info('identity:password-set', { userId: user.id });
        return sendSuccess(res, { success: true });
      } catch (err) {
        log.error('set-password failed', { error: (err as Error).message, userId: req.user.userId });
        return sendError(res, 500, 'Failed to set the password', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
