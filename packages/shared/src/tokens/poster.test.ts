import { describe, it, expect } from 'vitest';
import { POSTER } from './poster';
import { colors } from './colors';

describe('POSTER colours', () => {
  it('reads the ground, ink and priority colours from the shared tokens', () => {
    expect(POSTER.colors.ground).toBe(colors.bg.primary);
    expect(POSTER.colors.text).toBe(colors.text.primary);
    expect(POSTER.colors.muted).toBe(colors.text.muted);
    expect(POSTER.colors.priority).toEqual(colors.priority);
  });
});

describe('POSTER layout', () => {
  const { layout, padding, height, dominantSize } = POSTER;

  it('keeps the dominant object at 360 px or more and the weight at 700', () => {
    expect(dominantSize).toBeGreaterThanOrEqual(360);
    expect(layout.dominantHeight).toBeGreaterThanOrEqual(dominantSize);
    expect(POSTER.weight).toBe(700);
  });

  it('fits the dominant block and five rows between the header and the footer', () => {
    const rowsEnd = layout.bodyTop + layout.dominantBlock + layout.maxRows * layout.rowHeight;
    const footerTop = height - padding - layout.footerHeight;
    expect(layout.maxRows).toBe(5);
    expect(layout.headerTop + layout.headerHeight).toBeLessThanOrEqual(layout.bodyTop);
    expect(layout.dominantHeight).toBeLessThan(layout.dominantBlock);
    expect(rowsEnd).toBeLessThan(footerTop);
  });

  it('draws no glow tokens: the band replaces them', () => {
    expect(POSTER).not.toHaveProperty('glowAlpha');
    expect(POSTER.colors).not.toHaveProperty('glowBottom');
    expect(POSTER.band.height).toBeGreaterThan(0);
  });
});
