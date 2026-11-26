import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraDuration, unwrapAngle } from './mapMotion';

describe('unwrapAngle', () => {
  it('turns the short way across north', () => {
    expect(unwrapAngle(359, 1)).toBe(361);
    expect(unwrapAngle(1, 359)).toBe(-1);
  });

  it('keeps accumulating instead of wrapping back', () => {
    expect(unwrapAngle(361, 3)).toBe(363);
    expect(unwrapAngle(90, 90)).toBe(90);
  });

  it('never turns more than 180 degrees', () => {
    for (let prev = -720; prev <= 720; prev += 37) {
      for (let target = 0; target < 360; target += 11) {
        expect(Math.abs(unwrapAngle(prev, target) - prev)).toBeLessThanOrEqual(180);
        expect((((unwrapAngle(prev, target) - target) % 360) + 360) % 360).toBe(0);
      }
    }
  });
});

describe('cameraDuration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is 480 ms normally and 0 under reduced motion', () => {
    const mq = (matches: boolean) =>
      vi.stubGlobal('window', { matchMedia: () => ({ matches }) });
    mq(false);
    expect(cameraDuration()).toBe(480);
    mq(true);
    expect(cameraDuration()).toBe(0);
  });
});
