import { describe, it, expect } from 'vitest';
import { INTRO_INITIAL_PICKS, INTRO_LINEUP, countIntroPicks, cycleIntroPick, findIntroClash } from './introLineup';

describe('intro lineup model', () => {
  it('cycles none, must, want-to-see, maybe and back', () => {
    expect(cycleIntroPick(null)).toBe('must');
    expect(cycleIntroPick('must')).toBe('want-to-see');
    expect(cycleIntroPick('want-to-see')).toBe('maybe');
    expect(cycleIntroPick('maybe')).toBeNull();
  });

  it('starts with no clash and two picks', () => {
    expect(findIntroClash(INTRO_INITIAL_PICKS)).toBeNull();
    expect(countIntroPicks(INTRO_INITIAL_PICKS)).toBe(2);
  });

  it('draws one clash once the overlapping set is picked', () => {
    const clash = findIntroClash({ ...INTRO_INITIAL_PICKS, b: cycleIntroPick(INTRO_INITIAL_PICKS.b ?? null) });
    expect(clash?.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('never clashes the non-overlapping set', () => {
    const all = Object.fromEntries(INTRO_LINEUP.map((s) => [s.id, 'must' as const]));
    expect(findIntroClash(all)?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(findIntroClash({ a: null, b: 'must', c: 'must' })).toBeNull();
  });
});
