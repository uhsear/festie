import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, mock, after } from 'node:test';
import express from 'express';
import request from 'supertest';

import { createMetrics, metricsHandler, recordJobRun } from '../lib/metrics.js';
import { createRateLimiters } from '../lib/rate-limiting.js';
import { createBackgroundTasks } from '../lib/shutdown.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// prom-client also registers every metric in its global registry, so createMetrics() runs once per process.
const metrics: any = createMetrics();

function sampleValue(text: string, name: string, labels: string): number | undefined {
  const line = text.split('\n').find((l) => l.startsWith(`${name}{`) && l.includes(labels));
  return line === undefined ? undefined : Number(line.slice(line.lastIndexOf(' ') + 1));
}

describe('metrics: recordJobRun', () => {
  it('counts ok and error runs and stamps the last success time', async () => {
    recordJobRun('token_cleanup', true);
    recordJobRun('token_cleanup', false);
    recordJobRun('token_cleanup', false);
    const text = await metrics.registry.metrics();
    assert.equal(sampleValue(text, 'festie_job_runs_total', 'job="token_cleanup",result="ok"'), 1);
    assert.equal(sampleValue(text, 'festie_job_runs_total', 'job="token_cleanup",result="error"'), 2);
    const stamp = sampleValue(text, 'festie_job_last_success_timestamp_seconds', 'job="token_cleanup"');
    assert.ok(stamp !== undefined && Math.abs(stamp - Date.now() / 1000) < 5, `stamp ${stamp} is near now`);
  });

  it('an error-only job has no last-success stamp', async () => {
    recordJobRun('poll_expiry', false);
    const text = await metrics.registry.metrics();
    assert.equal(sampleValue(text, 'festie_job_last_success_timestamp_seconds', 'job="poll_expiry"'), undefined);
  });
});

describe('metrics: rate-limit rejections', () => {
  it('a 429 increments fp_rate_limit_hits_total{tier="route",action="x"}', async () => {
    const limiters = createRateLimiters({
      config: { CLUSTER_SIZE: 1, RATE_LIMIT_WINDOW: 60_000, RATE_LIMIT_MAX: 10, MAX_RATE_LIMIT_ENTRIES: 100, USER_SESSION_COOKIE: 'festie_session' },
      state: { rateLimits: new Map(), routeRateLimits: new Map(), authRateLimits: new Map(), adminAuthRateLimits: new Map() },
      log: { info() {}, warn() {}, error() {}, debug() {} },
      getRequestIp: () => '127.0.0.1',
      sendError: (res: any, status: number) => { res.statusCode = status; return res; },
      ErrorCodes: { RATE_LIMITED: 'RATE_LIMITED' },
      hashSessionToken: (t: string) => t,
      resolveRequestToken: () => ({ token: null }),
      promMetrics: metrics,
    });
    const limit = limiters.rateLimit(1, 'x');
    const res: any = { statusCode: 200, setHeader() {} };
    let passed = 0;
    await limit({ path: '/p' }, res, () => { passed += 1; });
    await limit({ path: '/p' }, res, () => { passed += 1; });
    assert.equal(passed, 1);
    assert.equal(res.statusCode, 429);
    const text = await metrics.registry.metrics();
    assert.equal(sampleValue(text, 'fp_rate_limit_hits_total', 'tier="route",action="x"'), 1);
  });
});

describe('metrics: GET /metrics after a background job run', () => {
  const prevToken = process.env.METRICS_TOKEN;
  after(() => {
    mock.timers.reset();
    if (prevToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = prevToken;
  });

  it('shows festie_job_runs_total{job="session_cleanup",result="ok"}', async () => {
    process.env.METRICS_TOKEN = 'metrics-signals-test-token';
    mock.timers.enable({ apis: ['setInterval'] });
    const DAY = 24 * 60 * 60 * 1000;
    createBackgroundTasks(
      {
        config: { SESSION_CLEANUP_INTERVAL_MS: 1_000, SESSION_TTL: 1, MEMORY_CHECK_INTERVAL_MS: DAY, TOKEN_CLEANUP_INTERVAL_MS: DAY },
        state: { timers: [] },
        stores: { sessions: { deleteExpiredUserSessions: async () => {} } },
        log: { info() {}, warn() {}, error() {}, debug() {} },
        validateUserSession: async () => true,
        disconnectSocket() {},
        emitPresence() {},
        avatarDirPath: () => path.join(ROOT, '__no-avatars__'),
      },
      { io: { of: () => ({ sockets: new Map() }), engine: { clientsCount: 0 } } },
    );
    mock.timers.tick(1_000);
    await new Promise((r) => setImmediate(r));

    const app = express();
    app.get('/metrics', metricsHandler(metrics));
    const res = await request(app).get('/metrics').set('Authorization', 'Bearer metrics-signals-test-token');
    assert.equal(res.status, 200);
    assert.equal(sampleValue(res.text, 'festie_job_runs_total', 'job="session_cleanup",result="ok"'), 1);
  });
});

describe('metrics: no dead metric', () => {
  // fp_db_query_duration_seconds is the one exception: T58 owns query performance and
  // either wires it in lib/db/latency.ts or removes it.
  const ALLOWED_UNUSED = new Set(['dbQueryHistogram']);

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return sourceFiles(p);
      return e.name.endsWith('.ts') ? [p] : [];
    });
  }

  it('every registered metric in lib/metrics.ts has a call site', () => {
    const metricsSrc = fs.readFileSync(path.join(ROOT, 'lib', 'metrics.ts'), 'utf8');
    const names = [...metricsSrc.matchAll(/const (\w+) = new client\.(?:Counter|Gauge|Histogram|Summary)\(/g)].map((m) => m[1] as string);
    assert.ok(names.length >= 10, `found ${names.length} metrics`);

    const code = [...sourceFiles(path.join(ROOT, 'lib')), ...sourceFiles(path.join(ROOT, 'routes')), path.join(ROOT, 'server.ts')]
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');
    const dead = names.filter(
      (n) => !ALLOWED_UNUSED.has(n) && !new RegExp(`\\b${n}\\??\\.(?:inc|observe|set|startTimer)\\(`).test(code),
    );
    assert.deepEqual(dead, [], `registered metrics with no .inc/.observe/.set/.startTimer call site: ${dead.join(', ')}`);
  });
});
