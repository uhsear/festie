import { describe, it, expect } from 'vitest';
import { DEFAULT_STAGE_COLORS, defaultStageColor, resolveStageColor, STAGE_COLOR_FALLBACK } from './stageColor';
import { colors } from '../tokens/colors';
import { contrastRatioRgb, parseHex } from './contrast';

describe('resolveStageColor', () => {
  it('returns a real color unchanged', () => {
    expect(resolveStageColor('#ff3366', '#fallback')).toBe('#ff3366');
    expect(resolveStageColor('hsl(200 60% 50%)', '#fallback')).toBe('hsl(200 60% 50%)');
  });

  it('maps the neutral sentinel to the platform fallback', () => {
    expect(resolveStageColor(STAGE_COLOR_FALLBACK, 'var(--text-muted)')).toBe('var(--text-muted)');
    expect(resolveStageColor(STAGE_COLOR_FALLBACK, '#9999bb')).toBe('#9999bb');
  });

  it('maps nullish/empty to the fallback', () => {
    expect(resolveStageColor(undefined, '#fb')).toBe('#fb');
    expect(resolveStageColor(null, '#fb')).toBe('#fb');
    expect(resolveStageColor('', '#fb')).toBe('#fb');
  });

  it('the sentinel is not a CSS var (shared stays RN-safe)', () => {
    expect(STAGE_COLOR_FALLBACK.startsWith('var(')).toBe(false);
    expect(STAGE_COLOR_FALLBACK.startsWith('#')).toBe(false);
  });
});

function hue([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  if (d === 0) return 0;
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe('defaultStageColor', () => {
  it('gives each new stage the next palette colour, cycling', () => {
    const first = Array.from({ length: 8 }, (_, i) => defaultStageColor(i));
    expect(new Set(first.slice(0, 4)).size).toBe(4);
    expect(first.slice(4)).toEqual(first.slice(0, 4));
  });

  it('keeps every default 25 degrees or more from each signal hue', () => {
    const signal = [colors.accent.aqua, colors.accent.green, colors.accent.amber, colors.accent.coral, colors.stage.purpleAccessible];
    for (const color of DEFAULT_STAGE_COLORS) {
      for (const s of signal) expect(hueGap(hue(parseHex(color)!), hue(parseHex(s)!))).toBeGreaterThanOrEqual(25);
    }
  });

  it('keeps a 3:1 rail against the Stage and Daylight card grounds', () => {
    for (const color of DEFAULT_STAGE_COLORS) {
      const rgb = parseHex(color)!;
      expect(contrastRatioRgb(rgb, [21, 21, 21])).toBeGreaterThanOrEqual(3);
      expect(contrastRatioRgb(rgb, [255, 255, 255])).toBeGreaterThanOrEqual(3);
    }
  });
});
