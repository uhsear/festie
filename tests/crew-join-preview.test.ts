/**
 * Mock-based tests for GET /join-preview/:inviteCode in routes/crews.ts.
 * Public (no auth) route: returns only crew name, owner name, member count and expiry.
 * No database required.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';
import { crewInviteCodeParams } from '../lib/schemas.js';

const noop = () => {};
const EXPIRY = '2026-12-01T00:00:00.000Z';

async function buildApp(opts: { crew?: any; expired?: any; members?: any[]; rateCalls?: any[]; throws?: boolean } = {}) {
  const crews = {
    getByInviteCode: mock.fn(async () => {
      if (opts.throws) throw new Error('db down');
      return opts.crew ?? null;
    }),
    getExpiredByInviteCode: mock.fn(async () => opts.expired ?? null),
    getMembers: mock.fn(async () => opts.members ?? []),
  };
  const passThrough = (_req: any, _res: any, next: any) => next();
  const deps: any = {
    express,
    config: { NODE_ENV: 'test' },
    log: { info: noop, warn: noop, error: noop, debug: noop },
    userAuth: (_req: any, res: any) => res.status(401).json({ error: 'auth should not run' }),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, message: any, code: any) =>
      res.status(status).json({ data: null, error: { message, status, code } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    rateLimit: (max: any, key: any) => {
      opts.rateCalls?.push({ max, key });
      return passThrough;
    },
    // Real Zod schema so the param shape is exercised, not stubbed.
    validateParams: (schema: any) => (req: any, res: any, next: any) => {
      const parsed = schema.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ data: null, error: { status: 400 } });
      req.validatedParams = parsed.data;
      next();
    },
    validate: () => passThrough,
    validateQuery: () => passThrough,
    schemas: { crewInviteCodeParams },
    stores: { crews },
    pool: { query: async () => ({ rows: [] }) },
  };
  const { default: createCrewRoutes } = await import('../routes/crews.js');
  const app = express();
  app.use('/', createCrewRoutes(deps));
  return { app, crews };
}

const CREW = { id: 'c1', name: 'Bass Gang', inviteExpiresAt: EXPIRY };

describe('routes/crews.ts — GET /join-preview/:inviteCode', () => {
  test('returns only crew name, owner name, member count and expiry without auth', async () => {
    const { app } = await buildApp({
      crew: CREW,
      members: [
        { userId: 'u1', role: 'owner', username: 'dj', name: 'DJ Dana' },
        { userId: 'u2', role: 'member', username: 'x', name: 'X' },
      ],
    });
    const res = await request(app).get('/join-preview/abc123');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { crewName: 'Bass Gang', ownerName: 'DJ Dana', memberCount: 2, expiresAt: EXPIRY });
  });

  test('falls back to the owner username when there is no display name', async () => {
    const { app } = await buildApp({ crew: CREW, members: [{ userId: 'u1', role: 'owner', username: 'dj', name: null }] });
    const res = await request(app).get('/join-preview/ABC123');
    assert.equal(res.body.data.ownerName, 'dj');
  });

  test('looks the code up upper-cased', async () => {
    const { app, crews } = await buildApp({ crew: CREW, members: [] });
    await request(app).get('/join-preview/abc123');
    assert.equal((crews.getByInviteCode.mock.calls[0] as any).arguments[0], 'ABC123');
  });

  test('404 for an unknown code, 410 for an expired one', async () => {
    const unknown = await request((await buildApp()).app).get('/join-preview/NOPE99');
    assert.equal(unknown.status, 404);
    const expired = await request((await buildApp({ expired: { id: 'c1' } })).app).get('/join-preview/OLD123');
    assert.equal(expired.status, 410);
  });

  test('rejects a malformed code before touching the store', async () => {
    const { app, crews } = await buildApp({ crew: CREW });
    const res = await request(app).get('/join-preview/AB-C!23');
    assert.equal(res.status, 400);
    assert.equal(crews.getByInviteCode.mock.callCount(), 0);
  });

  test('is rate-limited', async () => {
    const rateCalls: any[] = [];
    const { app } = await buildApp({ crew: CREW, rateCalls });
    await request(app).get('/join-preview/ABC123');
    assert.ok(rateCalls.some((c) => c.key === 'crew-join-preview' && c.max === 30));
  });

  test('500 when the store throws', async () => {
    const { app } = await buildApp({ throws: true });
    const res = await request(app).get('/join-preview/ABC123');
    assert.equal(res.status, 500);
  });
});
