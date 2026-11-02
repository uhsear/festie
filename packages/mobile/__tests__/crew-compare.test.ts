import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('crew compare source guards', () => {
  it('crew-compare reads the shared crew hooks and the profile refresh', () => {
    const src = read('app/crew-compare.tsx');
    for (const needle of [
      'useCrewCompare(',
      'useCrewFestival(',
      'useActiveCrew(',
      'loadProfiles(',
      'Most picked',
      'to my picks',
      'CrewCompareSummary',
    ]) {
      expect(src).toContain(needle);
    }
  });
  it('crew-compare no longer refreshes through loadOverlap', () => {
    expect(read('app/crew-compare.tsx')).not.toContain('loadOverlap(');
  });
  it('CrewCompareSummary has the free-together strip and the colour key', () => {
    const src = read('components/CrewCompareSummary.tsx');
    expect(src).toContain('Free together');
    expect(src).toContain('Crew colour key');
  });
  it('CrewCompareSummary shows the split and together lists', () => {
    const src = read('components/CrewCompareSummary.tsx');
    expect(src).toContain('Split');
    expect(src).toContain('Together');
    expect(read('app/crew-compare.tsx')).toContain('split={split}');
  });
  it('CrewSuggestionStrip takes a title', () => {
    expect(read('components/CrewSuggestionStrip.tsx')).toContain('title');
  });
});
