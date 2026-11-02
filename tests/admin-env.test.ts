import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createAdminStatusRoutes from '../routes/admin-status.js';
import { loadConfig } from '../lib/config.js';

function makeApp(label: string | undefined, isAdmin = true) {
  const deps: any = {
    express,
    config: { FESTIE_ENV_LABEL: label },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    setNoStore: (res: any) => res.setHeader('Cache-Control', 'no-store'),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, msg: string) => res.status(status).json({ data: null, error: { message: msg } }),
    ErrorCodes: {},
    adminAuth: (_req: any, res: any, next: any) => (isAdmin ? next() : res.status(403).json({ data: null })),
  };
  const app = express();
  app.use(createAdminStatusRoutes(deps).router);
  return app;
}

describe('GET /admin/env', () => {
  test('returns the label when set', async () => {
    const res = await request(makeApp('STAGING')).get('/admin/env');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { label: 'STAGING' });
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  test('returns null when the label is empty', async () => {
    const res = await request(makeApp('')).get('/admin/env');
    assert.deepEqual(res.body.data, { label: null });
  });

  test('non-admin gets 403', async () => {
    const res = await request(makeApp('STAGING', false)).get('/admin/env');
    assert.equal(res.status, 403);
  });
});

describe('FESTIE_ENV_LABEL config', () => {
  test('is trimmed, upper-cased and capped at 20 chars', () => {
    assert.equal(loadConfig({ FESTIE_ENV_LABEL: ' staging ' } as any).FESTIE_ENV_LABEL, 'STAGING');
    assert.equal(loadConfig({ FESTIE_ENV_LABEL: 'x'.repeat(30) } as any).FESTIE_ENV_LABEL.length, 20);
  });
});
