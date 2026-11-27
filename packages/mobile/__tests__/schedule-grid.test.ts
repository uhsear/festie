// Source-level guards for the T17 mobile Grid changes. Mobile vitest runs in
// plain node with no RN renderer, so these read the files directly.
import { read } from './read-source';


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

  it('grid and timeline set blocks lay the pick and clash badge beside the title, not over it', () => {
    for (const file of ['app/grid.tsx', 'components/TimelineView.tsx']) {
      const src = read(file);
      const iconRow = src.slice(src.indexOf('  iconRow: {'), src.indexOf('  },', src.indexOf('  iconRow: {')));
      expect(iconRow).not.toContain("position: 'absolute'");
      expect(src).toMatch(/titleRow: \{\s*flexDirection: 'row'/);
    }
  });

  it('grid and timeline blocks inset the title from the clash hatch', () => {
    const grid = read('app/grid.tsx');
    expect(grid).toMatch(/cellClashed: \{\s*paddingLeft: t\.spacing\[3\]/);
    expect(grid.match(/styles\.cell, cellStyle, hatchInset/g)).toHaveLength(2);
    const timeline = read('components/TimelineView.tsx');
    expect(timeline).toMatch(/setBlockClashed: \{\s*paddingLeft: t\.spacing\[3\]/);
    expect(timeline).toContain('mark ? styles.setBlockClashed : null');
  });

  it('day chips leave room for two chips inside the gutter at font scale 1.3', () => {
    const src = read('components/ScheduleDayChips.tsx');
    const chip = src.slice(src.indexOf('  dayChip: {'), src.indexOf('  dayChipBg: {'));
    expect(chip).toContain('paddingHorizontal: t.spacing[4]');
    expect(chip).not.toContain('paddingHorizontal: t.spacing[6]');
  });

  it('grid time gutter widens at large text so "12PM" keeps clear of the screen edge', () => {
    const src = read('app/grid.tsx');
    expect(src).toContain('const GUTTER_W_LARGE = 56');
    expect(src).toContain('const gutterW = useLargeText() ? GUTTER_W_LARGE : GUTTER_W');
    expect(src).toContain('twoUpColumnWidth(windowW, gutterW)');
    expect(src).toContain('<View style={[styles.corner, { width: gutterW }]} />');
  });

  it('grid cell title takes as many lines as the cell height allows instead of a fixed two', () => {
    const src = read('app/grid.tsx');
    expect(src).toContain('numberOfLines={cellTitleLines(height, textScale, height >= 48)}');
    expect(src).toContain('const textScale = Math.min(fontScale, MAX_FONT_SCALE)');
  });

  it('results row keeps its Clear all filters label', () => {
    expect(read('components/ScheduleResultsRow.tsx')).toContain('Clear all filters');
  });
});
