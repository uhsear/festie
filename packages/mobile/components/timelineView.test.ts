import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('mobile TimelineView', () => {
  const src = read('TimelineView.tsx');
  it('wires hold-to-pick, end times, clash hatch and chip', () => {
    expect(src).toContain('holdToPick(');
    expect(src).toContain('fmtShort(s.endTime)');
    expect(src).toContain('ClashHatch');
    expect(src).toContain('ClashChip');
  });
  it('drops onPickChange and coral clash styling', () => {
    expect(src).not.toContain('onPickChange');
    expect(src).not.toMatch(/mark &&[^\n]*accent\.coral/);
  });
  it('does not pass conflictIds to TimelineView', () => {
    const tabs = read('../app/(tabs)/index.tsx');
    const start = tabs.indexOf('<TimelineView');
    const call = tabs.slice(start, tabs.indexOf('/>', start));
    expect(call).not.toContain('conflictIds=');
  });
});
