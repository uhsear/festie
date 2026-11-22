import { describe, it, expect } from 'vitest';
import { read } from './read-source';


describe('crew compare source guards', () => {
  it('crew-compare reads the shared crew hooks and the profile refresh', () => {
    const src = read('app/crew-compare.tsx');
    for (const needle of [
      'useCrewCompare(',
      'useCrewFestival(',
      'useActiveCrew(',
      'Most picked',
      'to my picks',
      'CrewCompareSummary',
    ]) {
      expect(src).toContain(needle);
    }
  });
  it('the shared hook owns the profile refresh the screen waits on', () => {
    expect(read('app/crew-compare.tsx')).toContain('useCrewCompare(sort, ready)');
    expect(read('../shared/src/hooks/useCrewCompare.ts')).toContain('loadProfiles(');
  });
  it('crew-compare shows a loading state before the solo copy', () => {
    const src = read('app/crew-compare.tsx');
    expect(src.indexOf('if (loading)')).toBeGreaterThan(-1);
    expect(src.indexOf('if (loading)')).toBeLessThan(src.indexOf('if (alone)'));
  });
  it('the crew full notice shows in the members invite bar and the join consent line hides when full', () => {
    expect(read('components/crew/CrewMembersTab.tsx')).toContain('crewCopy.inviteCrewFull(isOwner)');
    expect(read('app/join/[code].tsx')).toMatch(/\{!full \? \(\s*<Text[^>]*>\s*Crew members can see your picks/);
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
