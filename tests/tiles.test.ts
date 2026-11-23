process.env.REDIS_ENABLED = 'false';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import express from 'express';
import request from 'supertest';

import { absolutizeTilesUrl, TILES_NAME_RE, TILES_PATH_RE } from '../lib/tiles.js';
import { festivalMapConfigSchema } from '../lib/schemas.js';
import { configureMiddleware } from '../lib/middleware.js';
import { sendError, ErrorCodes } from '../lib/response.js';

let ROOT = '';
let TILES_DIR = '';
const BODY = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

const binary = (res: any, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-tiles-'));
  TILES_DIR = path.join(ROOT, 'tiles');
  fs.mkdirSync(TILES_DIR);
  fs.writeFileSync(path.join(TILES_DIR, 'fest-2026.pmtiles'), BODY);
  fs.writeFileSync(path.join(ROOT, 'secret.pmtiles'), 'secret');
  fs.writeFileSync(path.join(TILES_DIR, 'notes.txt'), 'not a tile');
});
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function makeApp(tilesDir: string) {
  const app = express();
  configureMiddleware(app as any, {
    express,
    config: {
      TRUST_PROXY: false,
      PUBLIC_ORIGIN: '',
      NODE_ENV: 'production',
      PUBLIC_DIR: ROOT,
      TILES_DIR: tilesDir,
      WEB_DIST: path.join(ROOT, '__no-build__'),
      JSON_LIMIT: '1mb',
      API_VERSION: '1',
      REQUEST_TIMEOUT_MS: 10_000,
      MOBILE_ORIGINS: ['capacitor://festie'],
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
    avatarDirPath: () => path.join(ROOT, 'uploads', 'avatars'),
    isAllowedOrigin: (origin: string | undefined) => origin === 'https://festie.us',
    setNoStore: () => {},
    getRequestIp: (req: any) => req.ip || '127.0.0.1',
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    authRateLimit: (_req: any, _res: any, next: any) => next(),
    loginIpRateLimit: (_req: any, _res: any, next: any) => next(),
    sendError,
    ErrorCodes,
    generateOpenAPISpec: () => ({}),
    stores: { auditLog: { insert: async () => {} } },
  } as any);
  return app;
}

describe('self-hosted PMTiles route', () => {
  it('returns 404 while TILES_DIR is unset', async () => {
    const res = await request(makeApp('')).get('/tiles/fest-2026.pmtiles');
    assert.equal(res.status, 404);
  });

  it('serves the whole file with cache, type and ETag headers', async () => {
    const res = await request(makeApp(TILES_DIR)).get('/tiles/fest-2026.pmtiles').buffer(true).parse(binary);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, BODY);
    assert.equal(res.headers['content-type'], 'application/octet-stream');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.match(res.headers['cache-control'] ?? '', /immutable/);
    assert.match(res.headers['cache-control'] ?? '', /no-transform/);
    assert.ok(res.headers.etag);
  });

  it('answers a Range request with 206 and exactly those bytes', async () => {
    const res = await request(makeApp(TILES_DIR))
      .get('/tiles/fest-2026.pmtiles')
      .set('Range', 'bytes=100-199')
      .buffer(true)
      .parse(binary);
    assert.equal(res.status, 206);
    assert.equal(res.headers['content-range'], 'bytes 100-199/4096');
    assert.deepEqual(res.body, BODY.subarray(100, 200));
  });

  it('answers 304 when the ETag still matches', async () => {
    const app = makeApp(TILES_DIR);
    const first = await request(app).get('/tiles/fest-2026.pmtiles').set('Range', 'bytes=0-9');
    const second = await request(app).get('/tiles/fest-2026.pmtiles').set('If-None-Match', String(first.headers.etag));
    assert.equal(second.status, 304);
  });

  it('answers 404 for a missing file', async () => {
    const res = await request(makeApp(TILES_DIR)).get('/tiles/nope.pmtiles');
    assert.equal(res.status, 404);
  });

  for (const name of ['..%2Fsecret.pmtiles', '%2e%2e%2fsecret.pmtiles', 'notes.txt', 'Fest.pmtiles', '.hidden.pmtiles', 'a%00.pmtiles', 'sub%2Ffile.pmtiles']) {
    it(`answers 400 for the bad name ${name}`, async () => {
      const res = await request(makeApp(TILES_DIR)).get(`/tiles/${name}`);
      assert.equal(res.status, 400);
    });
  }

  it('does not serve a file from a parent path', async () => {
    const res = await request(makeApp(TILES_DIR)).get('/tiles/../secret.pmtiles');
    assert.notEqual(res.status, 200);
  });

  it('allows own, mobile and opaque origins and nobody else', async () => {
    const app = makeApp(TILES_DIR);
    for (const origin of ['https://festie.us', 'capacitor://festie', 'null']) {
      const res = await request(app).get('/tiles/fest-2026.pmtiles').set('Origin', origin).set('Range', 'bytes=0-9');
      assert.equal(res.headers['access-control-allow-origin'], origin, origin);
      assert.match(res.headers['access-control-expose-headers'] ?? '', /Content-Range/);
    }
    const other = await request(app).get('/tiles/fest-2026.pmtiles').set('Origin', 'https://evil.example').set('Range', 'bytes=0-9');
    assert.equal(other.headers['access-control-allow-origin'], undefined);
  });

  it('answers a Range preflight for own origins and refuses others', async () => {
    const app = makeApp(TILES_DIR);
    const ok = await request(app).options('/tiles/fest-2026.pmtiles').set('Origin', 'https://festie.us').set('Access-Control-Request-Method', 'GET');
    assert.equal(ok.status, 204);
    assert.match(ok.headers['access-control-allow-headers'] ?? '', /Range/);
    const bad = await request(app).options('/tiles/fest-2026.pmtiles').set('Origin', 'https://evil.example');
    assert.equal(bad.status, 403);
  });

  it('refuses a write method', async () => {
    const res = await request(makeApp(TILES_DIR)).post('/tiles/fest-2026.pmtiles');
    assert.equal(res.status, 405);
  });
});

describe('pmtilesUrl validation and storage', () => {
  const parse = (pmtilesUrl: string) => festivalMapConfigSchema.safeParse({ version: 1, offlineBasemap: { pmtilesUrl } }).success;

  it('accepts https URLs and /tiles/ paths', () => {
    assert.equal(parse('https://cdn.example.com/a.pmtiles'), true);
    assert.equal(parse('/tiles/fest-2026.pmtiles'), true);
  });

  it('rejects http, other paths, traversal and other schemes', () => {
    const bad = ['http://cdn.example.com/a.pmtiles', '/uploads/a.pmtiles', '/tiles/../a.pmtiles', '/tiles/a.txt', '/tiles/A.pmtiles', 'javascript:alert(1)', '//evil.example/tiles/a.pmtiles', '/tiles/a.pmtiles?x=1'];
    for (const value of bad) assert.equal(parse(value), false, value);
  });

  it('turns a /tiles/ path into an absolute URL on the app origin and leaves https alone', () => {
    const config: any = { offlineBasemap: { pmtilesUrl: '/tiles/fest-2026.pmtiles' } };
    absolutizeTilesUrl(config, 'https://festie.us/');
    assert.equal(config.offlineBasemap.pmtilesUrl, 'https://festie.us/tiles/fest-2026.pmtiles');
    const other: any = { offlineBasemap: { pmtilesUrl: 'https://cdn.example.com/a.pmtiles' } };
    absolutizeTilesUrl(other, 'https://festie.us');
    assert.equal(other.offlineBasemap.pmtilesUrl, 'https://cdn.example.com/a.pmtiles');
    assert.doesNotThrow(() => absolutizeTilesUrl(null, 'https://festie.us'));
    for (const origin of ['', undefined, 'http://localhost:4000']) {
      const kept: any = { offlineBasemap: { pmtilesUrl: '/tiles/fest-2026.pmtiles' } };
      absolutizeTilesUrl(kept, origin);
      assert.equal(kept.offlineBasemap.pmtilesUrl, '/tiles/fest-2026.pmtiles', String(origin));
    }
  });

  it('keeps the name and path patterns in step', () => {
    assert.ok(TILES_NAME_RE.test('a.pmtiles') && TILES_PATH_RE.test('/tiles/a.pmtiles'));
    assert.ok(!TILES_NAME_RE.test('a/b.pmtiles'));
  });
});
