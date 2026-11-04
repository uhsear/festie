import { afterEach, describe, test } from 'node:test';
import crypto from 'crypto';
import { Pool } from 'pg';
import { assert, DEFAULT_PASSWORD, startServer, TEST_DATABASE_URL } from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

async function registerWithEmail(server: any, username: string, email: string) {
  await server.request
    .post('/api/v1/auth/register')
    .send({
      username,
      email,
      password: DEFAULT_PASSWORD,
      confirmPassword: DEFAULT_PASSWORD,
      dateOfBirth: '1995-01-01',
      tosAccepted: true,
    })
    .expect(201);
}

describe('Integration — sign in by email', { concurrency: 1 }, () => {
  test('an email in any case signs in; an unknown email gets the wrong-credentials 401', async () => {
    const server = await startServer();
    servers.push(server);
    await registerWithEmail(server, 'alice', 'alice@example.com');

    const ok = await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'Alice@Example.com', password: DEFAULT_PASSWORD })
      .expect(200);
    assert.equal(ok.body.data.user.username, 'alice');

    const unknownEmail = await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'nobody@example.com', password: DEFAULT_PASSWORD })
      .expect(401);
    const unknownName = await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'nobody', password: DEFAULT_PASSWORD })
      .expect(401);
    assert.equal(unknownEmail.body.error.message, 'Wrong username, email or password.');
    assert.equal(unknownEmail.body.error.code, 'INVALID_CREDENTIALS');
    assert.deepEqual(unknownEmail.body.error, unknownName.body.error);
  });

  test('wrong passwords by email lock the account for username sign-in too', async () => {
    const server = await startServer({ MAX_LOGIN_FAILURES: 5 });
    servers.push(server);
    await registerWithEmail(server, 'bob', 'bob@example.com');

    for (let i = 0; i < 5; i += 1) {
      await server.request
        .post('/api/v1/auth/login')
        .send({ username: 'bob@example.com', password: 'wrong-password-1' })
        .expect(401);
    }

    await server.request
      .post('/api/v1/auth/login')
      .send({ username: 'bob', password: DEFAULT_PASSWORD })
      .expect(423);
  });

  test('failures older than the lockout window stop counting', async () => {
    const server = await startServer({ MAX_LOGIN_FAILURES: 3, LOGIN_LOCKOUT_MS: 1000 });
    servers.push(server);
    await registerWithEmail(server, 'dana', 'dana@example.com');
    const fail = () =>
      server.request.post('/api/v1/auth/login').send({ username: 'dana', password: 'wrong-password-1' }).expect(401);

    await fail();
    await fail();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await fail();
    await fail();

    await server.request.post('/api/v1/auth/login').send({ username: 'dana', password: DEFAULT_PASSWORD }).expect(200);
  });

  test('a successful password reset clears the login failure counter', async () => {
    const server = await startServer({ MAX_LOGIN_FAILURES: 3 });
    servers.push(server);
    await registerWithEmail(server, 'erin', 'erin@example.com');
    for (let i = 0; i < 3; i += 1) {
      await server.request
        .post('/api/v1/auth/login')
        .send({ username: 'erin', password: 'wrong-password-1' })
        .expect(401);
    }
    await server.request.post('/api/v1/auth/login').send({ username: 'erin', password: DEFAULT_PASSWORD }).expect(423);

    const token = crypto.randomBytes(32).toString('hex');
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', ['erin']);
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [rows[0].id, crypto.createHash('sha256').update(token).digest('hex')],
      );
    } finally {
      await pool.end();
    }
    const newPassword = 'Br4ndNew!Passw0rd';
    await server.request
      .post('/api/v1/auth/reset-password')
      .set('x-festie-request', '1')
      .send({ token, newPassword, confirmPassword: newPassword })
      .expect(200);

    await server.request.post('/api/v1/auth/login').send({ username: 'erin', password: newPassword }).expect(200);
  });
});
