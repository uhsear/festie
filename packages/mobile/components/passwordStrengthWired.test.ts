import { describe, expect, it } from 'vitest';
import { read } from '../__tests__/read-source';

describe('every new-password field shows the strength meter', () => {
  it.each(['components/AccountPasswordSection.tsx', 'app/(auth)/register.tsx', 'app/reset-password.tsx'])('%s', (file) => {
    expect(read(file)).toContain('<PasswordStrengthMeter');
  });

  it('PasswordStrengthMeter reads the shared heuristic and announces the label', () => {
    const src = read('components/PasswordStrengthMeter.tsx');
    expect(src).toContain('passwordStrength(');
    expect(src).toContain('Password strength: ');
  });
});
