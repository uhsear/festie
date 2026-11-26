import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// DP-12: the drift ratchet lives in scripts/ci/design-ratchet.mjs, with its own planted-offender
// tests. This test runs the check inside the mobile suite so a rising count fails the mobile job.
const script = fileURLToPath(new URL('../../../scripts/ci/design-ratchet.mjs', import.meta.url));

describe('design drift ratchet (mobile)', () => {
  it('has no new hex, fontSize, fontFamily, Ionicons size, duration or animated offenders', () => {
    expect(() => execFileSync(process.execPath, [script, 'mobile'], { stdio: 'pipe' })).not.toThrow();
  });
});
