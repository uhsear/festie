// Source-level guards for the admin screens (no RN renderer in mobile vitest).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const screens = readdirSync(here).filter((f) => f.endsWith('.tsx'));

describe('admin screens', () => {
  it('finds the admin screens', () => {
    expect(screens.length).toBeGreaterThanOrEqual(11);
  });

  it.each(screens)('%s is a default-exported screen gated on isAdmin', (file) => {
    const src = readFileSync(join(here, file), 'utf8');
    expect(src).toMatch(/export default function \w+/);
    expect(src).toContain('useAuthStore((s) => s.isAdmin)');
  });

  it('the root layout blocks non-admins from the admin segment', () => {
    const layout = readFileSync(join(here, '..', '_layout.tsx'), 'utf8');
    expect(layout).toContain("seg[0] === 'admin' && !!user && !isAdmin");
  });
});
