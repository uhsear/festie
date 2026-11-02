/**
 * Mock-store route tests for routes/crew-days.ts (090).
 *
 * Covers GET and PUT /:crewId/days. Validation uses the real Zod schemas and
 * middleware from lib/schemas.ts, so the 400s are the ones clients see. The
 * crew-days store is an in-memory fake keyed like the table.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

import { schemas, validate, validateParams } from '../lib/schemas.js';

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };

function makeApp(over: { member?: boolean; dayCount?: number; userId?: string } = {}) {
  const emit = mock.fn(() => {});
  const io = { to: mock.fn(() => ({ emit })) };
  const rows = new Map<string, Array<{ userId: string; dayIndex: number; answer: string }>>();
  const crewDays = {
    listByCrew: mock.fn(async () =>
      [...rows.values()].flat().sort((a, b) => a.userId.localeCompare(b.userId) || a.dayIndex - b.dayIndex),
    ),
    replaceMine: mock.fn(async (_crewId: string, userId: string, days: any[]) => {
      const mine = days
        .map((d) => ({ userId, dayIndex: d.dayIndex, answer: d.answer }))
        .sort((a, b) => a.dayIndex - b.dayIndex);
      if (mine.length) rows.set(userId, mine);
      else rows.delete(userId);
      return mine;
    }),
    dayCount: mock.fn(async () => over.dayCount ?? 3),
  };
  const deps = {
    log: noopLog,
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: over.userId ?? 'user-1', username: 'testuser' };
      next();
    },
    sanitizeIdentifier: (s: any) => (typeof s === 'string' ? s.trim() : ''),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) =>
      res.status(status).json({ data: null, error: { message: msg, status, code } }),
    ErrorCodes: { FORBIDDEN: 'FORBIDDEN', VALIDATION_ERROR: 'VALIDATION_ERROR', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    validate,
    validateParams,
    schemas,
    io,
    stores: {
      crews: { getMember: mock.fn(async () => (over.member === false ? null : { role: 'member' })) },
      crewDays,
    },
  };
  return { deps, emit, io, crewDays };
}

async function build(over: Parameters<typeof makeApp>[0] = {}) {
  const made = makeApp(over);
  const { default: createRoutes } = await import('../routes/crew-days.js');
  const app = express();
  app.use(express.json());
  app.use('/', createRoutes(made.deps));
  return { app, ...made };
}

describe('routes/crew-days.ts', () => {
  test('PUT then GET returns the same rows, and the PUT emits crew:days-updated', async () => {
    const { app, io, emit } = await build();
    const body = {
      days: [
        { dayIndex: 2, answer: 'no' },
        { dayIndex: 0, answer: 'going' },
      ],
    };
    const put = await request(app).put('/crew-1/days').send(body);
    assert.equal(put.status, 200);
    const expected = [
      { userId: 'user-1', dayIndex: 0, answer: 'going' },
      { userId: 'user-1', dayIndex: 2, answer: 'no' },
    ];
    assert.deepEqual(put.body.data.days, expected);

    const get = await request(app).get('/crew-1/days');
    assert.equal(get.status, 200);
    assert.deepEqual(get.body.data.days, expected);

    assert.equal((io.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    const [event, payload] = (emit.mock.calls as any[])[0].arguments;
    assert.equal(event, 'crew:days-updated');
    assert.deepEqual(payload, { crewId: 'crew-1', userId: 'user-1', days: expected });
  });

  test('PUT { days: [] } clears my answers', async () => {
    const { app } = await build();
    await request(app)
      .put('/crew-1/days')
      .send({ days: [{ dayIndex: 1, answer: 'maybe' }] });
    const cleared = await request(app).put('/crew-1/days').send({ days: [] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.data.days, []);
    const get = await request(app).get('/crew-1/days');
    assert.deepEqual(get.body.data.days, []);
  });

  test('the same body twice leaves the same rows', async () => {
    const { app } = await build();
    const body = { days: [{ dayIndex: 1, answer: 'going' }] };
    const first = await request(app).put('/crew-1/days').send(body);
    const second = await request(app).put('/crew-1/days').send(body);
    assert.deepEqual(second.body.data.days, first.body.data.days);
  });

  test('a repeated dayIndex is 400', async () => {
    const { app, crewDays } = await build();
    const res = await request(app)
      .put('/crew-1/days')
      .send({
        days: [
          { dayIndex: 1, answer: 'going' },
          { dayIndex: 1, answer: 'no' },
        ],
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.message, 'Each day can appear only once.');
    assert.equal(crewDays.replaceMine.mock.callCount(), 0);
  });

  test('an unknown answer or a dayIndex above 60 is 400', async () => {
    const { app } = await build();
    const bad = await request(app)
      .put('/crew-1/days')
      .send({ days: [{ dayIndex: 0, answer: 'yes' }] });
    assert.equal(bad.status, 400);
    const big = await request(app)
      .put('/crew-1/days')
      .send({ days: [{ dayIndex: 61, answer: 'going' }] });
    assert.equal(big.status, 400);
  });

  test('a dayIndex equal to the day count is 400', async () => {
    const { app, crewDays } = await build({ dayCount: 3 });
    const res = await request(app)
      .put('/crew-1/days')
      .send({ days: [{ dayIndex: 3, answer: 'going' }] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.message, 'That day is not part of this festival.');
    assert.equal(crewDays.replaceMine.mock.callCount(), 0);
    const last = await request(app)
      .put('/crew-1/days')
      .send({ days: [{ dayIndex: 2, answer: 'going' }] });
    assert.equal(last.status, 200);
  });

  test('a non-member gets 403 on GET and PUT', async () => {
    const { app, crewDays } = await build({ member: false });
    const get = await request(app).get('/crew-1/days');
    assert.equal(get.status, 403);
    assert.equal(get.body.error.code, 'FORBIDDEN');
    assert.equal(get.body.error.message, 'Not a crew member');
    const put = await request(app).put('/crew-1/days').send({ days: [] });
    assert.equal(put.status, 403);
    assert.equal(crewDays.listByCrew.mock.callCount(), 0);
    assert.equal(crewDays.replaceMine.mock.callCount(), 0);
  });

  test("PUT writes only the caller's rows", async () => {
    const { app, crewDays } = await build({ userId: 'user-9' });
    await request(app)
      .put('/crew-1/days')
      .send({ days: [{ dayIndex: 0, answer: 'going' }] });
    const args = (crewDays.replaceMine.mock.calls as any[])[0].arguments;
    assert.equal(args[0], 'crew-1');
    assert.equal(args[1], 'user-9');
  });
});
