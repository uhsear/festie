import { describe, expect, it } from 'vitest';
import { festivalTint } from './festivalTint';
import { parseHex, relativeLuminance } from './contrast';

function lum(hex: string): number {
  const [r, g, b] = parseHex(hex)!;
  return relativeLuminance(r, g, b);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('festivalTint', () => {
  it.each([
    ['Coachella', 135, '#08160c', '#122b18', '#21452a', '#42f06e'],
    ['  edc orlando ', 248, '#0a0816', '#16122b', '#262145', '#5942f0'],
    ['', 61, '#161608', '#2a2b12', '#444521', '#edf042'],
  ])('tints %j', (name, hue, bg, pale, faint, active) => {
    expect(festivalTint(name)).toEqual({ hue, bg, pale, faint, active });
  });

  it('treats null and undefined like an empty name', () => {
    expect(festivalTint(null)).toEqual(festivalTint(''));
    expect(festivalTint(undefined)).toEqual(festivalTint(''));
  });

  it('keeps secondary text readable on bg and pale for every hue', () => {
    const byHue = new Map<number, ReturnType<typeof festivalTint>>();
    for (let i = 0; byHue.size < 360 && i < 100000; i++) {
      const t = festivalTint(`fest-${i}`);
      if (!byHue.has(t.hue)) byHue.set(t.hue, t);
    }
    expect(byHue.size).toBe(360);
    for (const t of byHue.values()) {
      expect(ratio('#9999bb', t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio('#9999bb', t.pale)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
