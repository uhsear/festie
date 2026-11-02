import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';

import { createAppleClient } from '../lib/oauth/apple';
import { nonceMatches, OAuthTokenError, sha256hex, verifyIdToken } from '../lib/oauth/verify';

const GOOGLE_AUD = 'web-client.apps.googleusercontent.com';
const APPLE_AUD = 'us.festie.app';

describe('verifyIdToken', () => {
  let jwks: JWTVerifyGetKey;
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;

  before(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair('RS256')).privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    jwks = createLocalJWKSet({ keys: [jwk] });
  });

  const sign = (claims: Record<string, unknown>, { key = privateKey, exp = '10m' as string | number } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime(exp).sign(key);

  const google = (claims: Record<string, unknown> = {}) =>
    sign({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub: 'g-123', ...claims });

  it('returns the claims of a valid Google token', async () => {
    const token = await google({ email: 'a@b.co', email_verified: true, nonce: 'n'.repeat(20) });
    const result = await verifyIdToken('google', token, { audiences: ['', GOOGLE_AUD, 'ios-client'], jwks });
    assert.equal(result.subject, 'g-123');
    assert.equal(result.email, 'a@b.co');
    assert.equal(result.emailVerified, true);
    assert.equal(result.isPrivateEmail, false);
    assert.equal(result.nonce, 'n'.repeat(20));
    assert.equal(result.aud, GOOGLE_AUD);
    assert.equal(typeof result.exp, 'number');
  });

  it('accepts the bare Google issuer form', async () => {
    const token = await google({ iss: 'accounts.google.com' });
    assert.equal((await verifyIdToken('google', token, { audiences: [GOOGLE_AUD], jwks })).subject, 'g-123');
  });

  it('a missing email reads as null and unverified', async () => {
    const result = await verifyIdToken('google', await google(), { audiences: [GOOGLE_AUD], jwks });
    assert.equal(result.email, null);
    assert.equal(result.emailVerified, false);
    assert.equal(result.nonce, null);
  });

  const rejects = (promise: Promise<unknown>) => assert.rejects(promise, OAuthTokenError);

  it('rejects a wrong audience', async () => {
    await rejects(verifyIdToken('google', await google({ aud: 'someone-else' }), { audiences: [GOOGLE_AUD], jwks }));
  });

  it('rejects when no audience is configured', async () => {
    await rejects(verifyIdToken('google', await google(), { audiences: ['', ''], jwks }));
  });

  it('rejects a wrong issuer', async () => {
    await rejects(
      verifyIdToken('google', await google({ iss: 'https://evil.example' }), { audiences: [GOOGLE_AUD], jwks }),
    );
    // A Google token is not an Apple token.
    await rejects(verifyIdToken('apple', await google({ aud: APPLE_AUD }), { audiences: [APPLE_AUD], jwks }));
  });

  it('rejects an expired token, beyond the 60 s tolerance', async () => {
    const expired = await sign(
      { iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub: 'g-123' },
      { exp: Math.floor(Date.now() / 1000) - 120 },
    );
    await rejects(verifyIdToken('google', expired, { audiences: [GOOGLE_AUD], jwks }));
  });

  it('rejects a token signed by another key', async () => {
    const forged = await sign({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub: 'g-123' }, { key: otherKey });
    await rejects(verifyIdToken('google', forged, { audiences: [GOOGLE_AUD], jwks }));
  });

  it('rejects an alg: none token', async () => {
    const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 600;
    const unsigned = `${enc({ alg: 'none', kid: 'k1' })}.${enc({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub: 'g-123', exp })}.`;
    await rejects(verifyIdToken('google', unsigned, { audiences: [GOOGLE_AUD], jwks }));
  });

  it('rejects a token with no subject', async () => {
    await rejects(verifyIdToken('google', await google({ sub: undefined }), { audiences: [GOOGLE_AUD], jwks }));
  });

  it('normalises Apple string booleans', async () => {
    const apple = (claims: Record<string, unknown>) =>
      sign({
        iss: 'https://appleid.apple.com',
        aud: APPLE_AUD,
        sub: 'a-1',
        email: 'x@privaterelay.appleid.com',
        ...claims,
      });
    const yes = await verifyIdToken('apple', await apple({ email_verified: 'true', is_private_email: 'true' }), {
      audiences: [APPLE_AUD],
      jwks,
    });
    assert.equal(yes.emailVerified, true);
    assert.equal(yes.isPrivateEmail, true);
    const no = await verifyIdToken('apple', await apple({ email_verified: 'false', is_private_email: false }), {
      audiences: [APPLE_AUD],
      jwks,
    });
    assert.equal(no.emailVerified, false);
    assert.equal(no.isPrivateEmail, false);
  });

  it('the error carries no token or claim values', async () => {
    const token = await google({ aud: 'someone-else', email: 'secret@b.co' });
    const err: any = await verifyIdToken('google', token, { audiences: [GOOGLE_AUD], jwks }).catch((e) => e);
    assert.ok(err instanceof OAuthTokenError);
    const text = `${err.message} ${err.reason} ${JSON.stringify(err)}`;
    assert.ok(!text.includes(token) && !text.includes('secret@b.co') && !text.includes('someone-else'));
  });
});

describe('nonceMatches', () => {
  const raw = 'raw-nonce-value-123456';
  it('passes for the raw value and for its SHA-256 hex', () => {
    assert.equal(nonceMatches(raw, raw), true);
    assert.equal(nonceMatches(sha256hex(raw), raw), true);
  });
  it('fails otherwise', () => {
    assert.equal(nonceMatches('other', raw), false);
    assert.equal(nonceMatches(sha256hex('other'), raw), false);
    assert.equal(nonceMatches(null, raw), false);
    assert.equal(nonceMatches(raw, undefined), false);
  });
});

describe('createAppleClient', () => {
  let dir: string;
  let publicKey: CryptoKey;
  const log = { warn: mock.fn() };
  let client: ReturnType<typeof createAppleClient>;

  before(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    publicKey = pair.publicKey;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-apple-'));
    const keyPath = path.join(dir, 'AuthKey_TEST.p8');
    fs.writeFileSync(keyPath, await exportPKCS8(pair.privateKey));
    client = createAppleClient(
      { APPLE_TEAM_ID: 'TEAM123', APPLE_SIGNIN_KEY_ID: 'KEY123', APPLE_SIGNIN_KEY_PATH: keyPath },
      log,
    );
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    mock.restoreAll();
  });

  it('signs an ES256 client secret with Apple’s claims', async () => {
    const secret = await client.clientSecret('us.festie.web');
    assert.deepEqual(decodeProtectedHeader(secret), { alg: 'ES256', kid: 'KEY123' });
    const { payload } = await jwtVerify(secret, publicKey, {
      issuer: 'TEAM123',
      audience: 'https://appleid.apple.com',
    });
    assert.equal(payload.sub, 'us.festie.web');
    assert.equal((payload.exp as number) - (payload.iat as number), 300);
  });

  it('exchanges a code for the refresh token, form-encoded', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ refresh_token: 'rt-1' }));
    const token = await client.exchangeCode({
      code: 'c-1',
      clientId: 'us.festie.web',
      redirectUri: 'https://festie.us/login',
    });
    assert.equal(token, 'rt-1');
    const [url, init] = fetchMock.mock.calls[0]!.arguments as unknown as [string, RequestInit];
    assert.equal(url, 'https://appleid.apple.com/auth/token');
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'c-1');
    assert.equal(body.get('client_id'), 'us.festie.web');
    assert.equal(body.get('redirect_uri'), 'https://festie.us/login');
    assert.ok(body.get('client_secret'));
    fetchMock.mock.restore();
  });

  it('a failed exchange returns null and logs the status only', async () => {
    log.warn.mock.resetCalls();
    const fetchMock = mock.method(
      globalThis,
      'fetch',
      async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
    );
    assert.equal(await client.exchangeCode({ code: 'c-1', clientId: APPLE_AUD }), null);
    assert.deepEqual(log.warn.mock.calls[0]?.arguments, ['oauth:apple-exchange-failed', { status: 400 }]);
    fetchMock.mock.restore();
  });

  it('revoke posts the token hint and never throws', async () => {
    let fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200 }));
    assert.equal(await client.revoke({ refreshToken: 'rt-1', clientId: APPLE_AUD }), true);
    const body = new URLSearchParams(String((fetchMock.mock.calls[0]!.arguments[1] as unknown as RequestInit).body));
    assert.equal(body.get('token'), 'rt-1');
    assert.equal(body.get('token_type_hint'), 'refresh_token');
    fetchMock.mock.restore();

    fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed');
    });
    assert.equal(await client.revoke({ refreshToken: 'rt-1', clientId: APPLE_AUD }), false);
    fetchMock.mock.restore();
  });

  it('an unreadable key file fails safely', async () => {
    const broken = createAppleClient(
      { APPLE_TEAM_ID: 'T', APPLE_SIGNIN_KEY_ID: 'K', APPLE_SIGNIN_KEY_PATH: path.join(dir, 'missing.p8') },
      log,
    );
    assert.equal(await broken.revoke({ refreshToken: 'rt-1', clientId: APPLE_AUD }), false);
    assert.equal(await broken.exchangeCode({ code: 'c', clientId: APPLE_AUD }), null);
  });
});
