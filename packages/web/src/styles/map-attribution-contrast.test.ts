import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.generated.css'), 'utf8');
const components = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');

function token(block: string, name: string): string {
  return new RegExp(`${name}: *(#[0-9a-f]{6})`, 'i').exec(block)![1];
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('map attribution contrast', () => {
  const daylightStart = css.indexOf(":root[data-theme='daylight']");
  const themes = { stage: css.slice(0, daylightStart), daylight: css.slice(daylightStart) };

  it('paints an opaque background, so the map cannot lower the contrast', () => {
    expect(components).toMatch(/\.maplibregl-ctrl-attrib \{\s*background: var\(--color-bg-primary\);/);
  });

  for (const [name, block] of Object.entries(themes)) {
    it(`${name}: muted text and primary links reach 4.5:1`, () => {
      const bg = token(block, '--color-bg-primary');
      expect(ratio(token(block, '--color-text-muted'), bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token(block, '--color-text-primary'), bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
