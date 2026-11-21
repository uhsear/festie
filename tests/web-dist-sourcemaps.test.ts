process.env.REDIS_ENABLED = 'false';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import express from 'express';
import request from 'supertest';

import { configureMiddleware } from '../lib/middleware.js';
import { sendError, ErrorCodes } from '../lib/response.js';

let PUBLIC_DIR = '';
let WEB_DIST = '';
before(() => {
  PUBLIC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-webdist-'));
  WEB_DIST = path.join(PUBLIC_DIR, 'web-dist');
  fs.mkdirSync(path.join(PUBLIC_DIR, 'uploads', 'basemaps'), { recursive: true });
  fs.mkdirSync(path.join(WEB_DIST, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(WEB_DIST, 'assets', 'index-a.js'), 'console.log(1);');
  fs.writeFileSync(path.join(WEB_DIST, 'assets', 'index-a.js.map'), '{}');
});
after(() => fs.rmSync(PUBLIC_DIR, { recursive: true, force: true }));

function makeApp() {
  const app = express();
  configureMiddleware(app as any, {
    express,
    config: {
      TRUST_PROXY: false,
      PUBLIC_ORIGIN: '',
      NODE_ENV: 'production',
      PUBLIC_DIR,
      WEB_DIST,
      JSON_LIMIT: '1mb',
      API_VERSION: '1',
      REQUEST_TIMEOUT_MS: 10_000,
      MOBILE_ORIGINS: [],
      PROFILE_RATE_LIMIT_MAX: 100,
      OVERLAP_RATE_LIMIT_MAX: 100,
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    state: {
      metrics: { totalRequests: 0, totalDuration: 0, requestCount: 0, totalErrors: 0, statusCodes: {}, endpointLatency: {} },
      timers: [],
    },
    contentSecurityPolicy: "default-src 'self'",
    enforceAllowedOrigin: (_req: any, _res: any, next: any) => next(),
    avatarDirPath: () => path.join(PUBLIC_DIR, 'uploads', 'avatars'),
    isAllowedOrigin: () => false,
    setNoStore: () => {},
    getRequestIp: (req: any) => req.ip || '127.0.0.1',
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    authRateLimit: (_req: any, _res: any, next: any) => next(),
    sendError,
    ErrorCodes,
    generateOpenAPISpec: () => ({}),
    stores: { auditLog: { insert: async () => {} } },
  } as any);
  return app;
}

describe('web dist static files', () => {
  it('serves hashed assets', async () => {
    const res = await request(makeApp()).get('/assets/index-a.js');
    assert.equal(res.status, 200);
  });

  it('refuses source maps even when one is left in dist', async () => {
    assert.ok(fs.existsSync(path.join(WEB_DIST, 'assets', 'index-a.js.map')));
    const res = await request(makeApp()).get('/assets/index-a.js.map');
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.headers['cache-control'] ?? '', /immutable/);
  });
});
