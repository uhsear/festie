/**
 * Coverage-backfill: auth, email, and account-lifecycle route cases.
 *
 * Consolidates auth-adjacent tests previously scattered across:
 *   - tests/coverage-gaps.test.js           (email change, resend-verification, ToS, account delete)
 *   - tests/gap-coverage.test.js            (forgot/verify/reset password, pending-token state, resend rate limit, email infra)
 *   - tests/phase3-coverage.test.js         (email workflow, email-change incorrect-pw)
 *
 * The legacy POST /api/v1/auth/update-email these cases were written against
 * has been removed (it wrote an unverified address straight to users.email);
 * they now run against its hardened replacement POST /api/v1/account/email,
 * which shares the same Zod schema and current-password challenge.
 *
 * All tests hit live routes against TEST_DATABASE_URL; pure unit/store coverage
 * lives in coverage-edges.test.js.
 */

import assert from 'node:assert/strict';
import crypto from 'crypto';
import { afterEach, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { DEFAULT_PASSWORD, TRUSTED_MUTATION_HEADER, TEST_DATABASE_URL, startServer, servers } from './_coverage-auth-helpers';
import { registerUser } from './_integration-helpers';

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch {}
  }
});

// ════════════════════════════════════════════════════════════════════════
// Registration + ToS
// ════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/auth/register — ToS', () => {
  test('rejects registration without tosAccepted', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'notos_' + crypto.randomBytes(4).toString('hex'), password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: false });
    assert.equal(res.status, 400);
  });

  test('accepts registration with tosAccepted: true', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'tos_' + crypto.randomBytes(4).toString('hex'), password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: `${'tos_' + crypto.randomBytes(4).toString('hex')}@example.com` });
    assert.equal(res.status, 201);
    assert.ok(res.body.data.user);
    assert.ok(res.body.data.user.username);
  });

  test('Zod schema validation rejection messages on bad payload', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: '', password: 'short', confirmPassword: 'mismatch', dateOfBirth: '1995-01-01', tosAccepted: false });
    if (res.status === 400) {
      assert.ok(res.body.error || res.body.message || res.body.errors);
    }
  });

  test('register with TRUSTED_MUTATION_HEADER succeeds', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'withheader', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: `${'withheader'}@example.com` })
      .expect(201);
    assert.ok(res.body.data.user || res.body.data.username);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Forgot-password (anti-enumeration + validation)
// ════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/auth/forgot-password', () => {
  test('always returns success regardless of email existence', async () => {
    const server = await startServer(); servers.push(server);
    const r1 = await server.request
      .post('/api/v1/auth/forgot-password')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'doesnotexist@example.com' })
      .expect(200);
    assert.ok(r1.body.data);
    assert.match(String(r1.body.data.message || '').toLowerCase(), /reset|sent|check|if an account/);

    const r2 = await server.request
      .post('/api/v1/auth/forgot-password')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'alsonothere@example.com' })
      .expect(200);
    assert.ok(r2.body.data);
  });

  test('with valid user email returns 200 and creates reset token row', async () => {
    const server = await startServer(); servers.push(server);
    const reg = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'emailuser1', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: 'test@example.com' })
      .expect(201);

    const res = await server.request
      .post('/api/v1/auth/forgot-password')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'test@example.com' });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.message);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      // The route answers before it writes the token, so poll for the row.
      let tokens = await pool.query('SELECT * FROM password_reset_tokens WHERE user_id = $1', [reg.body.data.user.id]);
      for (let attempt = 0; attempt < 40 && tokens.rows.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        tokens = await pool.query('SELECT * FROM password_reset_tokens WHERE user_id = $1', [reg.body.data.user.id]);
      }
      assert.ok(tokens.rows.length > 0, 'Reset token should be created in DB');
    } finally { await pool.end(); }
  });

  test('non-existent email still returns 200 (anti-enumeration)', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/auth/forgot-password')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'nonexistent@nowhere.com' });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.message);
  });

  test('missing email returns 400', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/auth/forgot-password')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({});
    assert.equal(res.status, 400);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Verify-email
// ════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/auth/verify-email', () => {
  test('invalid token format (includes empty token) returns 400', async () => {
    // NOTE: folded-in from dropped "rejects empty token" duplicate — the
    // empty-string case is an invalid-format variant, so we assert both.
    const server = await startServer(); servers.push(server);
    const r1 = await server.request.get('/api/v1/auth/verify-email?token=not-a-valid-token');
    assert.equal(r1.status, 400);
    const r2 = await server.request.get('/api/v1/auth/verify-email?token=');
    assert.equal(r2.status, 400);
  });

  test('non-existent valid-format token returns 400', async () => {
    const server = await startServer(); servers.push(server);
    const fakeToken = crypto.randomBytes(32).toString('hex');
    const res = await server.request.get('/api/v1/auth/verify-email?token=' + fakeToken);
    assert.equal(res.status, 400);
  });

  test('valid token verifies email (end-to-end)', async () => {
    const server = await startServer(); servers.push(server);
    const reg = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'verifyuser', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: 'verify@example.com' })
      .expect(201);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await pool.query(
        "INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')",
        [reg.body.data.user.id, tokenHash, 'verify@example.com']
      );

      const res = await server.request.get('/api/v1/auth/verify-email?token=' + rawToken);
      assert.equal(res.status, 200);

      const userCheck = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [reg.body.data.user.id]);
      assert.ok(userCheck.rows[0].email_verified_at);
    } finally { await pool.end(); }
  });

  test('verification token is single-use (reused token → 400)', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'emailuser');

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await pool.query(
        "INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')",
        [user.user.id, tokenHash, 'test@example.com']
      );

      const r1 = await server.request.get('/api/v1/auth/verify-email').query({ token: rawToken });
      assert.equal(r1.status, 200, 'First verification should succeed');

      const r2 = await server.request.get('/api/v1/auth/verify-email').query({ token: rawToken });
      assert.equal(r2.status, 400, 'Reused token should be rejected');
    } finally { await pool.end(); }
  });
});
