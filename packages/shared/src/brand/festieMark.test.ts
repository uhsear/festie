import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colors } from '../tokens/colors';
import { colorsDaylight } from '../tokens/colorsDaylight';
import { FESTIE_MARK_PIN_PATH, FESTIE_MARK_TENT_PATH, festieMarkSvgBody } from './festieMark';

const here = dirname(fileURLToPath(import.meta.url));
const repo = (p: string) => readFileSync(resolve(here, '../../../..', p), 'utf8');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('festie mark path', () => {
  it('has no mask, use or defs', () => {
    const body = festieMarkSvgBody('#000', '#fff');
    expect(body).not.toMatch(/mask|<use|<defs/i);
    expect(FESTIE_MARK_TENT_PATH).toMatch(/^M[\d\sZM.]+$/);
  });

  it.each([
    ['docs/brand/festie-mark.svg', colors.accent.aqua, colors.accent.coral],
    ['docs/brand/festie-mark-daylight.svg', colorsDaylight.accent.aqua, colorsDaylight.accent.coral],
    ['packages/web/public/favicon-daylight.svg', colorsDaylight.accent.aqua, colorsDaylight.accent.coral],
  ])('%s matches the shared path and the theme tokens', (file, pin, tent) => {
    const svg = repo(file);
    expect(svg).toContain(`d="${FESTIE_MARK_TENT_PATH}"`);
    expect(svg).toContain(`d="${FESTIE_MARK_PIN_PATH}"`);
    expect(svg.toLowerCase()).toContain(`fill="${pin}"`.toLowerCase());
    expect(svg.toLowerCase()).toContain(`fill="${tent}"`.toLowerCase());
  });

  it('keeps the Stage favicon on the shared path', () => {
    expect(repo('packages/web/public/favicon.svg')).toContain(`d="${FESTIE_MARK_TENT_PATH}"`);
  });

  it('Daylight pin and tent colours clear 3:1 on the Daylight ground', () => {
    expect(contrast(colorsDaylight.accent.aqua, '#f4f4f7')).toBeGreaterThan(3);
    expect(contrast(colorsDaylight.accent.coral, '#f4f4f7')).toBeGreaterThan(3);
    expect(colorsDaylight.bg.primary).toBe('#f4f4f7');
  });
});
