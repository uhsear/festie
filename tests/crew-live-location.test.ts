// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Mock-based route tests for routes/crew-live-location.ts (T41 background
 * live-location relay over HTTP).
 *
 * Real Zod schemas, real validate/validateParams, real LOCATION_UPDATE_LIMIT,
 * real sendSuccess/sendError. Stores, io, redis and pool are mocks. Each test
 * uses a fresh user id so the in-memory limiter does not bleed between tests.
 * No database required.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

import { validate, validateParams, schemas } from '../lib/schemas.js';
import { sendSuccess, sendError, ErrorCodes } from '../lib/response.js';
import { sanitizeIdentifier } from '../lib/helpers/sanitize.js';

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };

let userSeq = 0;
function nextUserId() {
  userSeq += 1;
  return `ll-user-${userSeq}-${Date.now()}`;
}

function makeIo() {
  const emitFn = mock.fn(() => {});
  return { to: mock.fn(() => ({ emit: emitFn })), _emit: emitFn };
}

/** Fake ioredis: a pipeline that records hset, and a recorded hdel. */
function makeRedis() {
  const hset = mock.fn(() => {});
  const pipeline = {
    hset,
    pexpire: mock.fn(() => {}),
    incr: mock.fn(() => {}),
    pttl: mock.fn(() => {}),
    // No per-command results, so the limiter falls back to its in-memory bucket.
    exec: mock.fn(async () => null),
  };
  return {
    pipeline: mock.fn(() => pipeline),
    pexpire: mock.fn(async () => 1),
    hdel: mock.fn(async () => 1),
    _hset: hset,
  };
}

function makePool() {
  return { query: mock.fn(async () => ({ rows: [] })), connect: mock.fn(async () => ({})) };
}

function makeDeps(overrides: any = {}) {
  const userId = overrides.userId || nextUserId();
  const io = makeIo();
  const redis = makeRedis();
  const pool = makePool();
  const crews = {
    getMember: overrides.getMember || mock.fn(async () => ({ userId, role: 'member' })),
    addMember: mock.fn(async () => {}),
    removeMember: mock.fn(async () => {}),
  };
  const deps = {
    express,
    log: noopLog,
    config: overrides.config || {},
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId, username: 'bgsharer' };
      next();
    },
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    validate,
    validateParams,
    schemas,
    io,
    redis,
    pool,
    stores: { crews },
  };
  return { deps, io, redis, pool, crews, userId };
}

async function buildApp(overrides: any = {}) {
  const ctx = makeDeps(overrides);
  const { default: createRoutes } = await import('../routes/crew-live-location.js');
  const app = express();
  app.use(express.json());
  app.use('/', createRoutes(ctx.deps as any));
  return { app, ...ctx };
}

function fix(over: Record<string, unknown> = {}) {
  return {
    lat: 41.8781,
    lng: -87.6298,
    accuracy: 10,
    heading: 90,
    speed: 1.2,
    battery: 55,
    lowPower: false,
    capturedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...over,
  };
}

function assertNoWrites(pool: any, crews: any) {
  assert.equal(pool.query.mock.calls.length, 0);
  assert.equal(pool.connect.mock.calls.length, 0);
  assert.equal(crews.addMember.mock.calls.length, 0);
  assert.equal(crews.removeMember.mock.calls.length, 0);
}

describe('POST /:crewId/live-location', () => {
  test('relays the fix to the crew room and the cache', async () => {
    const { app, io, redis, pool, crews, userId } = await buildApp();
    const body = fix({ capturedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    const before = Date.now();

    const res = await request(app).post('/crew-1/live-location').send(body);

    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.serverAt, 'string');
    assert.equal((io.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    const [event, payload] = (io._emit.mock.calls as any[])[0].arguments;
    assert.equal(event, 'location:peer-update');
    assert.equal(payload.userId, userId);
    assert.equal(payload.username, 'bgsharer');
    assert.equal(payload.expiresAt, body.expiresAt);
    assert.equal(payload.serverAt, res.body.data.serverAt);
    // A 10-minute-old fix is clamped to serverAt minus 60 s.
    assert.equal(Date.parse(payload.capturedAt), Date.parse(payload.serverAt) - 60_000);
    assert.ok(Date.parse(payload.capturedAt) >= before - 60_000);
    assert.equal(redis._hset.mock.calls.length, 1);
    assert.equal((redis._hset.mock.calls as any[])[0].arguments[0], 'loc:pos:crew-1');
    assertNoWrites(pool, crews);
  });

  test('non-member gets 403 and nothing is emitted', async () => {
    const { app, io, redis } = await buildApp({ getMember: mock.fn(async () => null) });
    const res = await request(app).post('/crew-1/live-location').send(fix());
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.equal(io.to.mock.calls.length, 0);
    assert.equal(redis._hset.mock.calls.length, 0);
  });

  test('flag off returns 503', async () => {
    const { app, io } = await buildApp({ config: { LIVE_LOCATION_ENABLED: false } });
    const res = await request(app).post('/crew-1/live-location').send(fix());
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(io.to.mock.calls.length, 0);
  });

  test('expiresAt in the past returns 400', async () => {
    const { app, io } = await buildApp();
    const res = await request(app)
      .post('/crew-1/live-location')
      .send(fix({ expiresAt: new Date(Date.now() - 60_000).toISOString() }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'This share has ended. Turn sharing on again.');
    assert.equal(io.to.mock.calls.length, 0);
  });

  test('expiresAt 13 hours ahead returns 400', async () => {
    const { app, io } = await buildApp();
    const res = await request(app)
      .post('/crew-1/live-location')
      .send(fix({ expiresAt: new Date(Date.now() + 13 * 3_600_000).toISOString() }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'Pick a sharing time of 12 hours or less.');
    assert.equal(io.to.mock.calls.length, 0);
  });

  test('lat 91 fails validation with 400', async () => {
    const { app, io } = await buildApp();
    const res = await request(app).post('/crew-1/live-location').send(fix({ lat: 91 }));
    assert.equal(res.status, 400);
    assert.equal(io.to.mock.calls.length, 0);
  });

  test('the 13th fix in a minute is rate limited', async () => {
    const { app, pool, crews } = await buildApp();
    for (let i = 0; i < 12; i++) {
      const ok = await request(app).post('/crew-1/live-location').send(fix());
      assert.equal(ok.status, 200, `fix ${i + 1} should pass`);
    }
    const res = await request(app).post('/crew-1/live-location').send(fix());
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
    assertNoWrites(pool, crews);
  });
});

describe('DELETE /:crewId/live-location', () => {
  test('emits peer-stopped with reason stop and drops the cached fix', async () => {
    const { app, io, redis, pool, crews, userId } = await buildApp();
    const res = await request(app).delete('/crew-1/live-location');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { stopped: true });
    assert.equal((io.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.deepEqual((io._emit.mock.calls as any[])[0].arguments, [
      'location:peer-stopped',
      { _v: 1, crewId: 'crew-1', userId, reason: 'stop' },
    ]);
    assert.deepEqual((redis.hdel.mock.calls as any[])[0].arguments, ['loc:pos:crew-1', userId]);
    assertNoWrites(pool, crews);
  });

  test('non-member gets 403 and nothing is emitted', async () => {
    const { app, io, redis } = await buildApp({ getMember: mock.fn(async () => null) });
    const res = await request(app).delete('/crew-1/live-location');
    assert.equal(res.status, 403);
    assert.equal(io.to.mock.calls.length, 0);
    assert.equal(redis.hdel.mock.calls.length, 0);
  });
});
