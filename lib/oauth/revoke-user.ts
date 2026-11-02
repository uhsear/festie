/**
 * Revoke Festie's Apple refresh tokens (T45). Apple requires it when an account
 * is deleted, and Festie also does it when the user unlinks Apple. Best effort:
 * a failure is logged and never blocks the unlink or the delete.
 */
import { open } from './secretbox';

/** Revoke one sealed Apple refresh token. Returns true when Apple accepted it. */
export async function revokeAppleToken(sealed: string, deps: any): Promise<boolean> {
  const { config, log, oauth } = deps;
  try {
    const refreshToken = open(sealed, config.OAUTH_TOKEN_KEY);
    if (await oauth.apple.revoke({ refreshToken, clientId: config.APPLE_BUNDLE_ID })) return true;
    // shortcut: the client id that issued the token is not stored, so a web-issued
    // token (Services ID) needs a second try; add a column if the dual try proves noisy.
    if (!config.APPLE_SERVICES_ID || config.APPLE_SERVICES_ID === config.APPLE_BUNDLE_ID) return false;
    return await oauth.apple.revoke({ refreshToken, clientId: config.APPLE_SERVICES_ID });
  } catch (err) {
    log.warn('oauth:apple-revoke-failed', { status: 0, error: (err as Error)?.name });
    return false;
  }
}

/** Revoke every stored Apple refresh token of a user. Never throws. */
export async function revokeAppleForUser(userId: string, deps: any): Promise<void> {
  try {
    const rows = await deps.stores.identities.appleTokensForUser(userId);
    for (const row of rows) {
      if (!(await revokeAppleToken(row.appleRefreshTokenEnc, deps))) {
        deps.log.warn('oauth:apple-revoke-user-failed', { userId, identityId: row.id });
      }
    }
  } catch (err) {
    deps.log.warn('oauth:apple-revoke-user-failed', { userId, error: (err as Error)?.message });
  }
}
