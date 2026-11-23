import { afterEach, describe, test } from 'node:test';
import { assert, startServer, registerUser, TRUSTED_MUTATION_HEADER } from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

// Postgres cannot store U+0000. Each route class below used to answer a retryable 500 (SEC-NUL-500).
describe('Integration — NUL bytes answer 400, not 500', { concurrency: 1 }, () => {
  test('an unauthenticated GET path param', async () => {
    const server = await startServer();
    servers.push(server);
    for (const path of ['/api/v1/ratings/festival/ab%00cd/all', '/api/v1/festivals/locate-set/a%00b']) {
      const res = await server.request.get(path).expect(400);
      assert.equal(res.body.error.code, 'INVALID_INPUT');
    }
  });

  test('an unauthenticated login body', async () => {
    const server = await startServer();
    servers.push(server);
    const res = await server.request
      .post('/api/v1/auth/login')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'bad\u0000name', password: 'x' })
      .expect(400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  test('an authenticated body (poll question and option)', async () => {
    const server = await startServer();
    servers.push(server);
    const alice = await registerUser(server, 'nul-alice-' + Date.now());
    const crew = (
      await server.request
        .post('/api/v1/crews')
        .set('x-user-token', alice.token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ name: `Crew ${Date.now()}`, festivalId: 'fest-1' })
        .expect(201)
    ).body.data;

    for (const body of [
      { question: 'bad\u0000x', options: ['a', 'b'] },
      { question: 'ok', options: ['a', 'b\u0000'] },
    ]) {
      const res = await server.request
        .post(`/api/v1/crews/${crew.id}/polls`)
        .set('x-user-token', alice.token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send(body)
        .expect(400);
      assert.equal(res.body.error.code, 'INVALID_INPUT');
    }
  });
});
