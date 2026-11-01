import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('haptic vocabulary (mobile)', () => {
  it('useHaptics uses the shared vocabulary and maps heavy and error on iOS', () => {
    const src = read('../hooks/useHaptics.ts');
    expect(src).toMatch(/import \{[^}]*VIBRATION_PATTERNS[^}]*\} from '@festie\/shared\/utils'/);
    expect(src).toMatch(/import \{[^}]*toAndroidPattern[^}]*\} from '@festie\/shared\/utils'/);
    expect(src).toMatch(/import \{[^}]*shouldBuzz[^}]*\} from '@festie\/shared\/utils'/);
    expect(src).toContain('ImpactFeedbackStyle.Heavy');
    expect(src).toContain('NotificationFeedbackType.Error');
  });

  it('CrewSos raises SOS with the heavy haptic only', () => {
    const src = read('CrewSos.tsx');
    expect(src).toContain('haptics.heavy()');
    expect(src).not.toContain('haptics.warning()');
  });
});
