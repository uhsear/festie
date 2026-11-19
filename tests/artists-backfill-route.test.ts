/**
 * POST /api/v1/admin/artists/backfill on stub deps. No database: the three backfill steps are mocks.
 * The real adminAuth, requireRecentAuth and the Zod validator are covered elsewhere; these stubs
 * answer with the same statuses.
 */
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { planHash } from '../lib/artist-backfill.js';
import { artistBackfillSchema } from '../lib/schemas.js';

const pass = (_req: any, _res: any, next: any) => next();

async function build(opts: { locked?: boolean; applyFails?: boolean; unlockFails?: boolean } = {}) {
  const calls: string[] = [];
  const plan = { report: { counts: { sets: 2 } } };
  const result = { runId: 'abr_1', festivalsWritten: ['f1'], festivalsSkipped: [], artistsCreated: 3, conflicts: [] };
  const lockQuery = mock.fn(async (sql: string) => {
    calls.push(sql.includes('pg_try') ? 'lock' : 'unlock');
    if (opts.unlockFails && sql.includes('unlock')) throw new Error('connection lost');
    return { rows: [{ locked: opts.locked ?? true }] };
  });
  const release = mock.fn((_destroy?: boolean) => {});
  const insert = mock.fn(async (_row: any) => {});
  const state = { recent: false };
  const artistBackfill = {
    planBackfill: mock.fn(async () => (calls.push('plan'), plan)),
    applyBackfillPlan: mock.fn(async (_pool: any, _plan: any, _options: any) => {
      calls.push('apply');
      if (opts.applyFails) throw Object.assign(new Error('relation "artists" does not exist: INSERT INTO artists'), { code: '42P01' });
      return result;
    }),
    verifyBackfill: mock.fn(async () => ({ ok: false, checks: [], skipped: [] })),
  };
  const deps: any = {
    express,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    rateLimit: () => pass,
    validate: (schema: any) => (req: any, res: any, next: any) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR' } });
      req.validatedBody = parsed.data;
      next();
    },
    validateQuery: () => pass,
    validateParams: () => pass,
    schemas: { artistBackfill: artistBackfillSchema },
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string, details?: object) =>
      res.status(status).json({ data: null, error: { message, code, ...details } }),
    ErrorCodes: {
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
      PLAN_CHANGED: 'PLAN_CHANGED',
      REAUTH_REQUIRED: 'REAUTH_REQUIRED',
    },
    getRequestIp: () => '127.0.0.1',
    requireRecentAuth: (_req: any, res: any, next: any) =>
      state.recent ? next() : res.status(403).json({ data: null, error: { code: 'REAUTH_REQUIRED' } }),
    invalidateFestivalCache: mock.fn(() => calls.push('cache')),
    invalidateFestivalListCache: mock.fn(),
    setNoStore: (res: any) => res.setHeader('Cache-Control', 'no-store'),
    config: {},
    emitter: {},
    artistBackfill,
    stores: { pool: { connect: async () => ({ query: lockQuery, release }) }, auditLog: { insert } },
  };
  const { default: createArtistsRoutes } = await import('../routes/artists.js');
  const app = express();
  app.use(express.json());
  // Stub adminAuth: no header is 401, header "user" is 403, header "admin" passes.
  app.use(
    '/api/v1/admin/artists',
    (req: any, res: any, next: any) => {
      const who = req.get('x-who');
      if (!who) return res.status(401).json({ error: { code: 'AUTH_REQUIRED' } });
      if (who !== 'admin') return res.status(403).json({ error: { code: 'FORBIDDEN' } });
      req.user = { userId: 'u1' };
      next();
    },
    createArtistsRoutes(deps),
  );
  const post = (body: unknown, who = 'admin') => request(app).post('/api/v1/admin/artists/backfill').set('x-who', who).send(body as object);
  return { app, post, state, calls, artistBackfill, insert, release, lockQuery, deps };
}

describe('POST /admin/artists/backfill', () => {
  test('401 without a session, 403 for a non-admin', async () => {
    const { app, post } = await build();
    await request(app).post('/api/v1/admin/artists/backfill').send({ mode: 'dry-run' }).expect(401);
    await post({ mode: 'dry-run' }, 'user').expect(403);
  });

  test('400 for a missing or unknown mode, and nothing runs', async () => {
    const { post, artistBackfill } = await build();
    await post({ mode: 'nuke' }).expect(400);
    await post({}).expect(400);
    assert.equal(artistBackfill.planBackfill.mock.callCount(), 0);
  });

  test('dry-run plans, never applies, never locks or audits', async () => {
    const { post, artistBackfill, insert, lockQuery } = await build();
    const res = await post({ mode: 'dry-run' }).expect(200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.body.data.report, { counts: { sets: 2 } });
    assert.equal(res.body.data.planHash, planHash({ counts: { sets: 2 } } as any));
    assert.equal(artistBackfill.planBackfill.mock.callCount(), 1);
    assert.equal(artistBackfill.applyBackfillPlan.mock.callCount(), 0);
    assert.equal(lockQuery.mock.callCount(), 0);
    assert.equal(insert.mock.callCount(), 0);
  });

  test('verify answers 200 with ok false in the data', async () => {
    const { post } = await build();
    const res = await post({ mode: 'verify' }).expect(200);
    assert.equal(res.body.data.result.ok, false);
  });

  test('run without a recent re-auth is 403 REAUTH_REQUIRED and touches nothing', async () => {
    const { post, artistBackfill, lockQuery } = await build();
    const res = await post({ mode: 'run' }).expect(403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
    assert.equal(artistBackfill.planBackfill.mock.callCount(), 0);
    assert.equal(lockQuery.mock.callCount(), 0);
  });

  test('run locks, plans, applies, clears the caches, audits once and unlocks', async () => {
    const { post, state, calls, insert, release } = await build();
    state.recent = true;
    const res = await post({ mode: 'run' }).expect(200);
    assert.equal(res.body.data.result.artistsCreated, 3);
    assert.deepEqual(calls, ['lock', 'plan', 'apply', 'cache', 'unlock']);
    assert.equal(release.mock.calls[0]!.arguments[0], false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(insert.mock.callCount(), 1);
    const row = insert.mock.calls[0]!.arguments[0];
    assert.equal(row.action, AUDIT_ACTIONS.ARTIST_BACKFILL_RUN);
    assert.equal(JSON.parse(row.detailsJson).counts.sets, 2);
    assert.equal(row.targetType, 'artist_backfill');
    assert.equal(JSON.parse(row.detailsJson).status, 'completed');
  });

  test('run passes its own runId to apply and uses it for the audit row', async () => {
    const { post, state, artistBackfill, insert } = await build();
    state.recent = true;
    await post({ mode: 'run' }).expect(200);
    const runId = artistBackfill.applyBackfillPlan.mock.calls[0]!.arguments[2].runId;
    assert.match(runId, /^abr/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(insert.mock.calls[0]!.arguments[0].targetId, runId);
  });

  test('run with the reviewed planHash applies, and a different hash is 409 PLAN_CHANGED with nothing applied', async () => {
    const { post, state, artistBackfill, release } = await build();
    state.recent = true;
    const good = planHash({ counts: { sets: 2 } } as any);
    await post({ mode: 'run', planHash: good }).expect(200);
    assert.equal(artistBackfill.applyBackfillPlan.mock.callCount(), 1);
    const res = await post({ mode: 'run', planHash: 'a'.repeat(64) }).expect(409);
    assert.equal(res.body.error.code, 'PLAN_CHANGED');
    assert.equal(artistBackfill.applyBackfillPlan.mock.callCount(), 1);
    assert.equal(release.mock.callCount(), 2);
    await post({ mode: 'run', planHash: 'not-a-hash' }).expect(400);
  });

  test('apply throws: 500 with the runId and no SQL text, caches cleared, one failed audit row, lock released', async () => {
    const { post, state, calls, insert, release, deps } = await build({ applyFails: true });
    state.recent = true;
    const res = await post({ mode: 'run' }).expect(500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(res.body), /INSERT|relation|artists"/);
    const runId = res.body.error.runId;
    assert.match(runId, /^abr/);
    assert.deepEqual(calls, ['lock', 'plan', 'apply', 'cache', 'unlock']);
    assert.equal(deps.invalidateFestivalListCache.mock.callCount(), 1);
    assert.equal(release.mock.calls[0]!.arguments[0], false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(insert.mock.callCount(), 1);
    const row = insert.mock.calls[0]!.arguments[0];
    assert.equal(row.targetId, runId);
    assert.deepEqual({ status: JSON.parse(row.detailsJson).status, error: JSON.parse(row.detailsJson).error }, { status: 'failed', error: '42P01' });
  });

  test('a failed unlock destroys the connection instead of pooling it', async () => {
    const { post, state, release } = await build({ unlockFails: true });
    state.recent = true;
    await post({ mode: 'run' }).expect(200);
    assert.equal(release.mock.calls[0]!.arguments[0], true);
  });

  test('a second run while the lock is held is 409 and applies nothing', async () => {
    const { post, state, artistBackfill, calls } = await build({ locked: false });
    state.recent = true;
    await post({ mode: 'run' }).expect(409);
    assert.equal(artistBackfill.applyBackfillPlan.mock.callCount(), 0);
    assert.deepEqual(calls, ['lock']);
  });
});
