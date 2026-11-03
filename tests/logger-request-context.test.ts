process.env.REDIS_ENABLED = 'false';

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import express from 'express';
import pino from 'pino';
import request from 'supertest';

import { configureMiddleware } from '../lib/middleware.js';
import { createLogger, getPinoRoot, getRequestContext } from '../lib/logger.js';
import { sendError, ErrorCodes } from '../lib/response.js';
import { createFestieApp } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Every logger shares the pino root's stream (children inherit it), so swapping it
// captures the real JSON lines in-process.
const lines: any[] = [];
let restoreStream = () => {};
before(() => {
  const root = getPinoRoot();
  assert.ok(root, 'pino must be available for these tests');
  const sym = pino.symbols.streamSym as any;
  const original = root[sym];
  root[sym] = { write: (s: string) => { lines.push(JSON.parse(s)); } };
  restoreStream = () => { root[sym] = original; };
});
after(() => restoreStream());

function makeApp() {
  const app = express();
  configureMiddleware(app as any, {
    express,
    config: {
      TRUST_PROXY: false,
      PUBLIC_ORIGIN: '',
      NODE_ENV: 'production', // skips OpenAPI/Swagger UI mounting
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
  const log = createLogger('ctx-test');
  app.post('/api/v1/echo', async (req: any, res: any) => {
    await new Promise((r) => setTimeout(r, Number(req.body.delayMs) || 1));
    log.warn('x', { marker: req.body.marker });
    res.json({ ok: true });
  });
  return app;
}

function lineFor(marker: string) {
  return lines.find((l) => l.msg === 'x' && l.marker === marker);
}

describe('logger: request context', () => {
  it('is undefined outside a request', () => {
    assert.equal(getRequestContext(), undefined);
  });

  it('a JSON POST logs with the same reqId as X-Request-Id after an await', async () => {
    const res = await request(makeApp()).post('/api/v1/echo').send({ marker: 'one', delayMs: 5 });
    assert.equal(res.status, 200);
    const line = lineFor('one');
    assert.ok(line, 'log line captured');
    assert.equal(line.reqId, res.headers['x-request-id']);
    assert.equal(line.traceId, res.headers['x-trace-id']);
  });

  it('two concurrent requests never swap ids', async () => {
    const app = makeApp();
    const [slow, fast] = await Promise.all([
      request(app).post('/api/v1/echo').send({ marker: 'slow', delayMs: 40 }),
      request(app).post('/api/v1/echo').send({ marker: 'fast', delayMs: 2 }),
    ]);
    assert.notEqual(slow.headers['x-request-id'], fast.headers['x-request-id']);
    assert.equal(lineFor('slow').reqId, slow.headers['x-request-id']);
    assert.equal(lineFor('fast').reqId, fast.headers['x-request-id']);
  });
});

describe('server error handler: production 5xx', () => {
  let result: any;

  before(async () => {
    result = await createFestieApp({
      // Port 9 (discard) and a _test name: nothing connects and the boot migration runner stays off.
      DATABASE_URL: 'postgresql://127.0.0.1:9/festie_test',
      REDIS_ENABLED: false,
      NODE_ENV: 'production',
      PUBLIC_ORIGIN: 'http://localhost:3000',
      SESSION_SECRET: 'logger-request-context-test-secret',
      FIREBASE_CREDENTIALS_PATH: '',
    });
    // Move a throwing route to just after the request-context middleware, ahead of the SPA catch-all.
    result.app.get('/__boom', () => {
      throw new Error('boom for stack test');
    });
    const stack = result.app.router.stack;
    const at = stack.findIndex((l: any) => String(l.handle).includes('runWithRequestContext'));
    assert.ok(at >= 0, 'request-context middleware is mounted');
    stack.splice(at + 1, 0, stack.pop());
  });

  after(async () => {
    await result?.close?.().catch(() => {});
  });

  it('logs the stack on the first occurrence of a 500', async () => {
    const res = await request(result.app).get('/__boom');
    assert.equal(res.status, 500);
    const line = lines.find((l) => l.msg === 'unhandled request error' && l.error === 'boom for stack test');
    assert.ok(line, 'error line captured');
    assert.match(line.stack, /boom for stack test/);
    assert.equal(line.reqId, res.headers['x-request-id']);
  });
});
