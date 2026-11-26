// Source-level guards for the Lineup chrome cut (DP-34). Mobile vitest runs in plain node.
import { read } from './read-source';

describe('Lineup view switcher', () => {
  const src = read('components/schedule/ScheduleViewSwitcher.tsx');

  it('keeps Grid out of the segmented control', () => {
    expect(src).toContain("!== 'grid'");
    expect(src).not.toContain('VIEW_OPTIONS_WITH_GRID');
    expect(src).toContain('options={VIEW_OPTIONS}');
    expect(src).toContain('onChange={setScheduleView}');
  });

  it('offers Full grid as a push action only when the festival has timed sets', () => {
    expect(src).toMatch(/festivalHasTimedSets \? \(\s*<TouchableOpacity\s+testID="full-grid-action"/);
    expect(src).toContain("router.push('/grid')");
    expect(src).toContain('accessibilityLabel="Full grid"');
  });
});

describe('Lineup controls', () => {
  const controls = read('components/schedule/ScheduleControls.tsx');

  it('puts Group by in the filters panel, on Cards only', () => {
    expect(controls).toContain("const showGroupBy = viewMode === 'cards' && filteredSets.length > 0;");
    expect(controls).toMatch(/\{showGroupBy \? \(\s*<View style=\{\[styles\.groupByRow/);
    expect(controls).toContain('|| showGroupBy) ? (');
    expect(read('components/schedule/ScheduleCardsView.tsx')).not.toContain('Group by');
  });

  it('folds the phase shortcuts into the status line row', () => {
    const row = controls.slice(controls.indexOf('styles.freshnessRow'), controls.indexOf('Refresh schedule'));
    expect(row).toContain('<ScheduleStatusLine');
    expect(row).toContain('<PhaseHomeActions compact');
    expect(controls).not.toMatch(/<View style=\{\{ paddingHorizontal: hPad \}\}>\s*<PhaseHomeActions/);
  });
});
