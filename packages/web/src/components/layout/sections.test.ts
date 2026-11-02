import { describe, it, expect } from 'vitest';
import { activeSection } from './sections';

describe('activeSection', () => {
  it('maps schedule views to lineup', () => {
    expect(activeSection('/')).toBe('lineup');
    expect(activeSection('/grid')).toBe('lineup');
  });
  it('keeps crew active on crew-plan and compare', () => {
    expect(activeSection('/crew-plan')).toBe('crew');
    expect(activeSection('/compare')).toBe('crew');
  });
  it('maps wrap to more and /map to map', () => {
    expect(activeSection('/wrap')).toBe('more');
    expect(activeSection('/map')).toBe('map');
  });
  it('returns null for unrelated paths', () => {
    expect(activeSection('/festival-mode')).toBeNull();
    expect(activeSection('/login')).toBeNull();
  });
});
