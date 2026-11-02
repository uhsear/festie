/**
 * Google and Apple ID token verification (T45). Signature, algorithm, issuer,
 * audience and expiry are checked by jose; any failure is one OAuthTokenError
 * that carries no token or claim values, so it is safe to log.
 */
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type OAuthProvider = 'google' | 'apple';

export interface VerifiedIdToken {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
  nonce: string | null;
  aud: string;
  exp: number;
}

export class OAuthTokenError extends Error {
  /** jose error code such as ERR_JWT_EXPIRED, for logs. Never a claim value. */
  reason: string;
  constructor(reason = 'invalid') {
    super('Provider token invalid');
    this.name = 'OAuthTokenError';
    this.reason = reason;
  }
}

const ISSUERS: Record<OAuthProvider, string[]> = {
  google: ['accounts.google.com', 'https://accounts.google.com'],
  apple: ['https://appleid.apple.com'],
};

// createRemoteJWKSet fetches lazily and caches, so building these at import costs nothing.
const REMOTE_JWKS: Record<OAuthProvider, JWTVerifyGetKey> = {
  google: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
  apple: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
};

// Apple and Google send these as a boolean or as the string "true"/"false".
const isTrue = (v: unknown) => v === true || v === 'true';

export async function verifyIdToken(
  provider: OAuthProvider,
  idToken: string,
  { audiences, jwks }: { audiences: string[]; jwks?: JWTVerifyGetKey },
): Promise<VerifiedIdToken> {
  const accepted = audiences.filter(Boolean);
  if (!ISSUERS[provider] || accepted.length === 0) throw new OAuthTokenError('not-configured');
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks ?? REMOTE_JWKS[provider], {
      algorithms: ['RS256'],
      issuer: ISSUERS[provider],
      audience: accepted,
      clockTolerance: 60,
      requiredClaims: ['sub', 'exp'],
    }));
  } catch (err: any) {
    throw new OAuthTokenError(typeof err?.code === 'string' ? err.code : 'invalid');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new OAuthTokenError('missing-sub');
  const aud = [payload.aud].flat().find((a): a is string => typeof a === 'string' && accepted.includes(a));
  if (!aud) throw new OAuthTokenError('aud');
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: isTrue(payload.email_verified),
    isPrivateEmail: isTrue(payload.is_private_email),
    nonce: typeof payload.nonce === 'string' ? payload.nonce : null,
    aud,
    exp: payload.exp as number,
  };
}

export function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Apple native may put the raw nonce or its SHA-256 hex in the token; accept both.
export function nonceMatches(claim: string | null | undefined, raw: string | null | undefined): boolean {
  if (!claim || !raw) return false;
  return claim === raw || claim === sha256hex(raw);
}
