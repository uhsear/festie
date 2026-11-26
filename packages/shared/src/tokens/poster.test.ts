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
