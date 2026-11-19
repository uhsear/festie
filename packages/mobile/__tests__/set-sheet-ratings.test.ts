import { describe, expect, it } from 'vitest';
import { read } from './read-source';


describe('set sheet crowd and crew ratings', () => {
  it('SetRatingSummary uses the shared summary and tolerates a failed fetch', () => {
    const src = read('components/SetRatingSummary.tsx');
    expect(src).toContain('summarizeSetRatings');
    expect(src).toContain('fetchCrowdRatings');
    expect(src).toContain('Promise.allSettled');
  });

  it('RatingButtons renders SetRatingSummary', () => {
    expect(read('components/RatingButtons.tsx')).toContain('<SetRatingSummary');
  });
});
