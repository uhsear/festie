import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const index = () => read('../app/(tabs)/index.tsx');

describe('Schedule tab audit fixes', () => {
  it('retries a missing festival once per id, not in an endless loop', () => {
    const src = index();
    expect(src).toMatch(/reloadTriedRef\.current === currentFestivalId\) return;/);
    expect(src).toMatch(/reloadTriedRef\.current = currentFestivalId;/);
  });
  it('keeps one page ScrollView for timeline and fallback so the search input is not remounted', () => {
    const src = index();
    expect(src).toMatch(/const hasTimeline = timeBounds !== null && visibleStages\.length > 0;/);
    expect(src).not.toMatch(/\) : timeBounds && visibleStages\.length > 0 \? \(/);
    expect(src.match(/ref=\{timelineScrollRef\}/g)).toHaveLength(1);
  });
  it('scrolls the controls into view when Search or Filters opens', () => {
    const src = index();
    expect(src).toMatch(/timelineScrollRef\.current\?\.scrollTo\(\{ y: 0/);
    expect(src).toMatch(/\} else \{\s*revealControls\(\);\s*setShowSearch\(true\);/);
    expect(src).toMatch(/if \(!filtersOpen\) revealControls\(\);/);
  });
  it('only snaps the timeline page when the controls fit the viewport', () => {
    expect(index()).toMatch(/timelineControlsH <= timelineViewportH/);
  });
  it('scrolls the selected day chip into view', () => {
    const src = read('../components/ScheduleDayChips.tsx');
    expect(src).toMatch(/ref=\{scrollRef\}/);
    expect(src).toMatch(/scrollRef\.current\?\.scrollTo\(\{ x: Math\.max\(0, x - hPad\)/);
    expect(src).toMatch(/chipX\.current\.set\(day\.index/);
  });
  it('unfolds Earlier today for a search or when nothing is left to come', () => {
    const src = index();
    expect(src).toMatch(/const showEarlier = earlierOpen \|\| restSets\.length === 0 \|\| searchQuery\.trim\(\) !== '';/);
    expect(src).toMatch(/earlierSets\.length > 0 && !showEarlier/);
  });
  it('clamps the timeline active page when a stage filter shrinks the carousel', () => {
    expect(read('../components/TimelineView.tsx')).toMatch(
      /if \(activePage >= visibleStages\.length\) setActivePage\(Math\.max\(0, visibleStages\.length - 1\)\)/,
    );
  });
  it('offers genre chips on single-stage festivals', () => {
    const src = index();
    expect(src).not.toMatch(/stages\.length > 1 && genreChips\.length > 0/);
    expect(src).toMatch(/\{genreChips\.length > 0 \? \(/);
  });
});
