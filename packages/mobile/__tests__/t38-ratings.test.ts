import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

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
