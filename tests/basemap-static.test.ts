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
before(() => {
  PUBLIC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-basemap-'));
  fs.mkdirSync(path.join(PUBLIC_DIR, 'uploads', 'basemaps'), { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'uploads', 'basemaps', 'edc.pmtiles'), Buffer.alloc(4096, 7));
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
      WEB_DIST: path.join(PUBLIC_DIR, '__no-build__'),
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

describe('offline basemap static files', () => {
  it('answers a Range preflight from an opaque (null) origin', async () => {
    const res = await request(makeApp())
      .options('/uploads/basemaps/edc.pmtiles')
      .set('Origin', 'null')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'range');
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.match(res.headers['access-control-allow-headers'] ?? '', /Range/);
  });

  it('still refuses a preflight from an unlisted origin elsewhere', async () => {
    const res = await request(makeApp()).options('/api/v1/festivals').set('Origin', 'null');
    assert.equal(res.status, 403);
  });

  it('serves byte ranges and forbids proxy re-encoding', async () => {
    const res = await request(makeApp()).get('/uploads/basemaps/edc.pmtiles').set('Range', 'bytes=0-99');
    assert.equal(res.status, 206);
    assert.equal(res.headers['content-range'], 'bytes 0-99/4096');
    const cacheControl = res.headers['cache-control'] ?? '';
    assert.match(cacheControl, /no-transform/);
    assert.match(cacheControl, /immutable/);
  });
});
