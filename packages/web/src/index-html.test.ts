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
});
