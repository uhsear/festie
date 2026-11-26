import { describe, expect, it } from 'vitest';
import { festivalTint, posterBand } from './festivalTint';
import { POSTER } from '../tokens/poster';
import { colors } from '../tokens/colors';
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

describe('posterBand', () => {
  const byHue = () => {
    const seen = new Map<number, string>();
    for (let i = 0; seen.size < 360 && i < 100000; i++) {
      const name = `fest-${i}`;
      const hue = festivalTint(name).hue;
      if (!seen.has(hue)) seen.set(hue, name);
    }
    return [...seen.values()];
  };

  it('keeps the festival hue away from coral and aqua and keeps 3:1 on the ground, for every hue', () => {
    const names = byHue();
    expect(names.length).toBe(360);
    let fallbacks = 0;
    for (const name of names) {
      const band = posterBand(name);
      expect(ratio(band.colour, POSTER.colors.ground)).toBeGreaterThanOrEqual(POSTER.band.minContrast);
      if (band.fallback) {
        fallbacks++;
        expect(band.colour).toBe(colors.stage.fallback);
      } else {
        expect(band.colour).toBe(festivalTint(name).active);
        expect(Math.abs(((band.hue - 345 + 540) % 360) - 180)).toBeGreaterThan(POSTER.band.hueExclusion);
        expect(Math.abs(((band.hue - 173.79 + 540) % 360) - 180)).toBeGreaterThan(POSTER.band.hueExclusion);
      }
    }
    expect(fallbacks).toBeGreaterThan(40);
    expect(fallbacks).toBeLessThan(360);
  });

  it('uses the fallback for a hue next to coral and the tint for a green one', () => {
    const coralName = byHue().find((n) => festivalTint(n).hue === 345)!;
    const greenName = byHue().find((n) => festivalTint(n).hue === 135)!;
    expect(posterBand(coralName).fallback).toBe(true);
    expect(posterBand(greenName)).toMatchObject({ fallback: false, colour: '#42f06e' });
  });
});
