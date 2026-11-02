import { afterEach, describe, test } from 'node:test';
import { assert, DEFAULT_PASSWORD, startServer } from './_integration-helpers';

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
});
