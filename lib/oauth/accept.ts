/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Provider ID token acceptance shared by sign-in (routes/oauth.ts), linking
 * (routes/identities.ts) and provider re-auth (routes/auth.ts).
 */

import type { IdentityProvider } from '../db/stores/identities';
import { seal } from './secretbox';
import { nonceMatches, OAuthTokenError, sha256hex, verifyIdToken, type VerifiedIdToken } from './verify';

export const OAUTH_MESSAGES = {
  PROVIDER_NOT_CONFIGURED: 'This sign-in method is not available.',
  PROVIDER_TOKEN_INVALID: 'That sign-in did not work. Try again.',
  IDENTITY_EMAIL_IN_USE:
    'An account already uses this email. Sign in with your password, then link this provider in Account.',
  IDENTITY_LINKED_ELSEWHERE: 'This account is already linked to a different Festie account.',
  SIGNUP_EXPIRED: 'Sign-up took too long. Start again.',
} as const;

/** A refused provider token; handlers turn it into the matching error response. */
export class ProviderRejection extends Error {
  status: number;
  code: string;
  constructor(status: number, code: 'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_TOKEN_INVALID') {
    super(OAUTH_MESSAGES[code]);
    this.status = status;
    this.code = code;
  }
}

export interface AcceptedProviderToken {
  claims: VerifiedIdToken;
  /** The sealed Apple refresh token, when an authorization code was exchanged. */
  appleRefreshTokenEnc: string | null;
}

interface OAuthBody {
  idToken: string;
  nonce?: string;
  authorizationCode?: string;
}

/** Whether the server settings enable this provider (see lib/config.ts). */
export function isProviderEnabled(provider: IdentityProvider, config: any): boolean {
  return provider === 'google' ? Boolean(config.OAUTH_GOOGLE_ENABLED) : Boolean(config.OAUTH_APPLE_ENABLED);
}

function audiencesFor(provider: IdentityProvider, config: any): string[] {
  const list =
    provider === 'google'
      ? [config.GOOGLE_WEB_CLIENT_ID, config.GOOGLE_IOS_CLIENT_ID, ...(config.GOOGLE_ANDROID_CLIENT_IDS ?? [])]
      : [config.APPLE_BUNDLE_ID, config.APPLE_SERVICES_ID];
  return list.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * Verify a provider ID token for sign-in, sign-up, linking or re-auth.
 * Order: provider enabled, signature and claims, nonce (single use), token
 * single use, then the Apple code exchange. Throws ProviderRejection.
 */
export async function acceptProviderToken(
  provider: IdentityProvider,
  body: OAuthBody,
  deps: any,
): Promise<AcceptedProviderToken> {
  const { config, stores, log, oauth } = deps;
  if (!isProviderEnabled(provider, config)) throw new ProviderRejection(404, 'PROVIDER_NOT_CONFIGURED');
  const invalid = () => new ProviderRejection(401, 'PROVIDER_TOKEN_INVALID');

  let claims: VerifiedIdToken;
  try {
    claims = await verifyIdToken(provider, body.idToken, {
      audiences: audiencesFor(provider, config),
      jwks: oauth?.jwks ?? undefined,
    });
  } catch (err) {
    if (!(err instanceof OAuthTokenError)) throw err;
    log.warn('oauth:token-invalid', { provider, reason: err.reason });
    throw invalid();
  }

  // Google on native has no nonce in the free library (decision 8); single use covers replay.
  if (claims.nonce) {
    if (!body.nonce || !nonceMatches(claims.nonce, body.nonce)) throw invalid();
    if (!(await stores.identities.takeState('nonce', sha256hex(body.nonce)))) throw invalid();
  } else if (provider === 'apple') {
    throw invalid();
  }

  if (!(await stores.identities.markTokenUsed(sha256hex(body.idToken), claims.exp))) throw invalid();

  let appleRefreshTokenEnc: string | null = null;
  if (provider === 'apple' && body.authorizationCode) {
    // A failed exchange is logged by the Apple client; sign-in goes on without a stored token (R6).
    const refreshToken = await oauth.apple.exchangeCode({
      code: body.authorizationCode,
      clientId: claims.aud,
      redirectUri: claims.aud === config.APPLE_SERVICES_ID ? config.APPLE_WEB_REDIRECT_URI : undefined,
    });
    if (refreshToken) appleRefreshTokenEnc = seal(refreshToken, config.OAUTH_TOKEN_KEY);
  }
  return { claims, appleRefreshTokenEnc };
}
