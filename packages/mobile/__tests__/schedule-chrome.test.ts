// Source-level guards for the Lineup chrome cut (DP-34). Mobile vitest runs in plain node.
import { read } from './read-source';

describe('Lineup view switcher', () => {
  const src = read('components/schedule/ScheduleViewSwitcher.tsx');

  it('keeps Grid out of the segmented control', () => {
    expect(src).toContain("!== 'grid'");
    expect(src).not.toContain('VIEW_OPTIONS_WITH_GRID');
    expect(src).toContain('options={flyerShowing ? FLYER_OPTIONS : VIEW_OPTIONS}');
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
    const row = controls.slice(controls.indexOf('const statusItems'), controls.indexOf('  return (\n<>'));
    expect(row).toContain('<ScheduleStatusLine');
    expect(row).toContain('<PhaseHomeActions compact');
    expect(controls).not.toMatch(/<View style=\{\{ paddingHorizontal: hPad \}\}>\s*<PhaseHomeActions/);
  });

  it('keeps the Timeline status chips on one scrolling line and wraps them on Cards', () => {
    expect(controls).toMatch(/viewMode === 'timeline' \? \(\s*<ScrollView\s+horizontal/);
    expect(controls).toContain('fadingEdgeLength');
    expect(controls).toMatch(/<View style=\{\[styles\.freshnessRow, \{ paddingHorizontal: hPad \}\]\}>\{statusItems\}<\/View>/);
    expect(controls).toContain('inline={timeline}');
    expect(read('components/PhaseHomeActions.tsx')).toContain('if (compact && inline) return content;');
    const styles = read('components/schedule/styles.ts');
    expect(styles).toMatch(/compactRefreshButton: \{\s*minWidth: 32,\s*minHeight: 32,/);
  });

  it('wraps the Cards status row so a phase chip drops to the next line whole instead of clipping', () => {
    const styles = read('components/schedule/styles.ts');
    expect(styles).toMatch(/freshnessRow: \{[^}]*flexWrap: 'wrap'/);
    const chips = read('components/PhaseHomeActions.tsx');
    expect(chips).toMatch(/rowCompact: \{[^}]*flexWrap: 'wrap'/);
    // The wrapped compact chips sit in a plain View: a horizontal ScrollView cannot wrap and cuts the last chip.
    expect(chips).toMatch(/<View style=\{styles\.rowCompact\}>/);
  });

  it('keeps the offline chip in the status row, mounted in both views for its reminder', () => {
    const row = controls.slice(controls.indexOf('const statusItems'), controls.indexOf('  return (\n<>'));
    expect(row).toContain('{user ? <OfflineStatusChip remind /> : null}');
    expect(controls).toContain('{statusItems}');
  });

  it('keeps the offline chip as short as the phase chips, with a 44 pt touch target', () => {
    const chip = read('components/OfflineStatusChip.tsx');
    expect(chip).toMatch(/chipButton: \{\s*minHeight: 32,/);
    expect(chip).toContain('hitSlop={CHIP_HIT_SLOP}');
  });

  it('shows the Now strip on Cards only, since the Timeline has its own up-next line and the header Now pill', () => {
    expect(controls).toMatch(/viewMode === 'cards' \? \(\s*<View style=\{\{ paddingHorizontal: hPad \}\}>\s*<NowNextStrip/);
  });

  it('puts the clash chip and the up-next line on one Timeline row and hides the how-to line once a set is picked', () => {
    const src = read('components/TimelineView.tsx');
    expect(src).toMatch(/\{picked === 0 \? \(\s*<View style=\{styles\.hintRow\}>/);
    expect(src).toMatch(/<View style=\{styles\.statusRow\}>\s*<ClashChip count=\{count\} picked=\{picked\} \/>\s*\{nextPickLabel \? \(/);
  });
});
