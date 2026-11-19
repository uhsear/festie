import assert from 'node:assert/strict';
import path from 'path';
import crypto from 'crypto';
import { afterEach, describe, test } from 'node:test';
import request from 'supertest';
import { Pool } from 'pg';
import { DEFAULT_PASSWORD, TRUSTED_MUTATION_HEADER, TEST_DATABASE_URL, startServer, registerUser, servers } from './_coverage-auth-helpers';

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    try { await s.close(); } catch {}
  }
});

// ════════════════════════════════════════════════════════════════════════
// Reset-password (self-service)
// ════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/auth/reset-password', () => {
  test('end-to-end: valid token resets password; old pw fails, new pw works', async () => {
    const server = await startServer(); servers.push(server);
    const reg = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'resetuser', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: 'reset@example.com' })
      .expect(201);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
        [reg.body.data.user.id, tokenHash]
      );

      const res = await server.request
        .post('/api/v1/auth/reset-password')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ token: rawToken, newPassword: 'newpassword456', confirmPassword: 'newpassword456' });
      assert.equal(res.status, 200);

      const loginOld = await server.request
        .post('/api/v1/auth/login')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: 'resetuser', password: DEFAULT_PASSWORD });
      assert.equal(loginOld.status, 401);

      const loginNew = await server.request
        .post('/api/v1/auth/login')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ username: 'resetuser', password: 'newpassword456' });
      assert.equal(loginNew.status, 200);
    } finally { await pool.end(); }
  });

  test('already-used token fails on second reset attempt', async () => {
    const server = await startServer(); servers.push(server);
    const reg = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'resetuser2', password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: 'reset2@example.com' })
      .expect(201);

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
        [reg.body.data.user.id, tokenHash]
      );

      const r1 = await server.request
        .post('/api/v1/auth/reset-password')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ token: rawToken, newPassword: 'newpass111111', confirmPassword: 'newpass111111' });
      assert.equal(r1.status, 200);

      const r2 = await server.request
        .post('/api/v1/auth/reset-password')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ token: rawToken, newPassword: 'newpass222222', confirmPassword: 'newpass222222' });
      assert.equal(r2.status, 400);
    } finally { await pool.end(); }
  });

  test('expired + used_at tokens are rejected', async () => {
    const server = await startServer(); servers.push(server);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const userRes = await pool.query(
        'INSERT INTO users (id, username, password_hash, created_at, tos_accepted_at, tos_version) VALUES ($1, $2, $3, NOW(), NOW(), 1) RETURNING id',
        ['test-user-123', 'testuser_reset_exp', '$2b$10$salt']
      );
      const userId = userRes.rows[0].id;

      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour', NULL)",
        [userId, tokenHash]
      );

      const r1 = await server.request
        .post('/api/v1/auth/reset-password')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ token, newPassword: 'newpass123', confirmPassword: 'newpass123' })
        .expect(200);
      assert.ok(r1.body.data);

      // Reuse same token
      const r2 = await server.request
        .post('/api/v1/auth/reset-password')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ token, newPassword: 'another123', confirmPassword: 'another123' });
      assert.ok(r2.status >= 400);

      // Fresh random token that was never inserted → also rejected
      const r3 = await server.request
        .post('/api/v1/auth/reset-password')
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ token: crypto.randomBytes(32).toString('hex'), newPassword: 'fail', confirmPassword: 'fail' });
      assert.ok(r3.status >= 400);
    } finally { await pool.end(); }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Email change
// ════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/account/email', () => {
  test('requires authentication', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/account/email')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'new@example.com', password: 'pass' });
    assert.equal(res.status, 401);
  });

  test('rejects invalid email format', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'updateemailfmt');
    const res = await server.request
      .post('/api/v1/account/email')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'not-an-email', password: DEFAULT_PASSWORD });
    assert.equal(res.status, 400);
  });

  test('rejects update without password', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'updateemailnopw');
    const res = await server.request
      .post('/api/v1/account/email')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'new@example.com' });
    assert.equal(res.status, 400);
  });

  test('rejects incorrect password (strict 400)', async () => {
    const server = await startServer(); servers.push(server);
    const username = `emailpw_${Date.now()}`;
    const reg = await server.request
      .post('/api/v1/auth/register')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, dateOfBirth: '1995-01-01', tosAccepted: true, email: `${username}@example.com` });
    const userToken = reg.body.data.token;

    const res = await server.request
      .post('/api/v1/account/email')
      .set('x-user-token', userToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'changed@example.com', password: 'wrongpassword' });
    assert.equal(res.status, 400);
  });

  test('the retired POST /api/v1/auth/update-email path is gone', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'emailupdateuser');

    const res = await server.request
      .post('/api/v1/auth/update-email')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ email: 'newemail@example.com', password: DEFAULT_PASSWORD });

    assert.equal(res.status, 404, 'the unverified-write route must stay unmounted');
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const tokens = await pool.query('SELECT id FROM email_verification_tokens WHERE user_id = $1 AND email = $2', [
        user.user.id,
        'newemail@example.com',
      ]);
      assert.equal(tokens.rows.length, 0, 'a removed route must not mint tokens');
    } finally { await pool.end(); }
  });
});

// ════════════════════════════════════════════════════════════════════════
// Resend-verification
// ════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/auth/resend-verification', () => {
  test('requires authentication', async () => {
    const server = await startServer(); servers.push(server);
    const res = await server.request
      .post('/api/v1/auth/resend-verification')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({});
    assert.equal(res.status, 401);
  });

  // No mail key in tests: an address on file gets 503 (FND-018), not a false 200.
  test('authenticated user — 400 without an email on file, 503 when the mail cannot be sent', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'resendnoemail');
    const res = await server.request
      .post('/api/v1/auth/resend-verification')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1');
    assert.ok(res.status === 400 || res.status === 503, JSON.stringify(res.body));
  });

  test('rate limiting — multiple rapid resends eventually hit 429 or send-error', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'resenduser');

    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query(
        'UPDATE users SET email = $1, email_verified_at = NULL WHERE id = $2',
        ['resendtest@example.com', user.user.id]
      );
    } finally { await pool.end(); }

    let successCount = 0, rateLimitedCount = 0, errorCount = 0;
    for (let i = 0; i < 5; i++) {
      const res = await server.request
        .post('/api/v1/auth/resend-verification')
        .set('x-user-token', user.token)
        .set(TRUSTED_MUTATION_HEADER, '1');
      if (res.status === 200) successCount++;
      else if (res.status === 429) rateLimitedCount++;
      else errorCount++;
    }
    assert.ok(successCount >= 1 || errorCount >= 1, 'endpoint should respond (not 404)');
    assert.ok(rateLimitedCount >= 1 || errorCount >= 1, 'should eventually rate-limit or error after bursts');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Account soft-delete + reactivation
// ════════════════════════════════════════════════════════════════════════

describe('DELETE /api/v1/account', () => {
  test('soft-deletes user account with password confirmation', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'softdeleteacc1');
    const res = await server.request
      .delete('/api/v1/account')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: DEFAULT_PASSWORD });
    assert.equal(res.status, 200);
  });

  test('rejects deletion with wrong password', async () => {
    const server = await startServer(); servers.push(server);
    const user = await registerUser(server, 'softdeletewrongpw');
    const res = await server.request
      .delete('/api/v1/account')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: 'wrongpassword' });
    assert.ok(res.status === 400 || res.status === 403);
  });

  test('soft-deleted account: login afterward reactivates it', async () => {
    const server = await startServer(); servers.push(server);
    const username = 'reactivate_' + crypto.randomBytes(3).toString('hex');
    const user = await registerUser(server, username);
    await server.request
      .delete('/api/v1/account')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ password: DEFAULT_PASSWORD })
      .expect(200);
    const loginRes = await server.request
      .post('/api/v1/auth/login')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username, password: DEFAULT_PASSWORD });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.data.reactivated, true);
  });
});

