/**
 * Admin reset-link and admin crew-delete need a recent password (T57 P5).
 * No DB: the routers mount on stub deps. A stub `requireRecentAuth` stands in for
 * the real gate; its own behavior is covered by the session tests.
 */
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

const pass = (_req: any, _res: any, next: any) => next();

function makeDeps(recent: { ok: boolean }) {
  const insert = mock.fn(async () => {});
  const query = mock.fn(async () => ({ rows: [] }));
  const del = mock.fn(async () => {});
  const deps: any = {
    config: { PUBLIC_ORIGIN: 'http://localhost:3000', RESET_TOKEN_TTL: 3600000 },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, code } }),
    ErrorCodes: { INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    adminAuth: pass,
    validate: () => pass,
    validateQuery: () => pass,
    validateParams: () => (req: any, _res: any, next: any) => {
      req.validatedParams = req.params;
      next();
    },
    schemas: {},
    setNoStore: () => {},
    sanitizeIdentifier: (s: any) => (s ? String(s) : null),
    createAuditLog: (action: string) => ({ action }),
    getRequestIp: () => '127.0.0.1',
    getUserById: async () => ({ id: 'user-2', username: 'bob' }),
    requireRecentAuth: (_req: any, res: any, next: any) =>
      recent.ok ? next() : res.status(403).json({ data: null, error: { code: 'REAUTH_REQUIRED' } }),
    state: { _adminResetTokens: new Map() },
    stores: {
      pool: { query },
      auditLog: { insert },
      crews: { getById: async () => ({ id: 'crew-1', name: 'Crew', festivalId: 'f1' }), delete: del },
    },
  };
  return { deps, insert, query, del };
}

async function build(recent: { ok: boolean }) {
  const { default: mountUsers } = await import('../routes/admin-users.js');
  const { default: mountBulk } = await import('../routes/admin-bulk.js');
  const { deps, ...spies } = makeDeps(recent);
  const router = express.Router();
  const ctx = { adminWriteLimit: pass, passwordResetRateLimit: pass, crypto };
  mountUsers({ router, deps, ctx });
  mountBulk({ router, deps, ctx });
  const app = express();
  app.use(express.json());
  app.use(router);
  return { app, ...spies };
}

describe('admin reauth gates', () => {
  test('reset-link answers 403 REAUTH_REQUIRED and writes nothing without a recent password', async () => {
    const recent = { ok: false };
    const { app, insert, query } = await build(recent);
    const res = await request(app).post('/users/user-2/reset-link').expect(403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
    assert.equal(query.mock.callCount(), 0);
    assert.equal(insert.mock.callCount(), 0);
    recent.ok = true;
    const ok = await request(app).post('/users/user-2/reset-link').expect(200);
    assert.match(ok.body.data.resetUrl, /\/reset\//);
    assert.equal(query.mock.callCount(), 1);
    assert.equal(insert.mock.callCount(), 1);
  });

  test('admin crew delete answers 403 REAUTH_REQUIRED and deletes nothing without a recent password', async () => {
    const recent = { ok: false };
    const { app, insert, del } = await build(recent);
    const res = await request(app).delete('/crews/crew-1').expect(403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
    assert.equal(del.mock.callCount(), 0);
    assert.equal(insert.mock.callCount(), 0);
    recent.ok = true;
    await request(app).delete('/crews/crew-1').expect(200);
    assert.equal(del.mock.callCount(), 1);
    assert.equal(insert.mock.callCount(), 1);
  });
});
