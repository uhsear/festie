import { afterEach, describe, test } from 'node:test';
import {
  assert,
  Pool,
  TEST_DATABASE_URL,
  startServer,
  registerUser,
} from './_integration-helpers';

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Weather', { concurrency: 1 }, () => {
  test('returns 404 for a nonexistent festival', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'weather-alice-' + Date.now());

    const res = await server.request
      .get('/api/v1/weather/nonexistent-fest-' + Date.now())
      .set('x-user-token', alice.token)
      .expect(404);

    assert.ok(res.body.error, 'Should return an error');
  });

  test('returns available:false when festival has no coordinates', async () => {
    const server = await startServer();
    servers.push(server);

    const bob = await registerUser(server, 'weather-bob-' + Date.now());

    // The seed festival (fest-1) has no latitude/longitude by default
    const res = await server.request
      .get('/api/v1/weather/fest-1')
      .set('x-user-token', bob.token)
      .expect(200);

    assert.equal(res.body.error, null);
    assert.equal(res.body.data.available, false);
    assert.ok(res.body.data.reason, 'Should include a reason when coords missing');
  });

  test('fetches weather data for a festival with coordinates', async () => {
    const server = await startServer();
    servers.push(server);

    const charlie = await registerUser(server, 'weather-charlie-' + Date.now());

    // Add coordinates to fest-1 for this test
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await pool.query(
        'UPDATE festivals SET latitude = $1, longitude = $2 WHERE id = $3',
        [29.2108, -81.0228, 'fest-1'] // Daytona Beach, FL
      );
    } finally {
      await pool.end();
    }

    // Stub Open-Meteo so the test never depends on the network.
    const realFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          timezone: 'America/New_York',
          daily: { time: ['2026-06-05'], temperature_2m_max: [30] },
          hourly: { time: ['2026-06-05T10:00'], temperature_2m: [25] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;
    try {
      const res = await server.request
        .get('/api/v1/weather/fest-1')
        .set('x-user-token', charlie.token)
        .expect(200);

      assert.equal(res.body.error, null);
      assert.equal(urls.length, 1);
      assert.ok(urls[0]?.startsWith('https://api.open-meteo.com/'));
      assert.equal(res.body.data.available, true);
      assert.deepEqual(res.body.data.daily.dates, ['2026-06-05']);
      assert.deepEqual(res.body.data.daily.maxTemp, [30]);
      assert.deepEqual(res.body.data.hourly.times, ['2026-06-05T10:00']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('requires authentication', async () => {
    const server = await startServer();
    servers.push(server);

    // Weather endpoint requires auth — no auth header should get 401
    const res = await server.request
      .get('/api/v1/weather/fest-1');

    assert.equal(res.status, 401);
  });
});
