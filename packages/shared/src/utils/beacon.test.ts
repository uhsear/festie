import { describe, it, expect } from 'vitest';
import { BEACON_FLASH_MS, beaconColors } from './beacon';
import { relativeLuminance } from './contrast';

describe('beaconColors', () => {
  it('is stable per name and alternates with white', () => {
    expect(beaconColors('Sam').primary).toBe(beaconColors('Sam').primary);
    expect(beaconColors('Sam').alternate).toBe('#FFFFFF');
  });

  it('flashes at 1 Hz', () => {
    expect(BEACON_FLASH_MS).toBe(500);
  });
});

// WCAG 2.3.1: a flash is a pair of opposing luminance changes of 10 percent or more (with the
// darker state under 0.8). More than 3 flashes in any one second fails. A saturated red flash
// (red share of R+G+B at 0.8 or more) is stricter, so no palette pair may be red-dominant.
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

describe('beacon flash safety (WCAG 2.3.1)', () => {
  it('stays under 3 flashes per second', () => {
    const flashesPerSecond = 1000 / (BEACON_FLASH_MS * 2);
    expect(flashesPerSecond).toBeLessThanOrEqual(3);
  });

  it('never pairs white with a red-dominant colour, for every hue, saturation and lightness the palette can produce', () => {
    const white = relativeLuminance(255, 255, 255);
    for (let h = 0; h < 268; h++) {
      const hue = h < 139 ? 21 + h : 206 + (h - 139);
      for (let sat = 62; sat <= 73; sat++) {
        for (let light = 46; light <= 55; light++) {
          const [r, g, b] = hslToRgb(hue, sat / 100, light / 100);
          expect(r / (r + g + b), `hsl(${hue} ${sat}% ${light}%)`).toBeLessThan(0.8);
          expect(relativeLuminance(r, g, b)).toBeLessThan(white);
        }
      }
    }
  });
});
