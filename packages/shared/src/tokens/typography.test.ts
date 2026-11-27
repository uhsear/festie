import { describe, expect, it } from 'vitest';
import { typeRoles } from './typography.js';

describe('display tracking', () => {
  it('does not track Clash Display negatively below 48px, where neighbouring glyphs touch', () => {
    for (const role of ['display-lg', 'heading'] as const) {
      expect(typeRoles[role].letterSpacing).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the tight tracking on the 48px numeral role', () => {
    expect(typeRoles['display-xl'].letterSpacing).toBeLessThan(0);
  });
});
