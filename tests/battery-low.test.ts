/**
 * Unit tests for lib/battery-low.ts (the one-time "low battery" crew feed line)
 * and a source check that both socket relays call it. No database required.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test, mock } from 'node:test';

import { BATTERY_LOW_PCT, noteBatteryLevel } from '../lib/battery-low.js';
import { MAX_SHARE_WINDOW_MS } from '../lib/live-location-cache.js';
import { makeFakeRedis } from './_fake-redis.js';

const NOW = Date.parse('2026-11-02T21:00:00.000Z');
const KEY = 'loc:battlow:crew-1:user-1';

function makeDeps(redis: any = makeFakeRedis()) {
  return {
    redis,
    stores: { activity: { log: mock.fn(async () => 'act-1') } },
    emitter: { crewActivityLogged: mock.fn(() => {}) },
    log: { warn: mock.fn(() => {}) },
  };
}

function fix(battery: number | undefined, expiresInMs: number | null = 3_600_000) {
  return {
    crewId: 'crew-1',
    userId: 'user-1',
    battery,
    expiresAt: expiresInMs === null ? undefined : new Date(NOW + expiresInMs).toISOString(),
  };
}

function rows(deps: any) {
  return (deps.stores.activity.log.mock.calls as any[]).map((c) => c.arguments[0]);
}

describe('noteBatteryLevel', () => {
  test('the threshold is 10', () => {
    assert.equal(BATTERY_LOW_PCT, 10);
  });

  test('11% posts nothing', async () => {
    const deps = makeDeps();
    assert.equal(await noteBatteryLevel(deps, fix(11), NOW), false);
    assert.equal(rows(deps).length, 0);
    assert.equal(deps.redis.strings.has(KEY), false);
  });

  test('10% posts one battery-low row and pushes it to the crew room', async () => {
    const deps = makeDeps();
    assert.equal(await noteBatteryLevel(deps, fix(10), NOW), true);
    assert.deepEqual(rows(deps), [{ crewId: 'crew-1', userId: 'user-1', type: 'battery-low', detail: '10%' }]);
    assert.equal(deps.emitter.crewActivityLogged.mock.calls.length, 1);
  });

  test('a later 8% fix in the same window posts nothing', async () => {
    const deps = makeDeps();
    await noteBatteryLevel(deps, fix(10), NOW);
    assert.equal(await noteBatteryLevel(deps, fix(8), NOW + 60_000), false);
    assert.equal(rows(deps).length, 1);
  });

  test('the detail is a rounded percentage', async () => {
    const deps = makeDeps();
    await noteBatteryLevel(deps, fix(9.4), NOW);
    assert.equal(rows(deps)[0].detail, '9%');
  });

  test('0% posts; 10.4 posts 10%; 10.6 posts nothing', async () => {
    const zero = makeDeps();
    assert.equal(await noteBatteryLevel(zero, fix(0), NOW), true);
    assert.equal(rows(zero)[0].detail, '0%');
    const low = makeDeps();
    await noteBatteryLevel(low, fix(10.4), NOW);
    assert.equal(rows(low)[0].detail, '10%');
    const high = makeDeps();
    assert.equal(await noteBatteryLevel(high, fix(10.6), NOW), false);
  });

  test('missing or non-finite battery posts nothing', async () => {
    const deps = makeDeps();
    assert.equal(await noteBatteryLevel(deps, fix(undefined), NOW), false);
    assert.equal(await noteBatteryLevel(deps, fix(Number.NaN), NOW), false);
    assert.equal(rows(deps).length, 0);
  });

  test('the TTL is the rest of the share window', async () => {
    const deps = makeDeps();
    await noteBatteryLevel(deps, fix(5, 2 * 3_600_000), NOW);
    assert.equal(deps.redis.ttls.get(KEY), 2 * 3_600_000);
  });

  test('the TTL is clamped to 60 s at the low end and 12 h at the high end', async () => {
    const short = makeDeps();
    await noteBatteryLevel(short, fix(5, 5_000), NOW);
    assert.equal(short.redis.ttls.get(KEY), 60_000);
    const long = makeDeps();
    await noteBatteryLevel(long, fix(5, 20 * 3_600_000), NOW);
    assert.equal(long.redis.ttls.get(KEY), MAX_SHARE_WINDOW_MS);
    assert.equal(MAX_SHARE_WINDOW_MS, 12 * 3_600_000);
  });

  test('without a valid expiresAt the TTL is 12 h', async () => {
    const none = makeDeps();
    await noteBatteryLevel(none, fix(5, null), NOW);
    assert.equal(none.redis.ttls.get(KEY), MAX_SHARE_WINDOW_MS);
    const bad = makeDeps();
    await noteBatteryLevel(bad, { ...fix(5), expiresAt: 'not a date' }, NOW);
    assert.equal(bad.redis.ttls.get(KEY), MAX_SHARE_WINDOW_MS);
  });

  test('no Redis returns false and posts nothing', async () => {
    const deps = makeDeps(null);
    assert.equal(await noteBatteryLevel(deps, fix(5), NOW), false);
    assert.equal(rows(deps).length, 0);
  });

  test('a throwing Redis returns false and logs at warn with the crew id only', async () => {
    const deps = makeDeps({
      set: async () => {
        throw new Error('redis down');
      },
    });
    assert.equal(await noteBatteryLevel(deps, fix(5), NOW), false);
    assert.equal(rows(deps).length, 0);
    const [msg, meta] = (deps.log.warn.mock.calls as any[])[0].arguments;
    assert.equal(msg, 'battery-low check failed');
    assert.deepEqual(Object.keys(meta).sort(), ['crewId', 'error']);
  });

  test('a failing activity store does not throw and logs the feed failure', async () => {
    const deps = makeDeps();
    deps.stores.activity.log = mock.fn(async () => {
      throw new Error('db down');
    });
    assert.equal(await noteBatteryLevel(deps, fix(5), NOW), true);
    const [msg, meta] = (deps.log.warn.mock.calls as any[])[0].arguments;
    assert.equal(msg, 'crew activity log failed');
    assert.equal(meta.type, 'battery-low');
  });
});

describe('routes/socket.ts wiring', () => {
  const src = readFileSync(new URL('../routes/socket.ts', import.meta.url), 'utf8');

  test('both location:share and location:update call noteBatteryLevel', () => {
    assert.equal(src.match(/noteBatteryLevel\(/g)?.length, 2);
  });

  test('the handler destructures the real emitter', () => {
    assert.ok(/\n\s+emitter,\n/.test(src));
    assert.ok(!src.includes('_emitter'));
  });
});
