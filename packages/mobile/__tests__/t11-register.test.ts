import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'app/(auth)/register.tsx'), 'utf8');

describe('register terms checkbox', () => {
  it('checkbox and both plain sentence parts toggle terms', () => {
    expect(src.split('onPress={toggleTos}').length - 1).toBeGreaterThanOrEqual(3);
  });
  it('tosCheckbox style has a minimum target height', () => {
    expect(src).toMatch(/tosCheckbox: \{[^}]*minHeight/);
  });
});
