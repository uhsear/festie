/**
 * Tests: sign-in methods of the signed-in account (T45) — GET/POST/DELETE
 * /identities, POST /set-password, provider re-auth on POST /reauth, and the
 * provider-only paths of account delete, email change and export.
 * A local JWKS stands in for Google's and Apple's keys, and a stub stands in
 * for the Apple REST client, so nothing leaves the machine.
 *
 * The route suites skip-gate on TEST_DATABASE_URL (Docker test DB, port 5433,
 * a *_test database). The revoke-helper suite needs no database.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, describe, test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { Pool } from 'pg';
import request from 'supertest';

import { revokeAppleForUser, revokeAppleToken } from '../lib/oauth/revoke-user';
import { seal } from '../lib/oauth/secretbox';
import { createFestivalPlanner } from '../server';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const PASSWORD = 'identity-test-password-pass';
const GOOGLE_AUD = 'identity-test-web.apps.googleusercontent.com';
const APPLE_AUD = 'us.festie.app';
const TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const RUN = `id${Date.now().toString(36)}`;

let counter = 0;
const uniqueName = (tag: string) => `${RUN}${tag}${++counter}`.slice(0, 30);
const uniqueSubject = () => `${RUN}-sub-${++counter}`;

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;
let keyDir: string;
let keyPath: string;

async function withPool<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

before(async () => {
  if (skip) return;
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] });
  // Apple is enabled only when its key file is readable; the stub client never reads it.
  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-identities-'));
  keyPath = path.join(keyDir, 'AuthKey_TEST.p8');
  fs.writeFileSync(keyPath, 'not a real key\n');
});

after(async () => {
  if (skip) return;
  fs.rmSync(keyDir, { recursive: true, force: true });
  await withPool(async (pool) => {
    const like = [`${RUN}%`];
    const ids = '(SELECT id FROM users WHERE username LIKE $1)';
    await pool.query(`DELETE FROM email_verification_tokens WHERE user_id IN ${ids}`, like);
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id IN ${ids}`, like);
    await pool.query(`DELETE FROM user_sessions WHERE user_id IN ${ids}`, like);
    await pool.query(`DELETE FROM user_roles WHERE user_id IN ${ids}`, like);
    await pool.query('DELETE FROM users WHERE username LIKE $1', like);
  });
});

interface RevokeCall {
  refreshToken: string;
  clientId: string;
}

async function startServer({ configured = true } = {}) {
  const revokeCalls: RevokeCall[] = [];
  const oauthApple = {
    clientSecret: async () => 'stub-secret',
    exchangeCode: async () => 'rt-1',
    revoke: async (args: RevokeCall) => {
      revokeCalls.push(args);
      return true;
    },
  };
  const providerSettings = configured
    ? {
        GOOGLE_WEB_CLIENT_ID: GOOGLE_AUD,
        APPLE_TEAM_ID: 'TEAMTEST01',
        APPLE_SIGNIN_KEY_ID: 'KEYTEST001',
        APPLE_SIGNIN_KEY_PATH: keyPath,
        OAUTH_TOKEN_KEY: TOKEN_KEY,
      }
    : { GOOGLE_WEB_CLIENT_ID: '', APPLE_SIGNIN_KEY_ID: '', APPLE_SIGNIN_KEY_PATH: '', OAUTH_TOKEN_KEY: '' };
  const planner = await (createFestivalPlanner as any)({
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_DIR: fs.existsSync(PUBLIC_DIR) ? PUBLIC_DIR : path.join(import.meta.dirname, '..'),
    NODE_ENV: 'test',
    REDIS_ENABLED: 'false',
    PUBLIC_ORIGIN: '',
    MAX_USERS: 1_000_000,
    AUTH_RATE_LIMIT_MAX: 1000,
    RESEND_API_KEY: '',
    EMAIL_FROM: 'test@example.com',
    GOOGLE_IOS_CLIENT_ID: '',
    GOOGLE_ANDROID_CLIENT_IDS: '',
    APPLE_SERVICES_ID: '',
    ...providerSettings,
    oauthJwks: jwks,
    oauthApple,
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  return { api: request(planner.server), revokeCalls, close: () => planner.close() };
}

type Server = Awaited<ReturnType<typeof startServer>>;
const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close().catch(() => {});
});
async function server(opts?: { configured?: boolean }) {
  const s = await startServer(opts);
  servers.push(s);
  return s;
}

// jti keeps every token unique, so the single-use check sees a new token each time.
function sign(claims: Record<string, unknown>) {
  return new SignJWT({ jti: crypto.randomUUID(), ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);
}
// Google on native carries no nonce (decision 8), which keeps these helpers short.
const googleBody = async (sub: string) => ({
  idToken: await sign({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD, sub }),
});
// Apple always needs a nonce.
async function appleBody(s: Server, sub: string, extra: Record<string, unknown> = {}) {
  const nonceRes = await s.api.post('/api/v1/auth/oauth/nonce').set(TRUSTED_MUTATION_HEADER, '1');
  const nonce = nonceRes.body.data.nonce;
  return { idToken: await sign({ iss: 'https://appleid.apple.com', aud: APPLE_AUD, sub, nonce }), nonce, ...extra };
}

const post = (s: Server, url: string, token: string | null, body: Record<string, unknown> = {}) => {
  const req = s.api.post(url).set(TRUSTED_MUTATION_HEADER, '1').set('x-festie-client', 'native');
  if (token) req.set('x-user-token', token);
  return req.send(body);
};
const del = (s: Server, url: string, token: string, body: Record<string, unknown> = {}) =>
  s.api.delete(url).set(TRUSTED_MUTATION_HEADER, '1').set('x-user-token', token).send(body);
const get = (s: Server, url: string, token: string) => s.api.get(url).set('x-user-token', token);

const link = (s: Server, token: string, provider: string, body: Record<string, unknown>) =>
  post(s, `/api/v1/auth/identities/${provider}`, token, body);
const unlink = (s: Server, token: string, provider: string) => del(s, `/api/v1/auth/identities/${provider}`, token);
const reauth = (s: Server, token: string, body: Record<string, unknown>) =>
  post(s, '/api/v1/auth/reauth', token, body);

async function passwordUser(s: Server) {
  const username = uniqueName('p');
  const res = await post(s, '/api/v1/auth/register', null, {
    username,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    dateOfBirth: '1995-01-01',
    tosAccepted: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { username, token: res.body.data.token as string, userId: res.body.data.user.id as string };
}

/** A provider-only user made through sign-in and finish sign-up. */
async function providerUser(s: Server, provider: 'google' | 'apple' = 'google') {
  const subject = uniqueSubject();
  const body =
    provider === 'google' ? await googleBody(subject) : await appleBody(s, subject, { authorizationCode: 'code-1' });
  const start = await post(s, `/api/v1/auth/oauth/${provider}`, null, body);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.data.status, 'needs-signup');
  const username = uniqueName(provider.slice(0, 1));
  const done = await post(s, '/api/v1/auth/oauth/complete', null, {
    signupToken: start.body.data.signupToken,
    username,
    dateOfBirth: '1995-01-01',
    tosAccepted: true,
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  return { username, subject, token: done.body.data.token as string, userId: done.body.data.user.id as string };
}

async function reauthWith(s: Server, token: string, provider: 'google' | 'apple', subject: string) {
  const body = provider === 'google' ? await googleBody(subject) : await appleBody(s, subject);
  const res = await reauth(s, token, { provider, ...body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

const identityCount = (userId: string) =>
  withPool(
    async (pool) =>
      (await pool.query('SELECT COUNT(*)::int AS n FROM user_identities WHERE user_id = $1', [userId])).rows[0].n,
  );

describe('sign-in methods routes (database)', { skip, concurrency: 1 }, () => {
  test('link needs a recent auth, then links; conflicts are 409', async () => {
    const s = await server();
    const user = await passwordUser(s);
    const subject = uniqueSubject();

    const refused = await link(s, user.token, 'google', await googleBody(subject));
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'REAUTH_REQUIRED');

    await reauth(s, user.token, { password: PASSWORD }).expect(200);
    const linked = await link(s, user.token, 'google', await googleBody(subject));
    assert.equal(linked.status, 201, JSON.stringify(linked.body));
    assert.equal(linked.body.data.provider, 'google');

    const list = await get(s, '/api/v1/auth/identities', user.token);
    assert.equal(list.status, 200);
    assert.equal(list.body.data.hasPassword, true);
    assert.deepEqual(Object.keys(list.body.data.identities[0]).sort(), [
      'createdAt',
      'email',
      'isPrivateEmail',
      'provider',
    ]);

    // The same subject again is idempotent.
    const again = await link(s, user.token, 'google', await googleBody(subject));
    assert.equal(again.status, 200, JSON.stringify(again.body));

    const second = await link(s, user.token, 'google', await googleBody(uniqueSubject()));
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'PROVIDER_ALREADY_LINKED');

    const other = await passwordUser(s);
    await reauth(s, other.token, { password: PASSWORD }).expect(200);
    const stolen = await link(s, other.token, 'google', await googleBody(subject));
    assert.equal(stolen.status, 409);
    assert.equal(stolen.body.error.code, 'IDENTITY_LINKED_ELSEWHERE');
    assert.equal(await identityCount(other.userId), 0);
  });

  test('the last sign-in method stays; set-password adds one', async () => {
    const s = await server();
    const user = await providerUser(s);
    await reauthWith(s, user.token, 'google', user.subject);

    const last = await unlink(s, user.token, 'google');
    assert.equal(last.status, 409);
    assert.equal(last.body.error.code, 'LAST_SIGN_IN_METHOD');
    assert.equal(await identityCount(user.userId), 1);

    const weak = await post(s, '/api/v1/auth/set-password', user.token, {
      newPassword: 'short',
      confirmPassword: 'short',
    });
    assert.equal(weak.status, 400);

    const set = await post(s, '/api/v1/auth/set-password', user.token, {
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const twice = await post(s, '/api/v1/auth/set-password', user.token, {
      newPassword: PASSWORD,
      confirmPassword: PASSWORD,
    });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error.code, 'PASSWORD_ALREADY_SET');

    const login = await post(s, '/api/v1/auth/login', null, { username: user.username, password: PASSWORD });
    assert.equal(login.status, 200, JSON.stringify(login.body));

    const ok = await unlink(s, user.token, 'google');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.data, { unlinked: 'google' });
    const gone = await unlink(s, user.token, 'google');
    assert.equal(gone.status, 404);
  });

  test('set-password refuses a user who has a password, and needs a recent auth', async () => {
    const s = await server();
    const user = await passwordUser(s);
    const body = { newPassword: `${PASSWORD}-2`, confirmPassword: `${PASSWORD}-2` };
    const noAuth = await post(s, '/api/v1/auth/set-password', user.token, body);
    assert.equal(noAuth.status, 403);
    assert.equal(noAuth.body.error.code, 'REAUTH_REQUIRED');
    await reauth(s, user.token, { password: PASSWORD }).expect(200);
    const res = await post(s, '/api/v1/auth/set-password', user.token, body);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PASSWORD_ALREADY_SET');
  });

  test('two identities and no password: unlink one, the second is the last; Apple unlink revokes', async () => {
    const s = await server();
    const user = await providerUser(s);
    await reauthWith(s, user.token, 'google', user.subject);
    const appleSubject = uniqueSubject();
    const linked = await link(s, user.token, 'apple', await appleBody(s, appleSubject, { authorizationCode: 'c-2' }));
    assert.equal(linked.status, 201, JSON.stringify(linked.body));
    const stored = await withPool(
      async (pool) =>
        (
          await pool.query(
            "SELECT apple_refresh_token_enc FROM user_identities WHERE user_id = $1 AND provider = 'apple'",
            [user.userId],
          )
        ).rows[0],
    );
    assert.ok(stored.apple_refresh_token_enc, 'the sealed Apple token is stored');

    const first = await unlink(s, user.token, 'apple');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(s.revokeCalls, [{ refreshToken: 'rt-1', clientId: APPLE_AUD }]);

    const second = await unlink(s, user.token, 'google');
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'LAST_SIGN_IN_METHOD');
  });

  test('two parallel unlinks with no password: exactly one succeeds', async () => {
    const s = await server();
    const user = await providerUser(s);
    await reauthWith(s, user.token, 'google', user.subject);
    const linked = await link(s, user.token, 'apple', await appleBody(s, uniqueSubject()));
    assert.equal(linked.status, 201, JSON.stringify(linked.body));

    const results = await Promise.all([unlink(s, user.token, 'google'), unlink(s, user.token, 'apple')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await identityCount(user.userId), 1);
  });

  test('re-auth with a provider token: linked works, another user is 403, a replay is 401', async () => {
    const s = await server();
    const user = await providerUser(s);
    const other = await providerUser(s);

    const body = await googleBody(user.subject);
    const ok = await reauth(s, user.token, { provider: 'google', ...body });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(new Date(ok.body.data.reauthUntil).getTime() > Date.now());

    const replay = await reauth(s, user.token, { provider: 'google', ...body });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'PROVIDER_TOKEN_INVALID');

    const foreign = await reauth(s, user.token, { provider: 'google', ...(await googleBody(other.subject)) });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.error.code, 'IDENTITY_NOT_LINKED');

    // A provider-only user who sends a password gets the usual refusal.
    const pw = await reauth(s, user.token, { password: PASSWORD });
    assert.equal(pw.status, 403);
    assert.equal(pw.body.error.code, 'PASSWORD_INCORRECT');
  });

  test('provider-only account delete needs a recent auth and revokes Apple', async () => {
    const s = await server();
    const user = await providerUser(s, 'apple');

    const refused = await del(s, '/api/v1/account/', user.token, {});
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'REAUTH_REQUIRED');
    assert.equal(s.revokeCalls.length, 0);

    await reauthWith(s, user.token, 'apple', user.subject);
    const res = await del(s, '/api/v1/account/', user.token, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(s.revokeCalls, [{ refreshToken: 'rt-1', clientId: APPLE_AUD }]);
    // The identity stays, so an Apple sign-in inside the 30 days restores the account.
    assert.equal(await identityCount(user.userId), 1);
  });

  test('a password user still needs the password to delete', async () => {
    const s = await server();
    const user = await passwordUser(s);
    await reauth(s, user.token, { password: PASSWORD }).expect(200);
    const res = await del(s, '/api/v1/account/', user.token, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MISSING_FIELD');
  });

  test('provider-only email change needs a recent auth', async () => {
    const s = await server();
    const user = await providerUser(s);
    const body = { email: `${uniqueName('e')}@example.com` };
    const refused = await post(s, '/api/v1/account/email', user.token, body);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'REAUTH_REQUIRED');

    await reauthWith(s, user.token, 'google', user.subject);
    const ok = await post(s, '/api/v1/account/email', user.token, body);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test('the export lists identities and never the Apple token', async () => {
    const s = await server();
    const user = await providerUser(s, 'apple');
    const res = await get(s, '/api/v1/account/export', user.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { identities } = res.body.data;
    assert.equal(identities.length, 1);
    assert.equal(identities[0].provider, 'apple');
    assert.deepEqual(Object.keys(identities[0]).sort(), ['createdAt', 'email', 'lastUsedAt', 'provider']);
    const text = JSON.stringify(res.body);
    assert.ok(!/apple_refresh_token_enc|appleRefreshTokenEnc|rt-1/.test(text), 'no Apple token in the export');
  });

  test('with no provider configured, the list and set-password work and linking is 404', async () => {
    const s = await server({ configured: false });
    const user = await passwordUser(s);
    const list = await get(s, '/api/v1/auth/identities', user.token);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data, { hasPassword: true, identities: [] });

    await reauth(s, user.token, { password: PASSWORD }).expect(200);
    const res = await link(s, user.token, 'google', await googleBody(uniqueSubject()));
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'PROVIDER_NOT_CONFIGURED');
    const re = await reauth(s, user.token, { provider: 'google', ...(await googleBody(uniqueSubject())) });
    assert.equal(re.status, 404);
    assert.equal(re.body.error.code, 'PROVIDER_NOT_CONFIGURED');
  });
});

describe('Apple revoke helper (no database)', () => {
  const key = crypto.randomBytes(32).toString('base64');
  function deps({ results = [true], servicesId = 'us.festie.web', rows = [] as unknown[] } = {}) {
    const calls: RevokeCall[] = [];
    const warnings: string[] = [];
    let i = 0;
    return {
      calls,
      warnings,
      deps: {
        config: { OAUTH_TOKEN_KEY: key, APPLE_BUNDLE_ID: 'us.festie.app', APPLE_SERVICES_ID: servicesId },
        log: { warn: (msg: string) => warnings.push(msg) },
        oauth: {
          apple: {
            revoke: async (args: RevokeCall) => {
              calls.push(args);
              return results[i++] ?? false;
            },
          },
        },
        stores: {
          identities: {
            appleTokensForUser: async () => {
              if (rows === null) throw new Error('db down');
              return rows;
            },
          },
        },
      },
    };
  }

  test('revokes with the bundle ID first', async () => {
    const d = deps();
    assert.equal(await revokeAppleToken(seal('rt-a', key), d.deps), true);
    assert.deepEqual(d.calls, [{ refreshToken: 'rt-a', clientId: 'us.festie.app' }]);
  });

  test('retries once with the Services ID when the bundle ID fails', async () => {
    const d = deps({ results: [false, true] });
    assert.equal(await revokeAppleToken(seal('rt-b', key), d.deps), true);
    assert.deepEqual(
      d.calls.map((c) => c.clientId),
      ['us.festie.app', 'us.festie.web'],
    );
  });

  test('no Services ID means no second try', async () => {
    const d = deps({ results: [false], servicesId: '' });
    assert.equal(await revokeAppleToken(seal('rt-c', key), d.deps), false);
    assert.equal(d.calls.length, 1);
  });

  test('a token that does not open is logged, not thrown', async () => {
    const d = deps();
    assert.equal(await revokeAppleToken('v1.bad.bad.bad', d.deps), false);
    assert.equal(d.calls.length, 0);
    assert.deepEqual(d.warnings, ['oauth:apple-revoke-failed']);
  });

  test('revokeAppleForUser revokes each stored token and never throws', async () => {
    const d = deps({
      results: [true, true],
      rows: [
        { id: '1', appleRefreshTokenEnc: seal('rt-1', key) },
        { id: '2', appleRefreshTokenEnc: seal('rt-2', key) },
      ],
    });
    await revokeAppleForUser('u1', d.deps);
    assert.deepEqual(
      d.calls.map((c) => c.refreshToken),
      ['rt-1', 'rt-2'],
    );

    const broken = deps({ rows: null as unknown as unknown[] });
    await revokeAppleForUser('u1', broken.deps);
    assert.deepEqual(broken.warnings, ['oauth:apple-revoke-user-failed']);
  });
});
