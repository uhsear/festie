process.env.REDIS_ENABLED = 'false';

import assert from 'node:assert/strict';
import fs, { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import express from 'express';
import request from 'supertest';

import { configureMiddleware } from '../lib/middleware';
import { ErrorCodes, sendError } from '../lib/response';
import createPageRoutes from '../routes/pages';
import {
  baseCss,
  ctaCss,
  daylightCss,
  daylightVars,
  designCss,
  emailColors,
  festieLockupHtml,
  festieMarkSvg,
  fontFaceCss,
  headSnippet,
  stageRootCss,
  stageVars,
} from '../lib/design-css';
import { colors } from '../packages/shared/src/tokens/colors';
import { colorsDaylight } from '../packages/shared/src/tokens/colorsDaylight';
import { contrastRatioRgb, parseHex } from '../packages/shared/src/utils/contrast';

const ratio = (a: string, b: string) => contrastRatioRgb(parseHex(a)!, parseHex(b)!);

describe('design-css token parity', () => {
  for (const [name, vars, palette, css] of [
    ['Stage', stageVars, colors, stageRootCss],
    ['Daylight', daylightVars, colorsDaylight, daylightCss],
  ] as const) {
    it(`${name} block carries the token values`, () => {
      assert.equal(vars['--ds-bg'], palette.bg.primary);
      assert.equal(vars['--ds-card'], palette.bg.card);
      assert.equal(vars['--ds-border'], palette.border.default);
      assert.equal(vars['--ds-text'], palette.text.primary);
      assert.equal(vars['--ds-text-secondary'], palette.text.secondary);
      assert.equal(vars['--ds-text-muted'], palette.text.muted);
      assert.equal(vars['--ds-danger'], palette.text.danger);
      assert.equal(vars['--ds-accent'], palette.accent.aqua);
      assert.equal(vars['--ds-accent-ink'], palette.text.onLightAccent);
      assert.equal(vars['--ds-mark-pin'], palette.accent.aqua);
      assert.equal(vars['--ds-mark-tent'], palette.accent.coral);
      for (const [prop, value] of Object.entries(vars)) assert.ok(css.includes(`${prop}: ${value};`), prop);
    });

    it(`${name} body text, muted text and CTA ink pass 4.5:1`, () => {
      assert.ok(ratio(vars['--ds-text']!, vars['--ds-bg']!) >= 4.5, 'text');
      assert.ok(ratio(vars['--ds-text-secondary']!, vars['--ds-bg']!) >= 4.5, 'secondary');
      assert.ok(ratio(vars['--ds-text-muted']!, vars['--ds-bg']!) >= 4.5, 'muted');
      assert.ok(ratio(vars['--ds-accent-ink']!, vars['--ds-accent']!) >= 4.5, 'CTA ink on fill');
    });
  }

  it('Daylight applies only under prefers-color-scheme: light', () => {
    assert.match(daylightCss, /^@media \(prefers-color-scheme: light\) \{ :root \{/);
  });

  it('email colours are solid hex and pass 4.5:1', () => {
    for (const value of Object.values(emailColors)) assert.match(value, /^#[0-9a-f]{6}$/i);
    assert.ok(ratio(emailColors.text, emailColors.ground) >= 4.5);
    assert.ok(ratio(emailColors.textMuted, emailColors.card) >= 4.5);
    assert.ok(ratio(emailColors.accentInk, emailColors.accent) >= 4.5);
    assert.ok(ratio(emailColors.danger, emailColors.ground) >= 4.5);
  });

  it('names the base rules, a 44 px aqua pill, the lockup and the head snippet', () => {
    assert.match(baseCss, /text-wrap: balance/);
    assert.match(baseCss, /text-wrap: pretty/);
    assert.match(baseCss, /tabular-nums/);
    assert.match(baseCss, /-webkit-font-smoothing: antialiased/);
    assert.match(ctaCss, /min-height: 44px/);
    assert.match(ctaCss, /border-radius: 999px/);
    assert.match(festieMarkSvg(), /^<svg[^>]*viewBox="0 0 512 512"/);
    assert.ok(!festieMarkSvg().includes('<mask'));
    assert.match(festieLockupHtml('/x'), /href="\/x".*Festie<\/span><\/a>$/);
    assert.match(festieLockupHtml('/x"><script>'), /href="\/x&quot;&gt;&lt;script&gt;"/);
    assert.match(headSnippet, /favicon-daylight\.svg/);
    assert.equal((headSnippet.match(/name="theme-color"/g) || []).length, 2);
    assert.ok(designCss.includes(fontFaceCss));
  });
});

describe('design-css fonts', () => {
  const webPublic = path.join(import.meta.dirname, '..', 'packages', 'web', 'public');
  const urls = [...fontFaceCss.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!);
  const festival = {
    id: 'fest-1', name: 'Test Fest', location: 'Somewhere', timeZone: 'America/New_York', b2bSeparator: 'x',
    stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
    days: [{ label: 'Friday', date: '2026-11-06', sets: [{ id: 's1', artist: 'Alpha', stageId: 'main', startTime: '20:00' }] }],
  };
  let publicDir = '';
  let app: express.Express;

  before(() => {
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'festie-design-css-'));
    fs.mkdirSync(path.join(publicDir, 'uploads', 'basemaps'), { recursive: true });
    const log = { info() {}, warn() {}, error() {}, debug() {} };
    const passThrough = () => (_req: any, _res: any, next: any) => next();
    const config = {
      TRUST_PROXY: false, PUBLIC_ORIGIN: 'https://festie.us', NODE_ENV: 'production', PUBLIC_DIR: publicDir,
      // The web build copies packages/web/public into dist, which the real server serves at /.
      WEB_DIST: webPublic, JSON_LIMIT: '1mb', API_VERSION: '1', REQUEST_TIMEOUT_MS: 10_000, MOBILE_ORIGINS: [],
      PROFILE_RATE_LIMIT_MAX: 100, OVERLAP_RATE_LIMIT_MAX: 100,
    };
    app = express();
    configureMiddleware(app as any, {
      express, config, log,
      state: { metrics: { totalRequests: 0, totalDuration: 0, requestCount: 0, totalErrors: 0, statusCodes: {}, endpointLatency: {} }, timers: [] },
      contentSecurityPolicy: "default-src 'self'",
      enforceAllowedOrigin: (_req: any, _res: any, next: any) => next(),
      avatarDirPath: () => path.join(publicDir, 'uploads', 'avatars'),
      isAllowedOrigin: () => false,
      setNoStore: () => {},
      getRequestIp: (req: any) => req.ip || '127.0.0.1',
      rateLimit: passThrough,
      authRateLimit: passThrough(),
      loginIpRateLimit: passThrough(),
      sendError,
      ErrorCodes,
      generateOpenAPISpec: () => ({}),
      stores: { auditLog: { insert: async () => {} } },
    } as any);
    app.use(createPageRoutes({
      express, config, log, rateLimit: passThrough, pool: { query: async () => ({ rows: [] }) },
      stores: { festivals: { findPublicIdBySlug: async () => 'fest-1' } },
      getFestivalById: async () => festival,
    } as any));
  });
  after(() => fs.rmSync(publicDir, { recursive: true, force: true }));

  it('names Clash Display, and three Space Grotesk subsets that match the web font css', () => {
    assert.equal(urls.length, 4);
    const webCss = fs.readFileSync(path.join(webPublic, 'fonts', 'space-grotesk', 'space-grotesk.css'), 'utf8');
    const faces = (css: string) => [...css.matchAll(/url\('([^']+space-grotesk[^']+)'\)[^}]*?unicode-range:\s*([^;]+);/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    assert.equal(faces(webCss).length, 3);
    assert.deepEqual(faces(fontFaceCss), faces(webCss));
  });

  it('serves /f/<slug> from the real page routes', async () => {
    const res = await request(app).get('/f/test-fest');
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /text\/html/);
  });

  // Clash Display is licensed and gitignored; scripts/fetch-fonts.mjs supplies it. Set
  // REQUIRE_LICENSED_FONTS=1 where the fonts must be present, so a missing file fails.
  const requireLicensed = process.env.REQUIRE_LICENSED_FONTS === '1';
  for (const url of urls) {
    const present = existsSync(path.join(webPublic, url));
    const skip = !present && url.includes('clash-display') && !requireLicensed && 'licensed font missing: run node scripts/fetch-fonts.mjs';
    it(`serves ${url} as a font through the app's static mount`, { skip }, async () => {
      assert.ok(present, `${url} is missing from packages/web/public: run node scripts/fetch-fonts.mjs`);
      const res = await request(app).get(url);
      assert.equal(res.status, 200);
      assert.match(String(res.headers['content-type']), /font\/woff2|application\/font-woff2/);
    });
  }
});
