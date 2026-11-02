/**
 * Integration tests: Sign in with Google and Apple (T45) — GET /providers,
 * POST /oauth/nonce, POST /oauth/:provider and POST /oauth/complete.
 * A local JWKS stands in for Google's and Apple's keys, and a stub stands in
 * for the Apple REST client, so nothing leaves the machine.
 *
 * Skip-gate on TEST_DATABASE_URL (Docker test DB, port 5433, a *_test database).
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

import { open } from '../lib/oauth/secretbox';
import { sha256hex } from '../lib/oauth/verify';
import { createFestivalPlanner } from '../server';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');
const TRUSTED_MUTATION_HEADER = 'x-festie-request';
const PASSWORD = 'oauth-test-password-pass';
const GOOGLE_AUD = 'oauth-test-web.apps.googleusercontent.com';
const APPLE_AUD = 'us.festie.app';
const TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const RUN = `oa${Date.now().toString(36)}`;

let counter = 0;
const uniqueName = (tag: string) => `${RUN}${tag}${++counter}`.slice(0, 30);
const uniqueEmail = (tag: string) => `${uniqueName(tag)}@example.com`;
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
  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-oauth-'));
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

interface AppleCall {
  code: string;
  clientId: string;
  redirectUri?: string;
}

async function startServer({ configured = true } = {}) {
  const appleCalls: AppleCall[] = [];
  const oauthApple = {
    clientSecret: async () => 'stub-secret',
    exchangeCode: async (args: AppleCall) => {
      appleCalls.push(args);
      return 'rt-1';
    },
    revoke: async () => true,
  };
  const providerSettings = configured
    ? {
        GOOGLE_WEB_CLIENT_ID: GOOGLE_AUD,
        GOOGLE_IOS_CLIENT_ID: '',
        GOOGLE_ANDROID_CLIENT_IDS: '',
        APPLE_TEAM_ID: 'TEAMTEST01',
        APPLE_SIGNIN_KEY_ID: 'KEYTEST001',
        APPLE_SIGNIN_KEY_PATH: keyPath,
        APPLE_SERVICES_ID: '',
        OAUTH_TOKEN_KEY: TOKEN_KEY,
      }
    : {
        GOOGLE_WEB_CLIENT_ID: '',
        GOOGLE_IOS_CLIENT_ID: '',
        GOOGLE_ANDROID_CLIENT_IDS: '',
        APPLE_SIGNIN_KEY_ID: '',
        APPLE_SIGNIN_KEY_PATH: '',
        APPLE_SERVICES_ID: '',
        OAUTH_TOKEN_KEY: '',
      };
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
    ...providerSettings,
    oauthJwks: jwks,
    oauthApple,
  });
  await new Promise<void>((resolve) => planner.server.listen(0, '127.0.0.1', resolve));
  const { port } = planner.server.address() as { port: number };
  return {
    api: request(planner.server),
    // A same-host Origin passes the CSRF check and marks a web (cookie) client.
    origin: `http://127.0.0.1:${port}`,
    appleCalls,
    close: () => planner.close(),
  };
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
const googleToken = (claims: Record<string, unknown>) =>
  sign({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD, ...claims });
const appleToken = (claims: Record<string, unknown>) =>
  sign({ iss: 'https://appleid.apple.com', aud: APPLE_AUD, ...claims });

async function getNonce(s: Server): Promise<string> {
  const res = await s.api.post('/api/v1/auth/oauth/nonce').set(TRUSTED_MUTATION_HEADER, '1');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.nonce;
}

function signIn(s: Server, provider: string, body: Record<string, unknown>, { web = false } = {}) {
  const req = s.api.post(`/api/v1/auth/oauth/${provider}`).set(TRUSTED_MUTATION_HEADER, '1');
  if (web) req.set('Origin', s.origin);
  else req.set('x-festie-client', 'native');
  return req.send(body);
}

function complete(s: Server, body: Record<string, unknown>, { web = false } = {}) {
  const req = s.api.post('/api/v1/auth/oauth/complete').set(TRUSTED_MUTATION_HEADER, '1');
  if (web) req.set('Origin', s.origin);
  else req.set('x-festie-client', 'native');
  return req.send({ dateOfBirth: '1995-01-01', tosAccepted: true, ...body });
}

/** Google sign-in with a fresh nonce for a new subject; returns the needs-signup body. */
async function startGoogleSignup(s: Server, claims: Record<string, unknown> = {}) {
  const nonce = await getNonce(s);
  const subject = uniqueSubject();
  const res = await signIn(s, 'google', { idToken: await googleToken({ sub: subject, nonce, ...claims }), nonce });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'needs-signup');
  return { subject, data: res.body.data };
}

const userCount = () => withPool(async (pool) => (await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n);

describe('provider sign-in routes (database)', { skip, concurrency: 1 }, () => {
  test('GET /providers reports nothing, and every POST /oauth/* is 404, when no provider is configured', async () => {
    const s = await server({ configured: false });
    const res = await s.api.get('/api/v1/auth/providers');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { google: null, apple: null });

    const nonceRes = await s.api.post('/api/v1/auth/oauth/nonce').set(TRUSTED_MUTATION_HEADER, '1');
    const nonce = 'unconfigured-nonce';
    const signin = await signIn(s, 'google', { idToken: await googleToken({ sub: uniqueSubject(), nonce }), nonce });
    const done = await complete(s, { signupToken: 'x'.repeat(43), username: uniqueName('n') });
    for (const r of [nonceRes, signin, done]) {
      assert.equal(r.status, 404, JSON.stringify(r.body));
      assert.equal(r.body.error.code, 'PROVIDER_NOT_CONFIGURED');
    }
  });

  test('GET /providers returns the public client IDs and no secret settings', async () => {
    const s = await server();
    const res = await s.api.get('/api/v1/auth/providers');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'public, max-age=300');
    assert.deepEqual(res.body.data.google, { webClientId: GOOGLE_AUD, iosClientId: null });
    assert.ok(res.body.data.apple, 'apple is configured');
    const text = JSON.stringify(res.body);
    for (const secret of ['KEYTEST001', keyPath, TOKEN_KEY, 'TEAMTEST01']) assert.ok(!text.includes(secret), secret);
  });

  test('Google on web: needs-signup, complete, then signed-in for the same subject', async () => {
    const s = await server();
    const email = uniqueEmail('g');
    const { subject, data } = await startGoogleSignup(s, { email, email_verified: true });
    assert.equal(data.email, email);
    assert.match(data.suggestedUsername, /^[A-Za-z0-9_-]{2,30}$/);
    assert.ok(data.signupToken.length >= 20);

    const username = uniqueName('g');
    const done = await complete(s, { signupToken: data.signupToken, username }, { web: true });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.data.emailVerificationSent, false);
    assert.equal(done.body.data.user.username, username);
    assert.equal('token' in done.body.data, false, 'a web client gets no body token');
    assert.equal('refreshToken' in done.body.data, false);
    assert.ok(String(done.headers['set-cookie'] ?? '').length > 0, 'session cookie set');

    const row = await withPool(async (pool) => {
      const user = await pool.query('SELECT id, password_hash, email, email_verified_at FROM users WHERE username = $1', [
        username,
      ]);
      const ids = await pool.query('SELECT provider, subject FROM user_identities WHERE user_id = $1', [user.rows[0].id]);
      return { user: user.rows[0], ids: ids.rows };
    });
    assert.equal(row.user.password_hash, null);
    assert.equal(row.user.email, email);
    assert.notEqual(row.user.email_verified_at, null);
    assert.deepEqual(row.ids, [{ provider: 'google', subject }]);

    // The audit row names the provider and carries no token.
    const requestId = done.headers['x-request-id'];
    let audit: any = null;
    for (let i = 0; i < 20 && !audit; i += 1) {
      audit = await withPool(
        async (pool) =>
          (await pool.query('SELECT details_json FROM audit_log WHERE request_id = $1', [requestId])).rows[0] ?? null,
      );
      if (!audit) await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(audit, 'audit row written');
    assert.equal(audit.details_json.provider, 'google');
    assert.equal(audit.details_json.outcome, 'created');
    assert.ok(!JSON.stringify(audit.details_json).includes(data.signupToken));

    const again = await signIn(s, 'google', { idToken: await googleToken({ sub: subject, email, email_verified: true }) });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.data.status, 'signed-in');
    assert.equal(again.body.data.user.username, username);
    assert.ok(again.body.data.token, 'a native client gets a body token');
    assert.ok(again.body.data.refreshToken);
  });

  test('a replayed ID token or a reused nonce is refused', async () => {
    const s = await server();
    const nonce = await getNonce(s);
    const idToken = await googleToken({ sub: uniqueSubject(), nonce });
    assert.equal((await signIn(s, 'google', { idToken, nonce })).status, 200);
    const replay = await signIn(s, 'google', { idToken, nonce });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'PROVIDER_TOKEN_INVALID');

    const reused = await signIn(s, 'google', { idToken: await googleToken({ sub: uniqueSubject(), nonce }), nonce });
    assert.equal(reused.status, 401);
    assert.equal(reused.body.error.code, 'PROVIDER_TOKEN_INVALID');
  });

  test('Apple needs a nonce claim; Google on native may omit it', async () => {
    const s = await server();
    const apple = await signIn(s, 'apple', { idToken: await appleToken({ sub: uniqueSubject() }) });
    assert.equal(apple.status, 401);
    assert.equal(apple.body.error.code, 'PROVIDER_TOKEN_INVALID');

    const google = await signIn(s, 'google', { idToken: await googleToken({ sub: uniqueSubject() }) });
    assert.equal(google.status, 200, JSON.stringify(google.body));
    assert.equal(google.body.data.status, 'needs-signup');
  });

  test('a provider email that matches an existing account is refused, never merged', async () => {
    const s = await server();
    const email = uniqueEmail('c');
    const reg = await s.api
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        username: uniqueName('c'),
        password: PASSWORD,
        confirmPassword: PASSWORD,
        dateOfBirth: '1995-01-01',
        tosAccepted: true,
        email,
      });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));

    const before = await userCount();
    for (const verified of [true, false]) {
      const subject = uniqueSubject();
      const res = await signIn(s, 'google', {
        idToken: await googleToken({ sub: subject, email: email.toUpperCase(), email_verified: verified }),
      });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'IDENTITY_EMAIL_IN_USE');
      const ids = await withPool(
        async (pool) => (await pool.query('SELECT 1 FROM user_identities WHERE subject = $1', [subject])).rowCount,
      );
      assert.equal(ids, 0);
    }
    assert.equal(await userCount(), before);
  });

  test('an unverified provider email signs up with no email on the account', async () => {
    const s = await server();
    const { data } = await startGoogleSignup(s, { email: uniqueEmail('u'), email_verified: false });
    assert.equal(data.email, null);
    const username = uniqueName('u');
    const done = await complete(s, { signupToken: data.signupToken, username });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.ok(done.body.data.token, 'a native client gets a body token');
    assert.ok(done.body.data.refreshToken);
    const email = await withPool(
      async (pool) => (await pool.query('SELECT email FROM users WHERE username = $1', [username])).rows[0].email,
    );
    assert.equal(email, null);
  });

  test('complete refuses an expired or reused sign-up, a taken name, a minor and missing Terms', async () => {
    const s = await server();
    const taken = uniqueName('t');
    const first = await startGoogleSignup(s);
    assert.equal((await complete(s, { signupToken: first.data.signupToken, username: taken })).status, 201);

    const reused = await complete(s, { signupToken: first.data.signupToken, username: uniqueName('t') });
    assert.equal(reused.status, 400);
    assert.equal(reused.body.error.code, 'SIGNUP_EXPIRED');

    const second = await startGoogleSignup(s);
    const takenRes = await complete(s, { signupToken: second.data.signupToken, username: taken });
    assert.equal(takenRes.status, 400);
    assert.equal(takenRes.body.error.message, 'Username already taken');

    const minor = await complete(s, {
      signupToken: second.data.signupToken,
      username: uniqueName('t'),
      dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01`,
    });
    assert.equal(minor.status, 400);
    const noTerms = await complete(s, { signupToken: second.data.signupToken, username: uniqueName('t'), tosAccepted: false });
    assert.equal(noTerms.status, 400);

    await withPool((pool) =>
      pool.query("UPDATE auth_oauth_states SET expires_at = NOW() - INTERVAL '1 second' WHERE key_hash = $1", [
        sha256hex(second.data.signupToken),
      ]),
    );
    // A fresh server: this is the sixth complete, and the route allows five per window.
    const expired = await complete(await server(), { signupToken: second.data.signupToken, username: uniqueName('t') });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.error.code, 'SIGNUP_EXPIRED');
  });

  test('two sign-ups for the same subject create one account', async () => {
    const s = await server();
    const subject = uniqueSubject();
    const tokens: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const res = await signIn(s, 'google', { idToken: await googleToken({ sub: subject }) });
      assert.equal(res.body.data.status, 'needs-signup');
      tokens.push(res.body.data.signupToken);
    }
    const before = await userCount();
    const results = await Promise.all(
      tokens.map((signupToken) => complete(s, { signupToken, username: uniqueName('r') })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    assert.equal(loser.body.error.code, 'IDENTITY_LINKED_ELSEWHERE');
    assert.equal(await userCount(), before + 1);
  });

  test('a soft-deleted account signs in with its linked provider and is reactivated', async () => {
    const s = await server();
    const username = uniqueName('d');
    const reg = await s.api
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username, password: PASSWORD, confirmPassword: PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const subject = uniqueSubject();
    await withPool((pool) =>
      pool.query("INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', $2)", [
        reg.body.data.user.id,
        subject,
      ]),
    );
    const deleted = await s.api
      .delete('/api/v1/account/')
      .set('x-user-token', reg.body.data.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: PASSWORD });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    const res = await signIn(s, 'google', { idToken: await googleToken({ sub: subject }) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'signed-in');
    assert.equal(res.body.data.reactivated, true);
  });

  test('Apple with an authorization code stores the sealed refresh token', async () => {
    const s = await server();
    const nonce = await getNonce(s);
    const res = await signIn(s, 'apple', {
      idToken: await appleToken({
        sub: uniqueSubject(),
        nonce: sha256hex(nonce),
        email: `${RUN}x${++counter}@privaterelay.appleid.com`,
        email_verified: 'true',
        is_private_email: 'true',
      }),
      nonce,
      authorizationCode: 'code-1',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'needs-signup');
    assert.equal(res.body.data.name, 'Ada Lovelace');
    assert.deepEqual(s.appleCalls, [{ code: 'code-1', clientId: APPLE_AUD, redirectUri: undefined }]);

    const username = uniqueName('a');
    const done = await complete(s, { signupToken: res.body.data.signupToken, username });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    const row = await withPool(
      async (pool) =>
        (
          await pool.query(
            `SELECT u.display_name, i.apple_refresh_token_enc, i.is_private_email
             FROM users u JOIN user_identities i ON i.user_id = u.id WHERE u.username = $1`,
            [username],
          )
        ).rows[0],
    );
    assert.equal(row.display_name, 'Ada Lovelace');
    assert.equal(row.is_private_email, true);
    assert.equal(open(row.apple_refresh_token_enc, TOKEN_KEY), 'rt-1');
  });
});
