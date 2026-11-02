import { after, afterEach, describe, test } from 'node:test';
import { assert, Pool, request, TEST_DATABASE_URL, startServer, registerUser } from './_integration-helpers';
import createSessionsStore from '../lib/db/stores/sessions';

const servers: any[] = [];
const pool = new Pool({ connectionString: TEST_DATABASE_URL, statement_timeout: 5000 });

afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

after(async () => {
  await pool.end();
});

async function countRows(sql: string, userId: string) {
  const { rows } = await pool.query(sql, [userId]);
  return Number(rows[0].count);
}

describe('Refresh-token rotation (DB)', { concurrency: 1 }, () => {
  test('two concurrent refreshes with one token: one 200, one 401, one new session', async () => {
    const server = await startServer();
    servers.push(server);
    const alice = await registerUser(server, 'alice');
    assert.ok(alice.refreshToken, 'native register returns a refresh token');
    const sessionsBefore = await countRows('SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = $1', alice.user.id);

    const send = () => server.request.post('/api/v1/auth/refresh-token').send({ refreshToken: alice.refreshToken });
    const results = await Promise.all([send(), send()]);
    const statuses = results.map((r: any) => r.status).sort();

    assert.deepEqual(statuses, [200, 401]);
    const winner: any = results.find((r: any) => r.status === 200);
    assert.ok(winner.body.data.token);
    assert.ok(winner.body.data.refreshToken);
    assert.equal(
      await countRows('SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = $1', alice.user.id),
      sessionsBefore + 1,
    );
    assert.equal(
      await countRows('SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id = $1 AND revoked = FALSE', alice.user.id),
      1,
    );

    // The new pair works once more; the spent token stays dead.
    await server.request.post('/api/v1/auth/refresh-token').send({ refreshToken: winner.body.data.refreshToken }).expect(200);
    await send().expect(401);
  });

  test('a web (Origin) refresh sets only the cookie, no body tokens', async () => {
    const server = await startServer();
    servers.push(server);
    const bob = await registerUser(server, 'bob');

    // Hit the listening server so the same-host Origin passes the CSRF check.
    const res = await request(server.planner.server)
      .post('/api/v1/auth/refresh-token')
      .set('Origin', server.baseUrl)
      .set('x-festie-request', '1')
      .send({ refreshToken: bob.refreshToken })
      .expect(200);
    assert.equal(res.body.data.token, undefined);
    assert.equal(res.body.data.refreshToken, undefined);
    assert.ok(String(res.headers['set-cookie'] ?? '').length > 0, 'session cookie is set');
  });

  test('claim spends a live token once and refuses revoked, expired and unknown tokens', async () => {
    const server = await startServer();
    servers.push(server);
    const carol = await registerUser(server, 'carol');
    const store = createSessionsStore(pool, {}).refreshTokens;
    const insert = (token: string, expiresAt: Date, revoked: boolean) =>
      pool.query('INSERT INTO refresh_tokens (token, user_id, expires_at, revoked) VALUES ($1, $2, $3, $4)', [
        token,
        carol.user.id,
        expiresAt,
        revoked,
      ]);
    const future = new Date(Date.now() + 3_600_000);
    await insert('claim-live', future, false);
    await insert('claim-revoked', future, true);
    await insert('claim-expired', new Date(Date.now() - 1_000), false);

    assert.deepEqual(await store.claim('claim-live'), { userId: carol.user.id });
    assert.equal(await store.claim('claim-live'), null);
    assert.equal(await store.claim('claim-revoked'), null);
    assert.equal(await store.claim('claim-expired'), null);
    assert.equal(await store.claim('claim-unknown'), null);
  });
});
