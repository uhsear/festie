import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('index.html boot shell', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

  it('paints a static shell inside #root before the bundle loads', () => {
    expect(html).toMatch(/<div id="root">\s*<div class="boot-shell"[\s\S]*Loading Festie…[\s\S]*<\/div>\s*<\/div>/);
  });

  it('adds no inline script or style attribute (CSP)', () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/\sstyle="/);
  });

  it('self-hosts Space Grotesk: no Google Fonts host, and the main file is preloaded', () => {
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(html).not.toContain('font-loader.js');
    expect(html).toContain('<link rel="preload" as="font" type="font/woff2" href="/fonts/space-grotesk/space-grotesk-latin.woff2" crossorigin />');
    expect(html).toContain('<link rel="stylesheet" href="/fonts/space-grotesk/space-grotesk.css" />');
  });

  it('ships the Space Grotesk files, the licence and a stylesheet that declares every weight in use', () => {
    const dir = resolve(__dirname, '../public/fonts/space-grotesk');
    const css = readFileSync(resolve(dir, 'space-grotesk.css'), 'utf8');
    for (const file of ['space-grotesk-latin.woff2', 'space-grotesk-latin-ext.woff2', 'space-grotesk-vietnamese.woff2']) {
      expect(readFileSync(resolve(dir, file)).subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(css).toContain(`/fonts/space-grotesk/${file}`);
    }
    expect(readFileSync(resolve(dir, 'OFL.txt'), 'utf8')).toContain('SIL Open Font License');
    expect(css).not.toMatch(/https?:/);
    expect(css.match(/font-weight: 400 700;/g)).toHaveLength(3);
  });

  it('loads the boot guard as an external script before the bundle', () => {
    expect(html).toMatch(/<script src="\/boot-guard\.js"><\/script>\s*<script type="module" src="\/src\/main\.tsx">/);
  });

  it('tells a no-JavaScript visitor to turn it on instead of showing the spinner', () => {
    expect(html).toMatch(/<noscript>[\s\S]*\.boot-shell\s*\{\s*display: none;[\s\S]*needs JavaScript[\s\S]*<\/noscript>/);
  });
});
