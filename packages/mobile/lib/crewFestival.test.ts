import { describe, it, expect } from 'vitest';
import { festivalForCrew } from './crewFestival';

const B = { id: 'b' };

describe('festivalForCrew', () => {
  it('returns the current festival when the crew belongs to it', () => {
    expect(festivalForCrew({ festivalId: 'b' }, B)).toBe(B);
  });
  it('returns the current festival for a crew with no festival', () => {
    expect(festivalForCrew({ festivalId: null }, B)).toBe(B);
  });
  it('returns null when the crew belongs to a different festival', () => {
    expect(festivalForCrew({ festivalId: 'a' }, B)).toBeNull();
  });
  it('returns null without a current festival', () => {
    expect(festivalForCrew({ festivalId: 'a' }, null)).toBeNull();
  });
});
