/**
 * GET /admin/analytics/festivals/:festivalId/picks (routes/admin-status.ts),
 * with a mocked pool and festivals store. No database.
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createAdminStatusRoutes from '../routes/admin-status.js';

const FESTIVAL = {
  id: 'f1',
  name: 'Test Fest',
  stages: [{ id: 'main', name: 'Main' }, { id: 'forest', name: 'Forest' }],
  days: [
    {
      dayIndex: 0,
      label: 'Friday',
      date: '2026-06-05',
      sets: [
        { id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
        { id: 'set-b', artist: 'Beta', stageId: 'forest', startTime: '10:30', endTime: '11:30' },
        { id: 'set-c', artist: 'Gamma', stageId: 'main', startTime: '11:00', endTime: '12:00' },
        { id: 'set-tba', artist: 'Tba', stageId: 'gone', startTime: '', endTime: '' },
      ],
    },
    { dayIndex: 3, label: '', date: '', sets: [{ id: 'set-d', artist: 'Delta', stageId: 'forest', startTime: '10:00', endTime: '11:00' }] },
  ],
};

function queryMock(counts: any[] = [], pairs: any[] = []) {
  return mock.fn(async (sql: string, _params?: any[]) => {
    if (sql.includes('FILTER (WHERE fpp.priority')) return { rows: counts };
    if (sql.includes('HAVING COUNT(*) >=')) return { rows: pairs };
    throw new Error(`unexpected SQL: ${sql}`);
  });
}

function makeApp({ pool = { query: queryMock() } as any, festival = FESTIVAL as any, isAdmin = true } = {}) {
  const deps: any = {
    express,
    config: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
    setNoStore: (res: any) => res.setHeader('Cache-Control', 'no-store'),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, code } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    adminAuth: (_req: any, res: any, next: any) => (isAdmin ? next() : res.status(403).json({ data: null })),
    pool,
    stores: { festivals: { getById: mock.fn(async (id: string) => (id === festival?.id ? festival : null)) } },
  };
  const app = express();
  app.use(createAdminStatusRoutes(deps).router);
  return { app, deps };
}

const ROUTE = '/admin/analytics/festivals/f1/picks';

describe('GET /admin/analytics/festivals/:festivalId/picks', () => {
  test('returns every set with counts and only overlapping clashes', async () => {
    const pool = {
      query: queryMock(
        [{ setId: 'set-a', picks: 7, must: 3, want: 2, maybe: 1 }, { setId: 'set-orphan', picks: 9, must: 9, want: 0, maybe: 0 }],
        [
          { aId: 'set-a', bId: 'set-b', people: 6 },
          { aId: 'set-a', bId: 'set-c', people: 8 },
          { aId: 'set-a', bId: 'set-orphan', people: 9 },
        ],
      ),
    };
    const { app } = makeApp({ pool });
    const res = await request(app).get(ROUTE).expect(200);
    assert.equal(res.headers['cache-control'], 'no-store');
    const data = res.body.data;
    assert.equal(data.festivalId, 'f1');
    assert.equal(data.festivalName, 'Test Fest');
    assert.equal(data.minPairPeople, 5);
    assert.ok(data.generatedAt);
    assert.deepEqual(data.sets.map((s: any) => s.setId), ['set-a', 'set-b', 'set-c', 'set-tba', 'set-d']);
    assert.deepEqual(data.sets[0], {
      setId: 'set-a', dayIndex: 0, dayLabel: 'Friday', date: '2026-06-05', stageName: 'Main', artist: 'Alpha',
      startTime: '10:00', endTime: '11:00', picks: 7, must: 3, want: 2, maybe: 1,
    });
    assert.deepEqual(data.sets[3], {
      setId: 'set-tba', dayIndex: 0, dayLabel: 'Friday', date: '2026-06-05', stageName: '', artist: 'Tba',
      startTime: null, endTime: null, picks: 0, must: 0, want: 0, maybe: 0,
    });
    assert.equal(data.sets[4].dayLabel, 'Day 2');
    assert.equal(data.sets[4].dayIndex, 3);
    assert.deepEqual(data.clashes, [{ aSetId: 'set-a', bSetId: 'set-b', people: 6 }]);

    const calls = pool.query.mock.calls;
    const pairCall = calls.find((c: any) => c.arguments[0].includes('HAVING COUNT(*) >='))!;
    assert.deepEqual(pairCall.arguments[1], ['f1', 5]);
    const countCall = calls.find((c: any) => c.arguments[0].includes('FILTER (WHERE fpp.priority'))!;
    assert.deepEqual(countCall.arguments[1], ['f1']);
  });

  test('a festival with sets but no picks returns zero counts and no clashes', async () => {
    const { app } = makeApp();
    const res = await request(app).get(ROUTE).expect(200);
    assert.equal(res.body.data.sets.length, 5);
    assert.ok(res.body.data.sets.every((s: any) => s.picks === 0 && s.must === 0 && s.want === 0 && s.maybe === 0));
    assert.deepEqual(res.body.data.clashes, []);
  });

  test('an unknown festival gives 404', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/admin/analytics/festivals/nope/picks').expect(404);
    assert.equal(res.body.error.message, 'Festival not found.');
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('no pool gives 503', async () => {
    const { app } = makeApp({ pool: null });
    const res = await request(app).get(ROUTE).expect(503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(res.body.error.message, 'Database not available');
  });

  test('a 101-character festival id gives 400', async () => {
    const { app, deps } = makeApp();
    const res = await request(app).get(`/admin/analytics/festivals/${'x'.repeat(101)}/picks`).expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(deps.stores.festivals.getById.mock.callCount(), 0);
  });

  test('a query error gives 500', async () => {
    const pool = { query: mock.fn(async () => { throw new Error('boom'); }) };
    const { app } = makeApp({ pool });
    const res = await request(app).get(ROUTE).expect(500);
    assert.equal(res.body.error.message, 'Failed to load pick insight');
  });

  test('a non-admin gets 403 before any query', async () => {
    const pool = { query: queryMock() };
    const { app } = makeApp({ pool, isAdmin: false });
    await request(app).get(ROUTE).expect(403);
    assert.equal(pool.query.mock.callCount(), 0);
  });
});
