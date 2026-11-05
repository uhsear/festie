import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const src = readFileSync(join(__dirname, 'grid.tsx'), 'utf8');

describe('mobile Grid screen', () => {
  it('snaps, zooms, fits two stages, picks on hold, offers pick actions to screen readers, marks clashes and shows TBA', () => {
    for (const needle of [
      'snapToOffsets',
      'snapToInterval={colW}',
      'GRID_ZOOM_LEVELS',
      'twoUpColumnWidth(',
      'holdToPick(',
      'accessibilityActions=',
      'ClashHatch',
      'ClashChip',
      'allTba',
    ]) {
      expect(src).toContain(needle);
    }
  });
  it('counts and clears the genre filter in the results row', () => {
    expect(src).toMatch(/const clearAllFilters = \(\) => \{[^}]*setActiveGenres\(\[\]\)/);
    expect(src).toContain('activeGenreCount: activeGenres.length');
  });
  it('shows crew-scoped avatars, falls back to the count on narrow tiles, and labels the tile', () => {
    for (const needle of ['getCrewScopedOtherPicks', 'buildGridCrewAvatarsBySet(', 'AVATAR_MIN_COL_W', 'size="xxs"', 'crew.label']) {
      expect(src).toContain(needle);
    }
    expect(src).not.toContain('getOverlapCount');
  });
  it('drops the fixed column width and scale', () => {
    expect(src).not.toContain('const COL_W = 132');
    expect(src).not.toContain('const PX_PER_MIN = 1.6');
  });
});
