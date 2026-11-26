import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');

describe('base.css', () => {
  it('hands the page font down to every form control', () => {
    expect(css).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{\s*font: inherit;/);
  });

  it('gives Clash Display to h1 only and Space Grotesk to h2 to h6', () => {
    expect(css).toMatch(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{\s*font-family: var\(--font-family-body\);/);
    expect(css).toMatch(/\nh1\s*\{\s*font-family: var\(--font-family-display\);/);
  });

  it('draws no ambient wash or noise over the body ground', () => {
    expect(css).not.toMatch(/body::(before|after)/);
  });

  it('draws the skip-link outline in the focus-ring colour', () => {
    expect(css).toMatch(/\.skip-link:focus-visible\s*\{[^}]*solid var\(--focus-ring-color\)/);
  });
});
