import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const src = readFileSync(join(__dirname, 'grid.tsx'), 'utf8');

describe('mobile Grid screen', () => {
  it('snaps, zooms, fits two stages, picks on hold, marks clashes and shows TBA', () => {
    for (const needle of [
      'snapToOffsets',
      'snapToInterval={colW}',
      'GRID_ZOOM_LEVELS',
      'twoUpColumnWidth(',
      'holdToPick(',
      'ClashHatch',
      'ClashChip',
      'allTba',
    ]) {
      expect(src).toContain(needle);
    }
  });
  it('drops the fixed column width and scale', () => {
    expect(src).not.toContain('const COL_W = 132');
    expect(src).not.toContain('const PX_PER_MIN = 1.6');
  });
});
