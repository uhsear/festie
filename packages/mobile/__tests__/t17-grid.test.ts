// Source-level guards for the T17 mobile Grid changes. Mobile vitest runs in
// plain node with no RN renderer, so these read the files directly.
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('T17 mobile Grid (source-level guards)', () => {
  it('grid screen uses shared filtering and a day-aware title', () => {
    const src = read('app/grid.tsx');
    expect(src).toContain('getFilteredSets');
    expect(src).toContain('· Grid');
    expect(src).not.toContain("'Schedule grid'");
    expect(src).toContain('<ScheduleDayChips');
  });

  it('grid search empty state uses the shared copy and blames hidden-by-filter matches', () => {
    const src = read('app/grid.tsx');
    expect(src).toContain('searchEmptyCopy(');
    expect(src).toContain('searchHiddenByFilters(');
  });

  it('day chips honour hidden days and use typeStyle', () => {
    const src = read('components/ScheduleDayChips.tsx');
    expect(src).toContain('visibleDayIndexes');
    expect(src).toContain('typeStyle');
  });

  it('results row keeps its Clear all filters label', () => {
    expect(read('components/ScheduleResultsRow.tsx')).toContain('Clear all filters');
  });
});
