import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('mobile timeline height (FND-025)', () => {
  it('keeps the carousel bound to its parent so the column scroll reaches the bottom', () => {
    expect(read('../components/TimelineView.tsx')).not.toMatch(/minHeight: Math\.round\(windowHeight/);
  });
  it('scrolls the timeline controls away with the page so the timeline gets the full viewport', () => {
    const src = read('../app/(tabs)/index.tsx');
    expect(src).not.toMatch(/maxHeight: Math\.round\(height \* 0\.3\)/);
    expect(src).toMatch(/onLayout=\{\(e\) => setTimelineViewportH\(/);
    expect(src).toMatch(/\{controls\}<\/View>\s*\{hasTimeline \? \(\s*<>\s*<View style=\{\[styles\.timelineBody, \{ height: timelineViewportH/);
  });
  it('lets Android columns scroll inside the page scroll', () => {
    expect(read('../components/TimelineView.tsx')).toMatch(/nestedScrollEnabled/);
  });
  it('docks the TBA list below the timeline in the page scroll, not inside the fixed-height body', () => {
    const src = read('../app/(tabs)/index.tsx');
    expect(src).not.toMatch(/<ScrollView style=\{\{ flexGrow: 0, maxHeight: Math\.round\(height \* 0\.4\)/);
    expect(src).toMatch(/<\/View>\s*\{\/\*[^]*?\*\/\}\s*\{tbaSection\}\s*<\/>/);
    expect(src).toMatch(/snapToEnd=\{false\}/);
  });
});
