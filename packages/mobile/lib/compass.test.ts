import { describe, it, expect } from 'vitest';
import { headingFromReading, needsCalibration, smoothHeading } from './compass';

describe('headingFromReading', () => {
  it('prefers trueHeading', () => {
    expect(headingFromReading({ trueHeading: 90, magHeading: 80 })).toBe(90);
  });
  it('falls back to magHeading when trueHeading is -1', () => {
    expect(headingFromReading({ trueHeading: -1, magHeading: 80 })).toBe(80);
  });
  it('normalises a negative magHeading', () => {
    expect(headingFromReading({ trueHeading: -1, magHeading: -10 })).toBe(350);
  });
});

describe('needsCalibration', () => {
  it('is true for levels 0 and 1 only', () => {
    expect([0, 1, 2, 3].map(needsCalibration)).toEqual([true, true, false, false]);
  });
});

describe('smoothHeading', () => {
  it('crosses 359 to 1 without passing through 180', () => {
    const out = smoothHeading(359, 1, 0.5);
    expect(out < 5 || out > 355).toBe(true);
  });
  it('returns next when there is no previous value', () => {
    expect(smoothHeading(null, 42, 0.15)).toBe(42);
  });
});
