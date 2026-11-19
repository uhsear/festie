import { describe, it, expect } from 'vitest';
import { contrastRatioRgb, relativeLuminance } from './contrast';

describe('contrastRatioRgb', () => {
  it('is 21 for black on white, in either order', () => {
    expect(contrastRatioRgb([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatioRgb([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
  });
  it('is 1 for identical colours', () => {
    expect(contrastRatioRgb([12, 99, 200], [12, 99, 200])).toBe(1);
  });
  it('matches the luminance formula', () => {
    const l = relativeLuminance(119, 119, 119);
    expect(contrastRatioRgb([119, 119, 119], [255, 255, 255])).toBeCloseTo(1.05 / (l + 0.05), 10);
  });
});
