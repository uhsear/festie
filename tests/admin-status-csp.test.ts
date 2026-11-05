import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createAdminStatusRoutes from '../routes/admin-status.js';

test('GET /admin/status sends a nonce CSP that matches the inline style', async () => {
  const deps: any = {
    express,
    config: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
    setNoStore: (res: any) => res.setHeader('Cache-Control', 'no-store'),
    sendSuccess() {},
    sendError: (res: any, status: number) => res.status(status).end(),
    ErrorCodes: {},
    adminAuth: (_req: any, _res: any, next: any) => next(),
    io: { engine: { clientsCount: 0 } },
    state: { onlineUsers: new Set() },
    stores: { users: { countActive: async () => 0 } },
    getFestivals: async () => [],
    getProfiles: async () => [],
    metrics: undefined,
  };
  const app = express();
  app.use(createAdminStatusRoutes(deps).router);
  const res = await request(app).get('/admin/status');
  assert.equal(res.status, 200);
  const csp = String(res.headers['content-security-policy']);
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce, `no nonce in CSP: ${csp}`);
  assert.ok(res.text.includes(`<style nonce="${nonce}"`));
});
