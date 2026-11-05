import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'path';
import { fileURLToPath } from 'node:url';
import fs from 'fs';
import os from 'os';
import express from 'express';
import request from 'supertest';

import { configureMiddleware } from '../lib/middleware.js';
import { sendError, ErrorCodes } from '../lib/response.js';
import { buildCspPolicies, buildContentSecurityPolicy, collectInlineHashes } from '../lib/app-context/csp.js';

// ─── collectInlineHashes ─────────────────────────────────────────────────────

describe('csp: collectInlineHashes', () => {
  it('returns object with script and style arrays', () => {
    // Use a temp dir with no HTML files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(Array.isArray(hashes.script));
      assert.ok(Array.isArray(hashes.style));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('collects hashes from inline script tags', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><head><script>console.log("hello")</script></head></html>');
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(hashes.script.length >= 1);
      assert.ok(hashes.script[0]!.startsWith("'sha256-"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('collects hashes from inline style tags', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><head><style>body { color: red; }</style></head></html>');
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(hashes.style.length >= 1);
      assert.ok(hashes.style[0]!.startsWith("'sha256-"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips script tags with src attribute', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><head><script src="app.js">fallback</script></head></html>');
      const hashes = collectInlineHashes(tmpDir);
      assert.equal(hashes.script.length, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles missing files gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      // No files at all — should not throw
      const hashes = collectInlineHashes(tmpDir);
      assert.ok(Array.isArray(hashes.script));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── buildContentSecurityPolicy ──────────────────────────────────────────────

describe('csp: buildContentSecurityPolicy', () => {
  const minimalConfig = { PUBLIC_ORIGIN: 'https://festie.us' };
  const emptyHashes = { script: [] as string[], style: [] as string[] };

  it('returns a non-empty string', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(typeof csp === 'string');
    assert.ok(csp.length > 50);
  });

  it('includes default-src self', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(csp.includes("default-src 'self'"));
  });

  it('includes frame-ancestors none', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(csp.includes("frame-ancestors 'none'"));
  });

  it('includes script-src self', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(csp.includes("script-src 'self'"));
  });

  it('includes websocket origin for wss when PUBLIC_ORIGIN is https', () => {
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: 'https://festie.us' }, emptyHashes);
    assert.ok(csp.includes('wss://festie.us'));
  });

  it('includes firebase script-src when FIREBASE_CREDENTIALS_PATH is set', () => {
    const csp = buildContentSecurityPolicy(
      { PUBLIC_ORIGIN: 'https://festie.us', FIREBASE_CREDENTIALS_PATH: '/path/to/creds' },
      emptyHashes,
    );
    assert.ok(csp.includes('https://www.gstatic.com/firebasejs/'));
  });

  it('includes upgrade-insecure-requests for https origins', () => {
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: 'https://festie.us' }, emptyHashes);
    assert.ok(csp.includes('upgrade-insecure-requests'));
  });

  it('does not include upgrade-insecure-requests for http origins', () => {
    const csp = buildContentSecurityPolicy({ PUBLIC_ORIGIN: 'http://localhost:4000' }, emptyHashes);
    assert.ok(!csp.includes('upgrade-insecure-requests'));
  });

  it('includes style-src-attr unsafe-inline when allowStyleAttributes is true', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes, { allowStyleAttributes: true });
    assert.ok(csp.includes("style-src-attr 'unsafe-inline'"));
  });

  it('excludes style-src-attr when allowStyleAttributes is false', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes, { allowStyleAttributes: false });
    assert.ok(!csp.includes('style-src-attr'));
  });

  it('includes inline script hashes in script-src', () => {
    const hashes = { script: ["'sha256-abc123'"], style: [] as string[] };
    const csp = buildContentSecurityPolicy(minimalConfig, hashes);
    assert.ok(csp.includes("'sha256-abc123'"));
  });

  it('includes csp-report directive', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(csp.includes('report-uri /api/csp-report'));
  });

  it('adds no Google or Apple hosts when sign-in is unconfigured', () => {
    const csp = buildContentSecurityPolicy(minimalConfig, emptyHashes);
    assert.ok(!csp.includes('accounts.google.com'));
    assert.ok(!csp.includes('appleid'));
    assert.ok(/frame-src 'self' https:\/\/open\.spotify\.com(;|$)/.test(csp));
  });

  it('adds exactly the Google hosts when Google sign-in is on', () => {
    const csp = buildContentSecurityPolicy({ ...minimalConfig, OAUTH_GOOGLE_ENABLED: true }, emptyHashes);
    assert.ok(csp.includes('https://accounts.google.com/gsi/client'));
    assert.ok(csp.includes("frame-src 'self' https://open.spotify.com https://accounts.google.com/gsi/"));
    assert.ok(csp.includes('https://accounts.google.com/gsi/style'));
    assert.ok(csp.includes('connect-src') && /connect-src [^;]*https:\/\/accounts\.google\.com\/gsi\//.test(csp));
    assert.ok(!csp.includes('appleid'));
  });

  it('adds exactly the Apple hosts when Apple web sign-in is on', () => {
    const csp = buildContentSecurityPolicy({ ...minimalConfig, OAUTH_APPLE_WEB_ENABLED: true }, emptyHashes);
    assert.ok(/script-src [^;]*https:\/\/appleid\.cdn-apple\.com/.test(csp));
    assert.ok(/frame-src [^;]*https:\/\/appleid\.apple\.com/.test(csp));
    assert.ok(/connect-src [^;]*https:\/\/appleid\.apple\.com/.test(csp));
    assert.ok(!csp.includes('accounts.google.com'));
  });
});

// ─── buildCspPolicies ────────────────────────────────────────────────────────

describe('csp: buildCspPolicies', () => {
  it('returns inlineHashes, contentSecurityPolicy, and exportContentSecurityPolicy', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-test-'));
    try {
      const result = buildCspPolicies({ PUBLIC_DIR: tmpDir, PUBLIC_ORIGIN: 'https://festie.us' });
      assert.ok(result.inlineHashes);
      assert.ok(typeof result.contentSecurityPolicy === 'string');
      assert.ok(typeof result.exportContentSecurityPolicy === 'string');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── COOP follows the sign-in providers ──────────────────────────────────────

describe('csp: Cross-Origin-Opener-Policy', () => {
  const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

  async function headersFor(config: Record<string, any>) {
    const app = express();
    const ctx = {
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
        ...config,
      },
      log: { info() {}, warn() {}, error() {} },
      state: { metrics: { totalRequests: 0, totalDuration: 0, requestCount: 0, totalErrors: 0, statusCodes: {}, endpointLatency: {} }, timers: [] },
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
    };
    configureMiddleware(app as any, ctx as any);
    const res = await request(app).get('/health/live');
    return res.headers;
  }

  const coopFor = async (config: Record<string, any>) => (await headersFor(config))['cross-origin-opener-policy'];

  it('sends Permissions-Policy allowing geolocation and wake lock for self only', async () => {
    const policy = String((await headersFor({}))['permissions-policy']);
    assert.match(policy, /(^|, )geolocation=\(self\)/);
    assert.match(policy, /screen-wake-lock=\(self\)/);
    assert.match(policy, /camera=\(\)/);
  });

  it('lets only the Spotify embed use encrypted media (FND-062)', async () => {
    const policy = String((await headersFor({}))['permissions-policy']);
    assert.match(policy, /encrypted-media=\(self "https:\/\/open\.spotify\.com"\)/);
  });

  it('stays same-origin when no provider is enabled', async () => {
    assert.equal(await coopFor({}), 'same-origin');
  });

  it('allows popups when Google sign-in is enabled', async () => {
    assert.equal(await coopFor({ OAUTH_GOOGLE_ENABLED: true }), 'same-origin-allow-popups');
  });

  it('allows popups when Apple web sign-in is enabled', async () => {
    assert.equal(await coopFor({ OAUTH_APPLE_WEB_ENABLED: true }), 'same-origin-allow-popups');
  });

  it('sends no referrer unless Google sign-in needs the origin', async () => {
    assert.equal((await headersFor({}))['referrer-policy'], 'no-referrer');
    assert.equal((await headersFor({ OAUTH_GOOGLE_ENABLED: true }))['referrer-policy'], 'strict-origin');
  });
});
