import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildAll } from '../scripts/build-legal-css';
import { headSnippet } from '../lib/design-css';
import { colors } from '../packages/shared/src/tokens/colors';
import { colorsDaylight } from '../packages/shared/src/tokens/colorsDaylight';
import { contrastRatioRgb, parseHex } from '../packages/shared/src/utils/contrast';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');
const read = (file: string) => fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
const LEGAL_PAGES = ['terms.html', 'privacy.html', 'dmca.html', 'delete-account.html', 'security-whitepaper.html'];
const STATIC_PAGES = [...LEGAL_PAGES, 'offline.html', 'export-template.html'];
const RETIRED = [/a8d8ea/i, /00e5a0/i, /1a1a2e/i, /syncopate/i];
const ratio = (a: string, b: string) => contrastRatioRgb(parseHex(a)!, parseHex(b)!);

describe('generated static page parts', () => {
  for (const [file, expected] of Object.entries(buildAll(read))) {
    it(`${file} matches lib/design-css.ts (run: node --import tsx/esm scripts/build-legal-css.ts)`, () => {
      assert.equal(read(file), expected);
    });
  }
});

describe('static page design', () => {
  for (const file of STATIC_PAGES) {
    it(`${file} carries the head snippet and no retired colour or face`, () => {
      const html = read(file);
      for (const line of headSnippet.split('\n')) assert.ok(html.includes(line), `${file} is missing: ${line}`);
      for (const pattern of RETIRED) assert.doesNotMatch(html, pattern);
    });
  }

  for (const file of LEGAL_PAGES) {
    it(`${file} takes all styling from /legal.css`, () => {
      const html = read(file);
      assert.match(html, /<link rel="stylesheet" href="\/legal\.css">/);
      assert.doesNotMatch(html, /<style/);
      assert.match(html, /<a class="ds-lockup" href="\/">/);
    });
  }

  it('legal.css has no retired colour, no gradient and a 65ch measure', () => {
    const css = read('legal.css');
    for (const pattern of RETIRED) assert.doesNotMatch(css, pattern);
    assert.doesNotMatch(css, /gradient|background-clip/);
    assert.match(css, /max-width: 65ch/);
  });

  it('links are readable in both schemes', () => {
    assert.ok(ratio(colors.accent.aqua, colors.bg.primary) >= 4.5);
    assert.ok(ratio(colorsDaylight.accent.aqua, colorsDaylight.bg.primary) >= 4.5);
  });

  it('offline page draws the mark inline and makes no off-origin request', () => {
    const html = read('offline.html');
    assert.match(html, /<svg[^>]*aria-label="Festie"/);
    assert.doesNotMatch(html, /(?:src|href)="https?:/);
    assert.match(html, /<a class="ds-cta" href="">Retry<\/a>/);
  });

  it('export template uses Clash Display and the token ground', () => {
    const html = read('export-template.html');
    assert.match(html, /h1\{font-family:'Clash Display'/);
    assert.ok(html.includes(`--ds-bg:${colors.bg.primary}`));
    assert.ok(html.includes(`--ds-text-muted:${colors.text.muted}`));
  });
});
