import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';

import createAdminSiteplanRoutes from '../routes/admin-siteplan.js';
import { configureMiddleware } from '../lib/middleware.js';
import { AvatarPool } from '../lib/avatar-pool.js';
import { sendError, sendSuccess, ErrorCodes } from '../lib/response.js';

const PUBLIC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-siteplan-'));
const avatarPool = new AvatarPool();
const auditRows: any[] = [];

// The real configureMiddleware (for the /uploads/siteplans static block) plus the
// real route, on a DB-less app. The festival lookup and admin check are stubs.
function makeApp(publicOrigin: string) {
  const app = express();
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const config = {
    TRUST_PROXY: false,
    PUBLIC_ORIGIN: publicOrigin,
    NODE_ENV: 'production', // skips OpenAPI/Swagger UI mounting
    PUBLIC_DIR,
    WEB_DIST: path.join(PUBLIC_DIR, '__no-build__'),
    JSON_LIMIT: '1mb',
    API_VERSION: '1',
    REQUEST_TIMEOUT_MS: 30_000,
    MOBILE_ORIGINS: [],
    PROFILE_RATE_LIMIT_MAX: 100,
    OVERLAP_RATE_LIMIT_MAX: 100,
  };
  const passthrough = () => (_req: any, _res: any, next: any) => next();
  const ctx: any = {
    express,
    config,
    log,
    state: {
      metrics: { totalRequests: 0, totalDuration: 0, requestCount: 0, totalErrors: 0, statusCodes: {}, endpointLatency: {} },
      timers: [],
    },
    contentSecurityPolicy: "default-src 'self'",
    enforceAllowedOrigin: (_req: any, _res: any, next: any) => next(),
    avatarDirPath: () => path.join(PUBLIC_DIR, 'uploads', 'avatars'),
    isAllowedOrigin: () => false,
    setNoStore: (res: any) => res.setHeader('Cache-Control', 'no-store'),
    getRequestIp: () => '127.0.0.1',
    rateLimit: passthrough,
    authRateLimit: (_req: any, _res: any, next: any) => next(),
    sendError,
    sendSuccess,
    ErrorCodes,
    generateOpenAPISpec: () => ({}),
    stores: { auditLog: { insert: async (row: any) => { auditRows.push(row); } } },
  };
  configureMiddleware(app as any, ctx);
  const routes = createAdminSiteplanRoutes({
    ...ctx,
    avatarPool,
    pool: {
      query: async (_sql: string, params: any[]) => ({ rows: params[0] === 'fest-1' ? [{ id: 'fest-1' }] : [] }),
    },
    adminAuth: (req: any, res: any, next: any) => {
      if (req.get('x-test-admin') !== 'yes') return sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);
      req.user = { userId: 'admin-1' };
      req.isAdmin = true;
      return next();
    },
    validateParams: passthrough,
    schemas: { genericIdParams: {} },
  });
  app.use('/api/v1/admin', routes);
  return app;
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 60 } } }).png().toBuffer();

function upload(app: any, festivalId: string, file?: { buffer: Buffer; filename: string; contentType: string }) {
  const req = request(app).post(`/api/v1/admin/festivals/${festivalId}/siteplan-image`).set('x-test-admin', 'yes');
  if (!file) return req.field('note', 'none');
  return req.attach('image', file.buffer, { filename: file.filename, contentType: file.contentType });
}

describe('POST /api/v1/admin/festivals/:id/siteplan-image', () => {
  let app: any;
  before(() => { app = makeApp('https://festie.test'); });
  after(async () => {
    await avatarPool.terminate();
    fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
  });

  it('shrinks a 6000 x 3000 PNG to 4096 px wide WebP and serves it cross-origin', async () => {
    const res = await upload(app, 'fest-1', { buffer: await png(6000, 3000), filename: 'plan.png', contentType: 'image/png' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { imageUrl } = res.body.data;
    assert.match(imageUrl, /^https:\/\/festie\.test\/uploads\/siteplans\/[a-f0-9]{32}\.webp$/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(auditRows.at(-1).action, 'festival:siteplan-upload');
    assert.equal(auditRows.at(-1).targetId, 'fest-1');

    const file = await request(app).get(new URL(imageUrl).pathname).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/webp');
    assert.equal(file.headers['access-control-allow-origin'], '*');
    assert.equal(file.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
    const md = await sharp(file.body).metadata();
    assert.equal(md.format, 'webp');
    assert.equal(md.width, 4096);
    assert.equal(md.height, 2048);
  });

  it('never enlarges a small image', async () => {
    const res = await upload(app, 'fest-1', { buffer: await png(200, 100), filename: 'small.png', contentType: 'image/png' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const key = res.body.data.imageUrl.split('/').pop();
    const md = await sharp(fs.readFileSync(path.join(PUBLIC_DIR, 'uploads', 'siteplans', key))).metadata();
    assert.equal(md.width, 200);
    assert.equal(md.height, 100);
  });

  it('rejects a PDF with the save-as-PNG hint', async () => {
    const res = await upload(app, 'fest-1', { buffer: Buffer.from('%PDF-1.7\n'), filename: 'plan.pdf', contentType: 'application/pdf' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'Upload a PNG, JPEG or WebP image. For a PDF, save the page as a PNG first.');
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  it('rejects a file over 10 MB', async () => {
    const res = await upload(app, 'fest-1', { buffer: Buffer.alloc(11 * 1024 * 1024), filename: 'big.png', contentType: 'image/png' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'The image must be 10 MB or smaller.');
  });

  it('returns MISSING_FIELD when no file is sent', async () => {
    const res = await upload(app, 'fest-1');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MISSING_FIELD');
    assert.equal(res.body.error.message, 'Choose an image to upload.');
  });

  it('rejects a non-admin', async () => {
    const res = await request(app)
      .post('/api/v1/admin/festivals/fest-1/siteplan-image')
      .attach('image', await png(10, 10), { filename: 'a.png', contentType: 'image/png' });
    assert.ok(res.status === 401 || res.status === 403, `got ${res.status}`);
  });

  it('returns 404 for an unknown festival', async () => {
    const res = await upload(app, 'nope', { buffer: await png(10, 10), filename: 'a.png', contentType: 'image/png' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('returns 503 when PUBLIC_ORIGIN is not https', async () => {
    const res = await upload(makeApp('http://localhost:4000'), 'fest-1', { buffer: await png(10, 10), filename: 'a.png', contentType: 'image/png' });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(res.body.error.message, 'Site-plan upload needs PUBLIC_ORIGIN set to an https address on the server.');
  });
});
