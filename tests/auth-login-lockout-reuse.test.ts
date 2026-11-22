import { after, afterEach, describe, test, mock } from 'node:test';
import { assert, Pool, TEST_DATABASE_URL, startServer, registerUser } from './_integration-helpers';
import { createRateLimiters } from '../lib/rate-limiting.js';
import { REFRESH_REUSE_GRACE_MS } from '../routes/auth';
import { loadConfig } from '../lib/config.js';
import createSessionsStore from '../lib/db/stores/sessions';

// Owner decisions: login limits (per-(IP, username) bucket plus a per-IP cap), account lockout counted per
// (account, client IP) with a higher global threshold, and refresh-token reuse revoking the whole family.

const servers: any[] = [];
const pool = new Pool({ connectionString: TEST_DATABASE_URL, statement_timeout: 5000 });

afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});
after(async () => {
  await pool.end();
});

const LOGIN_GLOBAL_LOCK_FAILURES = loadConfig({ DATABASE_URL: TEST_DATABASE_URL }).LOGIN_GLOBAL_LOCK_FAILURES;
const PASSWORD = 'Str0ngTest!Pw';
const login = (server: any, ip: string, username: string, password = PASSWORD) =>
  server.request.post('/api/v1/auth/login').set('CF-Connecting-IP', ip).send({ username, password });
const refresh = (server: any, refreshToken: string) =>
  server.request.post('/api/v1/auth/refresh-token').send({ refreshToken });
const boot = async (overrides: Record<string, any> = {}) => {
  const server = await startServer({ TRUST_PROXY: true, AUTH_RATE_LIMIT_MAX: 1000, ...overrides });
  servers.push(server);
  return server;
};

describe('login limits', { concurrency: 1 }, () => {
  test('login has its own per-IP cap, separate from the strict auth limiter', async () => {
    const server = await boot({ AUTH_RATE_LIMIT_MAX: 2, AUTH_LOGIN_IP_RATE_LIMIT_MAX: 5 });
    // Distinct usernames each get their own (IP, username) bucket, so only the IP cap can stop them.
    for (let i = 0; i < 5; i++) await login(server, '203.0.113.9', `nobody${i}`).expect(401);
    await login(server, '203.0.113.9', 'nobody5').expect(429);
    // Another IP is unaffected.
    await login(server, '203.0.113.10', 'nobody6').expect(401);
  });

  test('the login IP cap treats every address in one IPv6 /64 as one client', async () => {
    const server = await boot({ AUTH_LOGIN_IP_RATE_LIMIT_MAX: 3 });
    for (let i = 0; i < 3; i++) await login(server, `2001:db8:5:6::${i + 1}`, `nobody${i}`).expect(401);
    await login(server, '2001:db8:5:6:ffff::9', 'nobody9').expect(429);
    await login(server, '2001:db8:5:7::1', 'nobody10').expect(401);
  });

  test('register keeps the strict IP-only limiter', async () => {
    const server = await boot({ AUTH_RATE_LIMIT_MAX: 2, AUTH_LOGIN_IP_RATE_LIMIT_MAX: 50 });
    const reg = (name: string) =>
      server.request.post('/api/v1/auth/register').set('CF-Connecting-IP', '203.0.113.20').send({ username: name });
    await reg('regone');
    await reg('regtwo');
    await reg('regthree').expect(429);
  });

  test('the login IP cap counts the shared "unknown" IP too', async () => {
    const state: any = { loginIpRateLimits: new Map(), authRateLimits: new Map(), adminAuthRateLimits: new Map() };
    const { loginIpRateLimit } = createRateLimiters({
      config: { CLUSTER_SIZE: 1, AUTH_RATE_LIMIT_WINDOW: 300000, AUTH_RATE_LIMIT_MAX: 10, AUTH_LOGIN_IP_RATE_LIMIT_MAX: 3, MAX_RATE_LIMIT_ENTRIES: 100 },
      state,
      log: { info() {}, warn() {}, error() {} },
      getRequestIp: () => 'unknown',
      sendError: mock.fn((res: any, status: number) => {
        res.status = status;
      }),
      ErrorCodes: { RATE_LIMITED: 'RATE_LIMITED' },
      hashSessionToken: (t: string) => t,
      resolveRequestToken: () => ({ token: null }),
      redisRateLimiter: null,
      redisAuthRateLimiter: null,
      redisLoginIpRateLimiter: null,
      redisSocketConnectLimiter: null,
      redis: null,
      redisRateCheck: null,
    } as any);
    const hits: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res: any = { set() {}, setHeader() {} };
      await loginIpRateLimit({ path: '/', headers: {} }, res, () => hits.push(i));
      if (i === 3) assert.equal(res.status, 429);
    }
    assert.deepEqual(hits, [0, 1, 2]);
  });
});

describe('account lockout per (account, IP)', { concurrency: 1 }, () => {
  test('failures from one IP lock the account for that IP only', async () => {
    const server = await boot({ MAX_LOGIN_FAILURES: 3, AUTH_LOGIN_IP_RATE_LIMIT_MAX: 1000 });
    await registerUser(server, 'lockme');
    await registerUser(server, 'bystander');
    for (let i = 0; i < 3; i++) await login(server, '198.51.100.1', 'lockme', 'wrong-Pass-1!').expect(401);

    // The locked IP is refused even with the right password, with the same response as before.
    const locked = await login(server, '198.51.100.1', 'lockme').expect(423);
    assert.equal(locked.body.error?.code ?? locked.body.code, 'ACCOUNT_LOCKED');
    assert.ok(locked.headers['retry-after']);
    // Another IP still signs in, and the locked IP can still sign in to other accounts.
    await login(server, '198.51.100.2', 'lockme').expect(200);
    await login(server, '198.51.100.1', 'bystander').expect(200);
  });

  test('failures across many IPs reach the global lock, which locks every IP', async () => {
    const server = await boot({ MAX_LOGIN_FAILURES: 3, AUTH_LOGIN_IP_RATE_LIMIT_MAX: 1000 });
    await registerUser(server, 'globalme');
    let sent = 0;
    for (let ip = 1; sent < LOGIN_GLOBAL_LOCK_FAILURES; ip++) {
      for (let i = 0; i < 3 && sent < LOGIN_GLOBAL_LOCK_FAILURES; i++, sent++) {
        await login(server, `192.0.2.${ip}`, 'globalme', 'wrong-Pass-1!').expect(401);
      }
    }
    await login(server, '192.0.2.250', 'globalme').expect(423);
  });

  test('a successful login clears the count for that IP', async () => {
    const server = await boot({ MAX_LOGIN_FAILURES: 3, AUTH_LOGIN_IP_RATE_LIMIT_MAX: 1000 });
    await registerUser(server, 'resetme');
    for (let round = 0; round < 3; round++) {
      await login(server, '198.51.100.7', 'resetme', 'wrong-Pass-1!').expect(401);
      await login(server, '198.51.100.7', 'resetme', 'wrong-Pass-1!').expect(401);
      await login(server, '198.51.100.7', 'resetme').expect(200);
    }
  });

  test('clearing the failure rows (admin unlock) frees a locked IP', async () => {
    const server = await boot({ MAX_LOGIN_FAILURES: 3, AUTH_LOGIN_IP_RATE_LIMIT_MAX: 1000 });
    const user = await registerUser(server, 'unlockme');
    for (let i = 0; i < 3; i++) await login(server, '198.51.100.8', 'unlockme', 'wrong-Pass-1!').expect(401);
    await login(server, '198.51.100.8', 'unlockme').expect(423);
    await pool.query('DELETE FROM login_failures WHERE user_id = $1', [user.user.id]);
    await pool.query('DELETE FROM login_failure_ips WHERE user_id = $1', [user.user.id]);
    await login(server, '198.51.100.8', 'unlockme').expect(200);
  });
});

describe('refresh-token reuse', { concurrency: 1 }, () => {
  const age = (userId: string) =>
    pool.query(
      `UPDATE refresh_tokens SET rotated_at = NOW() - make_interval(secs => $2) WHERE user_id = $1 AND rotated_at IS NOT NULL`,
      [userId, (REFRESH_REUSE_GRACE_MS / 1000) * 3],
    );
  const live = async (userId: string) =>
    Number((await pool.query('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = $1 AND revoked = FALSE', [userId])).rows[0].n);

  test('reuse of a rotated token after the grace window revokes its whole family', async () => {
    const server = await boot();
    const user = await registerUser(server, 'famuser');
    const t0 = user.refreshToken;
    const r1 = (await refresh(server, t0).expect(200)).body.data;
    const r2 = (await refresh(server, r1.refreshToken).expect(200)).body.data;
    await age(user.user.id);

    await refresh(server, t0).expect(401);

    // The tip of the family and the session it minted are dead.
    await refresh(server, r2.refreshToken).expect(401);
    await server.request.get('/api/v1/auth/me').set('x-user-token', r2.token).expect(401);
    assert.equal(await live(user.user.id), 0);
  });

  test('reuse revokes only its own family, not another sign-in', async () => {
    const server = await boot();
    const user = await registerUser(server, 'twofam');
    const other = (await login(server, '198.51.100.30', 'twofam').expect(200)).body.data;
    const r1 = (await refresh(server, user.refreshToken).expect(200)).body.data;
    await age(user.user.id);

    await refresh(server, user.refreshToken).expect(401);
    await refresh(server, r1.refreshToken).expect(401);
    await refresh(server, other.refreshToken).expect(200);
  });

  test('reuse inside the grace window returns 401 and revokes nothing', async () => {
    const server = await boot();
    const user = await registerUser(server, 'gracer');
    const r1 = (await refresh(server, user.refreshToken).expect(200)).body.data;

    await refresh(server, user.refreshToken).expect(401);

    assert.equal(await live(user.user.id), 1);
    await refresh(server, r1.refreshToken).expect(200);
  });

  test('a token revoked by revokeAll is not a reuse and revokes no sibling', async () => {
    const server = await boot();
    const user = await registerUser(server, 'revall');
    const other = (await login(server, '198.51.100.31', 'revall').expect(200)).body.data;
    await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [user.user.id]);
    await refresh(server, user.refreshToken).expect(401);
    await refresh(server, other.refreshToken).expect(401);
    assert.equal(await live(user.user.id), 0);
  });

  test('a token with no family id acts as its own family', async () => {
    const server = await boot();
    const user = await registerUser(server, 'legacy');
    await pool.query('UPDATE refresh_tokens SET family_id = NULL WHERE user_id = $1', [user.user.id]);
    const r1 = (await refresh(server, user.refreshToken).expect(200)).body.data;
    await age(user.user.id);
    await refresh(server, user.refreshToken).expect(401);
    await refresh(server, r1.refreshToken).expect(401);
  });
  test('reuse also kills a session renewed through POST /auth/refresh', async () => {
    const server = await boot();
    const user = await registerUser(server, 'renewed');
    const t0 = user.refreshToken;
    const r1 = (await refresh(server, t0).expect(200)).body.data;
    // A thief holding r1's session renews it the way every first-party client does.
    const renewed = (await server.request.post('/api/v1/auth/refresh').set('x-user-token', r1.token).expect(200)).body.data;
    await server.request.get('/api/v1/auth/me').set('x-user-token', renewed.token).expect(200);
    await age(user.user.id);

    await refresh(server, t0).expect(401);

    await server.request.get('/api/v1/auth/me').set('x-user-token', renewed.token).expect(401);
  });
});

describe('stale per-IP failure rows', { concurrency: 1 }, () => {
  test('purgeStaleIps deletes old unlocked rows and keeps recent or locked ones', async () => {
    const server = await boot();
    const user = await registerUser(server, 'purgeme');
    const id = user.user.id;
    const row = (ip: string, ago: string, lock: string | null) =>
      pool.query(
        `INSERT INTO login_failure_ips (user_id, ip_hash, consecutive_failures, last_failure_at, locked_until)
         VALUES ($1, $2, 1, NOW() - $3::interval, ${lock ? `NOW() + $4::interval` : 'NULL'})`,
        lock ? [id, ip, ago, lock] : [id, ip, ago],
      );
    await row('old-unlocked', '1 hour', null);
    await row('old-expired-lock', '1 hour', null);
    await pool.query(`UPDATE login_failure_ips SET locked_until = NOW() - interval '1 minute' WHERE ip_hash = 'old-expired-lock'`);
    await row('old-still-locked', '1 hour', '5 minutes');
    await row('recent', '1 minute', null);

    const store = createSessionsStore(pool as any, {});
    await store.loginFailures.purgeStaleIps(15 * 60 * 1000);

    const left = (await pool.query('SELECT ip_hash FROM login_failure_ips WHERE user_id = $1 ORDER BY ip_hash', [id])).rows.map((r: any) => r.ip_hash);
    assert.deepEqual(left, ['old-still-locked', 'recent']);
  });
});
