import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import express from 'express';
import request from 'supertest';

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
    assert.match(headSnippet, /favicon-daylight\.svg/);
    assert.equal((headSnippet.match(/name="theme-color"/g) || []).length, 2);
    assert.ok(designCss.includes(fontFaceCss));
  });
});

describe('design-css fonts', () => {
  const webPublic = path.join(import.meta.dirname, '..', 'packages', 'web', 'public');
  const urls = [...fontFaceCss.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!);

  it('names a Clash Display and a Space Grotesk file', () => {
    assert.equal(urls.length, 2);
  });

  // The web build copies packages/web/public into dist, which the server serves at /.
  // Clash Display is licensed and gitignored; scripts/fetch-fonts.mjs supplies it.
  for (const url of urls) {
    const present = existsSync(path.join(webPublic, url));
    it(`serves ${url} as a font`, { skip: !present && 'font file missing: run node scripts/fetch-fonts.mjs' }, async () => {
      const app = express().use(express.static(webPublic));
      const res = await request(app).get(url);
      assert.equal(res.status, 200);
      assert.match(String(res.headers['content-type']), /font\/woff2|application\/font-woff2/);
    });
  }
});
