/**
 * Mock-based route tests for routes/crew-checkin.ts (check-in timers).
 *
 * Real Zod schemas, validate/validateParams and response shaping; stores,
 * emitter and Redis are in-memory fakes. No database required.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

import { validate, validateParams, schemas } from '../lib/schemas.js';
import { sendSuccess, sendError, ErrorCodes } from '../lib/response.js';
import { sanitizeIdentifier } from '../lib/helpers/sanitize.js';
import { makeFakeRedis } from './_fake-redis.js';

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };

const POSITION = { lat: 41.88425, lng: -87.63245, accuracy: 12, capturedAt: '2026-06-06T18:00:00.000Z' };

async function buildApp(overrides: any = {}) {
  const deps: any = {
    log: noopLog,
    config: overrides.config || {},
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', username: 'testuser' };
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
    emitter: { crewActivityLogged: mock.fn(() => {}) },
    stores: {
      crews: { getMember: overrides.getMember || mock.fn(async () => ({ userId: 'user-1', role: 'member' })) },
      activity: { log: mock.fn(async () => 'activity-1') },
    },
    redis: 'redis' in overrides ? overrides.redis : makeFakeRedis(),
  };
  const { default: createRoutes } = await import('../routes/crew-checkin.js');
  const app = express();
  app.use(express.json());
  app.use('/', createRoutes(deps));
  return { app, deps };
}

describe('routes/crew-checkin.ts — POST /:crewId/checkin', () => {
  test('start returns dueAt 30 min out and writes the key and both set members', async () => {
    const { app, deps } = await buildApp();
    const before = Date.now();

    const res = await request(app).post('/crew-1/checkin').send({ minutes: 30, position: POSITION });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.minutes, 30);
    const dueAt = Date.parse(res.body.data.dueAt);
    assert.ok(dueAt >= before + 30 * 60_000 && dueAt <= Date.now() + 30 * 60_000);

    const redis = deps.redis;
    const stored = JSON.parse(redis.strings.get('checkin:crew-1:user-1'));
    assert.equal(stored.username, 'testuser');
    assert.equal(stored.dueAt, dueAt);
    assert.deepEqual([stored.position.lat, stored.position.lng], [41.8843, -87.6324]);
    assert.equal(redis.ttls.get('checkin:crew-1:user-1'), 30 * 60_000 + 60 * 60_000);
    assert.equal(redis.zsets.get('checkin:due').get('crew-1|user-1'), dueAt);
    assert.equal(redis.zsets.get('checkin:warn').get('crew-1|user-1'), dueAt - 5 * 60_000);

    const row = (deps.stores.activity.log.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(row, { crewId: 'crew-1', userId: 'user-1', type: 'checkin-started', detail: '30 min' });
    assert.equal(deps.emitter.crewActivityLogged.mock.calls[0].arguments[0].item.type, 'checkin-started');
  });

  test('minutes 5 and 300 are rejected with 400', async () => {
    const { app } = await buildApp();
    assert.equal((await request(app).post('/crew-1/checkin').send({ minutes: 5 })).status, 400);
    assert.equal((await request(app).post('/crew-1/checkin').send({ minutes: 300 })).status, 400);
  });

  test('403 for a non-member', async () => {
    const { app } = await buildApp({ getMember: mock.fn(async () => null) });
    const res = await request(app).post('/crew-1/checkin').send({ minutes: 30 });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('503 with no Redis', async () => {
    const { app } = await buildApp({ redis: null });
    const res = await request(app).post('/crew-1/checkin').send({ minutes: 30 });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(res.body.error.message, 'Check-in timers are not available right now.');
  });

  test('503 when SOS_ENABLED is false', async () => {
    const { app } = await buildApp({ config: { SOS_ENABLED: false } });
    const res = await request(app).post('/crew-1/checkin').send({ minutes: 30 });
    assert.equal(res.status, 503);
  });

  test('503 when the Redis write fails', async () => {
    const redis = makeFakeRedis();
    redis.multi = () => {
      throw new Error('redis down');
    };
    const { app } = await buildApp({ redis });
    const res = await request(app).post('/crew-1/checkin').send({ minutes: 30 });
    assert.equal(res.status, 503);
  });
});

describe('routes/crew-checkin.ts — done and GET', () => {
  test('done clears and logs checkin-done; a second done is { cleared: false } and logs nothing', async () => {
    const { app, deps } = await buildApp();
    await request(app).post('/crew-1/checkin').send({ minutes: 30 });
    deps.stores.activity.log.mock.resetCalls();

    const first = await request(app).post('/crew-1/checkin/done').send();
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.data, { cleared: true });
    const row = (deps.stores.activity.log.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(row, { crewId: 'crew-1', userId: 'user-1', type: 'checkin-done', detail: null });
    assert.equal(deps.redis.strings.has('checkin:crew-1:user-1'), false);
    assert.equal(deps.redis.zsets.get('checkin:due').has('crew-1|user-1'), false);
    assert.equal(deps.redis.zsets.get('checkin:warn').has('crew-1|user-1'), false);

    const second = await request(app).post('/crew-1/checkin/done').send();
    assert.deepEqual(second.body.data, { cleared: false });
    assert.equal(deps.stores.activity.log.mock.calls.length, 1);
  });

  test('GET returns the active timer, then null after done', async () => {
    const { app } = await buildApp();
    const started = await request(app).post('/crew-1/checkin').send({ minutes: 15 });

    const active = await request(app).get('/crew-1/checkin');
    assert.equal(active.status, 200);
    assert.equal(active.headers['cache-control'], 'no-store');
    assert.deepEqual(active.body.data.checkin, { dueAt: started.body.data.dueAt, minutes: 15 });

    await request(app).post('/crew-1/checkin/done').send();
    const after = await request(app).get('/crew-1/checkin');
    assert.equal(after.body.data.checkin, null);
  });

  test('done and GET are 403 for a non-member', async () => {
    const { app } = await buildApp({ getMember: mock.fn(async () => null) });
    assert.equal((await request(app).post('/crew-1/checkin/done').send()).status, 403);
    assert.equal((await request(app).get('/crew-1/checkin')).status, 403);
  });
});
