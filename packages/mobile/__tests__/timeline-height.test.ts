import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('mobile timeline height (FND-025)', () => {
  it('keeps the carousel bound to its parent so the column scroll reaches the bottom', () => {
    expect(read('../components/TimelineView.tsx')).not.toMatch(/minHeight: Math\.round\(windowHeight/);
  });
  it('bounds the fixed timeline controls in a scroll so they cannot push the timeline off screen', () => {
    expect(read('../app/(tabs)/index.tsx')).toMatch(
      /<ScrollView style=\{\{ flexGrow: 0, maxHeight: Math\.round\(height \* 0\.3\) \}\}[^>]*>\s*\{controls\}/,
    );
  });
});
