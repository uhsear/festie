import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-level guards: mobile tests run in plain node with no RN render harness.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('crew list removal uses Undo toasts', () => {
  it.each(['CrewPacking.tsx', 'CrewRides.tsx', 'CrewMeetingPoints.tsx'])('%s removes with Undo, not an alert', (file) => {
    const src = read(file);
    expect(src).toContain('useUndoableRemove(');
    expect(src).not.toContain("Alert.alert('Remove");
  });

  it('mounts the Toaster once in the root layout', () => {
    expect(read('../app/_layout.tsx')).toContain('<Toaster');
  });

  it('Toaster uses reduce-motion, shared motion tokens and the Undo action', () => {
    const src = read('Toaster.tsx');
    expect(src).toContain('useReduceMotion');
    expect(src).toContain('durationEffects');
    expect(src).toContain('onUndo');
  });
});
