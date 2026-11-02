import 'dotenv/config';
/**
 * Unit tests for routes/festival-discovery.ts with mocked deps (no database).
 * The SQL itself (privacy floor, deleted users and profiles, cascade) is covered
 * by tests/integration-festival-follows.test.ts, which needs TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createFestivalDiscoveryRoutes } from '../routes/festival-discovery';
import { schemas } from '../lib/schemas';
import { CO_PICK_MIN_USERS } from '../lib/constants';

function validateParams(schema: any) {
  return (req: any, res: any, next: any) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'bad params' });
    req.validatedParams = parsed.data;
    next();
  };
}

function build({
  publishedFestivals = new Set(['f1']),
  setsInFestival = new Set(['f1:s1']),
  coPicks = ['s2', 's3'] as string[],
  failStore = false,
} = {}) {
  const follows = new Map<string, string[]>();
  const calls = { alsoPicked: [] as any[], rateLimits: [] as any[] };
  const pool = {
    async query(sql: string, params: any[]) {
      if (sql.includes('FROM festivals WHERE id = $1')) {
        return { rows: publishedFestivals.has(params[0]) ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('festival_sets s')) {
        return { rows: setsInFestival.has(`${params[0]}:${params[1]}`) ? [{ '?column?': 1 }] : [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const deps: any = {
    log: { error() {}, warn() {}, info() {} },
    userAuth: (req: any, res: any, next: any) => {
      const userId = req.get('x-test-user');
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
      req.user = { userId };
      next();
    },
    rateLimit: (max: number, key: string) => {
      calls.rateLimits.push([max, key]);
      return (_req: any, _res: any, next: any) => next();
    },
    schemas,
    validateParams,
    sendSuccess: (res: any, data: any) => res.json({ success: true, data }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ success: false, error: message, code }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    stores: {
      pool,
      follows: {
        async list(userId: string) {
          if (failStore) throw new Error('db down');
          return [...(follows.get(userId) || [])].reverse();
        },
        async follow(userId: string, festivalId: string) {
          const ids = follows.get(userId) || [];
          if (!ids.includes(festivalId)) ids.push(festivalId);
          follows.set(userId, ids);
        },
        async unfollow(userId: string, festivalId: string) {
          follows.set(
            userId,
            (follows.get(userId) || []).filter((id) => id !== festivalId),
          );
        },
        async alsoPicked(festivalId: string, setId: string, minUsers: number) {
          calls.alsoPicked.push([festivalId, setId, minUsers]);
          if (failStore) throw new Error('db down');
          return coPicks;
        },
      },
    },
  };
  const app = express();
  app.use('/api/v1/festivals', createFestivalDiscoveryRoutes(deps));
  // Stand-in for festivalRoutes' GET /:id, mounted after, to prove mount order.
  app.get('/api/v1/festivals/:id', (req, res) => res.json({ success: true, data: { id: req.params.id } }));
  return { app, calls };
}

describe('festival follows routes', () => {
  test('PUT then GET lists the festival; PUT twice keeps one entry; DELETE twice is 200', async () => {
    const { app } = build();
    const put = await request(app).put('/api/v1/festivals/f1/follow').set('x-test-user', 'u1');
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.data, { festivalId: 'f1', following: true });

    const again = await request(app).put('/api/v1/festivals/f1/follow').set('x-test-user', 'u1');
    assert.equal(again.status, 200);

    const list = await request(app).get('/api/v1/festivals/follows').set('x-test-user', 'u1');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data, { festivalIds: ['f1'] });

    for (let i = 0; i < 2; i++) {
      const del = await request(app).delete('/api/v1/festivals/f1/follow').set('x-test-user', 'u1');
      assert.equal(del.status, 200);
      assert.deepEqual(del.body.data, { festivalId: 'f1', following: false });
    }
    const after = await request(app).get('/api/v1/festivals/follows').set('x-test-user', 'u1');
    assert.deepEqual(after.body.data, { festivalIds: [] });
  });

  test('PUT on a missing, deleted or draft festival is 404 NOT_FOUND', async () => {
    const { app } = build({ publishedFestivals: new Set() });
    const res = await request(app).put('/api/v1/festivals/draft-1/follow').set('x-test-user', 'u1');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Festival not found');
    assert.equal(res.body.code, 'NOT_FOUND');
  });

  test('DELETE does not check the festival, so a deleted festival can be unfollowed', async () => {
    const { app } = build({ publishedFestivals: new Set() });
    const res = await request(app).delete('/api/v1/festivals/gone/follow').set('x-test-user', 'u1');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { festivalId: 'gone', following: false });
  });

  test('follow routes need auth', async () => {
    const { app } = build();
    assert.equal((await request(app).get('/api/v1/festivals/follows')).status, 401);
    assert.equal((await request(app).put('/api/v1/festivals/f1/follow')).status, 401);
    assert.equal((await request(app).delete('/api/v1/festivals/f1/follow')).status, 401);
  });

  test('GET /:id still reaches the festival route mounted after', async () => {
    const { app } = build();
    const res = await request(app).get('/api/v1/festivals/f1');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { id: 'f1' });
  });

  test('a store error is a 500 INTERNAL_ERROR', async () => {
    const { app } = build({ failStore: true });
    const res = await request(app).get('/api/v1/festivals/follows').set('x-test-user', 'u1');
    assert.equal(res.status, 500);
    assert.equal(res.body.code, 'INTERNAL_ERROR');
  });

  test('rate limits match the contract', () => {
    const { calls } = build();
    assert.deepEqual(calls.rateLimits, [
      [30, 'festival-follow'],
      [120, 'festival-follow-read'],
      [120, 'festival-also-picked'],
    ]);
  });
});

describe('also-picked route', () => {
  test('returns set ids only, with a public cache header, and no auth', async () => {
    const { app, calls } = build();
    const res = await request(app).get('/api/v1/festivals/f1/sets/s1/also-picked');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { setIds: ['s2', 's3'] });
    assert.deepEqual(Object.keys(res.body.data), ['setIds']);
    assert.equal(res.headers['cache-control'], 'public, max-age=600');
    assert.deepEqual(calls.alsoPicked, [['f1', 's1', CO_PICK_MIN_USERS]]);
  });

  test('the privacy floor is 20 users', () => {
    assert.equal(CO_PICK_MIN_USERS, 20);
  });

  test('a set below the floor returns an empty list', async () => {
    const { app } = build({ coPicks: [] });
    const res = await request(app).get('/api/v1/festivals/f1/sets/s1/also-picked');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { setIds: [] });
  });

  test('a set not in that festival (or a draft/deleted festival) is 404 Set not found', async () => {
    const { app, calls } = build();
    const res = await request(app).get('/api/v1/festivals/f2/sets/s1/also-picked');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Set not found');
    assert.equal(res.body.code, 'NOT_FOUND');
    assert.equal(calls.alsoPicked.length, 0);
  });

  test('an over-long id is rejected by alsoPickedParams', async () => {
    const { app } = build();
    const res = await request(app).get(`/api/v1/festivals/${'x'.repeat(101)}/sets/s1/also-picked`);
    assert.equal(res.status, 400);
  });

  test('a store error is a 500 with no cache header', async () => {
    const { app } = build({ failStore: true });
    const res = await request(app).get('/api/v1/festivals/f1/sets/s1/also-picked');
    assert.equal(res.status, 500);
    assert.equal(res.headers['cache-control'], undefined);
  });
});
