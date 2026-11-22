// Source-level guard (mobile vitest runs in plain node, no RN renderer).
import { read } from './read-source';

describe('root layout system colour scheme', () => {
  it('applies the scheme only after uiStore hydrated, so defaults never overwrite saved settings', () => {
    const src = read('app/_layout.tsx');
    expect(src).toContain('if (uiHydrated) applySystemScheme(systemScheme);');
    expect(src).toContain('followSystemTheme, systemScheme, uiHydrated]');
  });
});
