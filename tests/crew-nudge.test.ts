/**
 * Mock-based route tests for routes/crew-nudge.ts ("Looking for you").
 *
 * Real Zod schemas, validateParams and response shaping; stores, crewNotify and
 * Redis are in-memory fakes. No database required.
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

const TWO_MEMBERS = [
  { userId: 'user-1', username: 'testuser' },
  { userId: 'user-2', username: 'ana' },
];

async function buildApp(overrides: any = {}) {
  let caller = overrides.caller || 'user-1';
  const deps: any = {
    log: { ...noopLog, warn: mock.fn(noop) },
    config: {},
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: caller, username: caller === 'user-1' ? 'testuser' : 'ana' };
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
    stores: {
      crews: { getMembers: overrides.getMembers || mock.fn(async () => TWO_MEMBERS) },
    },
    crewNotify: { toUsers: mock.fn(async () => {}) },
    redis: 'redis' in overrides ? overrides.redis : makeFakeRedis(),
  };
  const { default: createRoutes } = await import('../routes/crew-nudge.js');
  const app = express();
  app.use(express.json());
  app.use('/', createRoutes(deps));
  return { app, deps, setCaller: (id: string) => (caller = id) };
}

const URL = '/crew-1/members/user-2/nudge';

function assertNoPush(deps: any) {
  assert.equal(deps.crewNotify.toUsers.mock.calls.length, 0);
}

describe('routes/crew-nudge.ts — POST /:crewId/members/:userId/nudge', () => {
  test('sends one crew_nudge push to the target and answers { nudged: true }', async () => {
    const { app, deps } = await buildApp();
    const res = await request(app).post(URL).send({});

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { nudged: true });
    assert.equal(deps.crewNotify.toUsers.mock.calls.length, 1);
    const arg = (deps.crewNotify.toUsers.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(arg.userIds, ['user-2']);
    assert.equal(arg.kind, 'member');
    assert.equal(arg.type, 'crew_nudge');
    assert.equal(arg.crewId, 'crew-1');
    assert.equal(arg.text, 'testuser is looking for you.');
    assert.equal(deps.redis.ttls.get('nudge:crew-1:user-1:user-2'), 300_000);
  });

  test('the push carries no location', async () => {
    const { app, deps } = await buildApp();
    await request(app)
      .post(URL)
      .send({ lat: 41.1, lng: -87.2, position: { lat: 1, lng: 2 } });
    const arg = (deps.crewNotify.toUsers.mock.calls as any[])[0].arguments[0];
    const flat = JSON.stringify(arg);
    assert.ok(!/lat|lng|position/i.test(flat), flat);
  });

  test('a second nudge within 5 minutes is 429 with Retry-After; the reverse direction still sends', async () => {
    const { app, deps, setCaller } = await buildApp();
    assert.equal((await request(app).post(URL).send({})).status, 200);

    const again = await request(app).post(URL).send({});
    assert.equal(again.status, 429);
    assert.equal(again.body.error.code, 'RATE_LIMITED');
    assert.equal(again.body.error.message, 'You sent this in the last 5 minutes.');
    assert.ok(Number(again.headers['retry-after']) >= 1);
    assert.equal(Number(again.headers['retry-after']), 300);
    assert.equal(deps.crewNotify.toUsers.mock.calls.length, 1);

    setCaller('user-2');
    const reverse = await request(app).post('/crew-1/members/user-1/nudge').send({});
    assert.equal(reverse.status, 200);
    assert.equal(deps.crewNotify.toUsers.mock.calls.length, 2);
  });

  test('the same pair in another crew is a separate limit', async () => {
    const { app } = await buildApp();
    assert.equal((await request(app).post(URL).send({})).status, 200);
    assert.equal((await request(app).post('/crew-2/members/user-2/nudge').send({})).status, 200);
  });

  test('nudging yourself is 400', async () => {
    const { app, deps } = await buildApp();
    const res = await request(app).post('/crew-1/members/user-1/nudge').send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.equal(res.body.error.message, "You can't send this to yourself.");
    assertNoPush(deps);
  });

  test('a caller who is not in the crew is 403, even for a target who is not either', async () => {
    const { app, deps } = await buildApp({ getMembers: mock.fn(async () => [TWO_MEMBERS[1]]) });
    const res = await request(app).post('/crew-1/members/user-9/nudge').send({});
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assertNoPush(deps);
  });

  test('a target who is not in the crew is 404', async () => {
    const { app, deps } = await buildApp();
    const res = await request(app).post('/crew-1/members/user-9/nudge').send({});
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'That person is not in this crew.');
    assertNoPush(deps);
  });

  test('a deleted target (missing from getMembers) is 404', async () => {
    const { app, deps } = await buildApp({ getMembers: mock.fn(async () => [TWO_MEMBERS[0]]) });
    const res = await request(app).post(URL).send({});
    assert.equal(res.status, 404);
    assertNoPush(deps);
  });

  test('no Redis is 503', async () => {
    const { app, deps } = await buildApp({ redis: null });
    const res = await request(app).post(URL).send({});
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(res.body.error.message, '"Looking for you" is not available right now.');
    assertNoPush(deps);
  });

  test('a recipient with 6 nudges from the crew in the last hour gets no more', async () => {
    const redis = makeFakeRedis();
    const now = Date.now();
    for (let i = 0; i < 6; i++) await redis.zadd('nudge-in:user-2', now - i * 60_000, `other-${i}:${now}`);
    const { app, deps } = await buildApp({ redis });
    const res = await request(app).post(URL).send({});
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
    assert.equal(await redis.get('nudge:crew-1:user-1:user-2'), null);
    assertNoPush(deps);
  });

  test('nudges older than an hour do not count toward the recipient cap', async () => {
    const redis = makeFakeRedis();
    const old = Date.now() - 61 * 60_000;
    for (let i = 0; i < 6; i++) await redis.zadd('nudge-in:user-2', old, `other-${i}:${old}`);
    const { app } = await buildApp({ redis });
    const res = await request(app).post(URL).send({});
    assert.equal(res.status, 200);
  });

  test('a Redis set that throws is 503, logged at warn, and sends nothing', async () => {
    const redis = makeFakeRedis();
    redis.set = async () => {
      throw new Error('redis down');
    };
    const { app, deps } = await buildApp({ redis });
    const res = await request(app).post(URL).send({});
    assert.equal(res.status, 503);
    assert.equal(deps.log.warn.mock.calls[0].arguments[0], 'crew nudge limit failed');
    assertNoPush(deps);
  });

  test('a store failure is 500', async () => {
    const { app, deps } = await buildApp({
      getMembers: mock.fn(async () => {
        throw new Error('db down');
      }),
    });
    const res = await request(app).post(URL).send({});
    assert.equal(res.status, 500);
    assert.equal(res.body.error.message, "Couldn't send it. Try again.");
    assertNoPush(deps);
  });
});

describe('notifications/send: crew_nudge', () => {
  async function sendWith(prefs: any, type = 'crew_nudge') {
    const { createSendService } = await import('../lib/notifications/send.js');
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores: {
        notificationPrefs: { get: mock.fn(async () => prefs) },
        deviceTokens: {
          listByUser: mock.fn(async () => [{ token: 't'.repeat(40), platform: 'android' }]),
          unregister: mock.fn(async () => {}),
        },
        notificationCounts: { getByUser: mock.fn(async () => []), increment: mock.fn(async () => {}) },
        notificationLog: { insert: mock.fn(async () => null) },
      },
      config: { PUBLIC_ORIGIN: 'https://festie.us' },
      log: { info() {}, warn() {}, error() {}, debug() {} },
      messaging,
      retryQueue: { enqueue() {} },
    });
    return svc.send({ userId: 'u1', type, title: 'Crew', body: 'testuser is looking for you.', data: {} });
  }
  const QUIET = { dndStart: '00:00', dndEnd: '23:59' };

  test('is an allowed type and delivers when nudges are on', async () => {
    const { ALLOWED_NOTIFICATION_TYPES } = await import('../lib/notifications/payload.js');
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('crew_nudge'));
    assert.equal((await sendWith({ crewUpdates: 1, crewNudges: 1 })).sent, 1);
  });

  test('is filtered when the nudges switch is off', async () => {
    assert.equal((await sendWith({ crewUpdates: 1, crewNudges: 0 })).reason, 'user_disabled');
  });

  test('still sends when only the crew picks switch is off', async () => {
    assert.equal((await sendWith({ crewUpdates: 0, crewNudges: 1 })).sent, 1);
  });

  test('skips quiet hours, while crew_update stays held back', async () => {
    assert.equal((await sendWith({ crewUpdates: 1, crewNudges: 1, ...QUIET })).sent, 1);
    assert.equal((await sendWith({ crewUpdates: 1, crewNudges: 1, ...QUIET }, 'crew_update')).reason, 'dnd_active');
  });
});

describe('crew notifier: toUsers type', () => {
  test('sends the given type, and crew_update by default', async () => {
    const { createCrewNotifier } = await import('../lib/notifications/crew-notify.js');
    const send = mock.fn(async () => ({ sent: 1 }));
    const notifier = createCrewNotifier({
      stores: { crews: { getById: mock.fn(async () => ({ name: 'Crew' })) } },
      notificationService: { isConfigured: true, send },
      log: noopLog,
    });
    await notifier.toUsers({ crewId: 'c1', userIds: ['u2'], kind: 'member', type: 'crew_nudge', text: 'x' });
    await notifier.toUsers({ crewId: 'c1', userIds: ['u2'], kind: 'poll', text: 'y' });
    const types = (send.mock.calls as any[]).map((c) => c.arguments[0].type);
    assert.deepEqual(types, ['crew_nudge', 'crew_update']);
  });
});
