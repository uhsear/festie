/**
 * Sign in with Apple REST client (T45): the ES256 client_secret, the
 * authorization-code exchange for a refresh token, and token revocation.
 * Both network calls are best effort: they log `oauth:apple-*` with the HTTP
 * status only (never a token) and never throw to the caller.
 */
import fs from 'node:fs';
import { SignJWT, importPKCS8, type CryptoKey } from 'jose';

const APPLE_ORIGIN = 'https://appleid.apple.com';
const TIMEOUT_MS = 8000;

export interface AppleClientConfig {
  APPLE_TEAM_ID: string;
  APPLE_SIGNIN_KEY_ID: string;
  APPLE_SIGNIN_KEY_PATH: string;
}

interface Log {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

export function createAppleClient(config: AppleClientConfig, log: Log) {
  let signingKey: Promise<CryptoKey> | null = null;

  // Read the .p8 file once and cache it; a failed load is retried on the next call.
  function getSigningKey(): Promise<CryptoKey> {
    signingKey ??= Promise.resolve()
      .then(() => importPKCS8(fs.readFileSync(config.APPLE_SIGNIN_KEY_PATH, 'utf8'), 'ES256'))
      .catch((err) => {
        signingKey = null;
        throw err;
      });
    return signingKey;
  }

  async function clientSecret(clientId: string): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: config.APPLE_SIGNIN_KEY_ID })
      .setIssuer(config.APPLE_TEAM_ID)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 300)
      .setAudience(APPLE_ORIGIN)
      .setSubject(clientId)
      .sign(await getSigningKey());
  }

  async function post(path: string, clientId: string, params: Record<string, string>) {
    const body = new URLSearchParams({ client_id: clientId, client_secret: await clientSecret(clientId), ...params });
    return fetch(`${APPLE_ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  /** Exchange an authorization code for Apple's refresh token, or null. */
  async function exchangeCode({
    code,
    clientId,
    redirectUri,
  }: {
    code: string;
    clientId: string;
    redirectUri?: string;
  }): Promise<string | null> {
    try {
      const params: Record<string, string> = { grant_type: 'authorization_code', code };
      if (redirectUri) params.redirect_uri = redirectUri;
      const res = await post('/auth/token', clientId, params);
      if (!res.ok) {
        log.warn('oauth:apple-exchange-failed', { status: res.status });
        return null;
      }
      const data: any = await res.json();
      return typeof data?.refresh_token === 'string' ? data.refresh_token : null;
    } catch (err: any) {
      log.warn('oauth:apple-exchange-failed', { status: 0, error: err?.name });
      return null;
    }
  }

  /** Revoke a refresh token. Apple answers 200 even for a token that is already invalid. */
  async function revoke({ refreshToken, clientId }: { refreshToken: string; clientId: string }): Promise<boolean> {
    try {
      const res = await post('/auth/revoke', clientId, { token: refreshToken, token_type_hint: 'refresh_token' });
      if (!res.ok) log.warn('oauth:apple-revoke-failed', { status: res.status });
      return res.ok;
    } catch (err: any) {
      log.warn('oauth:apple-revoke-failed', { status: 0, error: err?.name });
      return false;
    }
  }

  return { clientSecret, exchangeCode, revoke };
}

export type AppleClient = ReturnType<typeof createAppleClient>;
