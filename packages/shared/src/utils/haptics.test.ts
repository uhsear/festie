import { describe, it, expect } from 'vitest';
import { VIBRATION_PATTERNS, shouldBuzz, toAndroidPattern, type HapticKind } from './haptics';

const KINDS: HapticKind[] = ['selection', 'light', 'success', 'warning', 'error', 'heavy'];
const total = (p: number | number[]) => (typeof p === 'number' ? p : p.reduce((a, b) => a + b, 0));

describe('haptics vocabulary', () => {
  it('has a pattern for every kind', () => {
    expect(Object.keys(VIBRATION_PATTERNS).sort()).toEqual([...KINDS].sort());
  });

  it('starts array patterns with ON (odd length)', () => {
    for (const p of Object.values(VIBRATION_PATTERNS)) {
      if (Array.isArray(p)) expect(p.length % 2).toBe(1);
    }
  });

  it('gives heavy the largest total', () => {
    const heavy = total(VIBRATION_PATTERNS.heavy);
    for (const kind of KINDS.filter((k) => k !== 'heavy')) {
      expect(total(VIBRATION_PATTERNS[kind])).toBeLessThan(heavy);
    }
  });

  it('converts to Android patterns', () => {
    expect(toAndroidPattern(15)).toBe(15);
    expect(toAndroidPattern([30, 50, 30])).toEqual([0, 30, 50, 30]);
  });

  it('always buzzes heavy, and nothing else when disabled', () => {
    expect(shouldBuzz('light', false)).toBe(false);
    expect(shouldBuzz('heavy', false)).toBe(true);
    expect(shouldBuzz('light', true)).toBe(true);
  });
});
