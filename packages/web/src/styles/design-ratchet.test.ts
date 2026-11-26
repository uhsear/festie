import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// DP-12: the drift ratchet lives in scripts/ci/design-ratchet.mjs, with its own planted-offender
// tests. This test runs the check inside the web suite so a rising count fails the web job.
const script = fileURLToPath(new URL('../../../../scripts/ci/design-ratchet.mjs', import.meta.url));

describe('design drift ratchet (web)', () => {
  it('has no new hex, rgb(), text-[N], duration-N or ease-[ease] offenders', () => {
    expect(() => execFileSync(process.execPath, [script, 'web'], { stdio: 'pipe' })).not.toThrow();
  });
});
