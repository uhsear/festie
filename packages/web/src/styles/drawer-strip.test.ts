import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every vaul drawer becomes a centred dialog at lg (DetailPanel, IOSInstallSheet). vaul's ::after
// overscroll strip then hangs below the dialog as a blank tail (desktop report, 2026-10-29).
// vitest runs from packages/web; jsdom gives import.meta.url a non-file scheme.
const themeCss = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');
const vaulJs = readFileSync(createRequire(resolve(process.cwd(), 'package.json')).resolve('vaul'), 'utf8');

describe('vaul drawer strip on desktop', () => {
  it('theme.css hides the strip for every drawer at lg', () => {
    expect(themeCss).toMatch(/@media \(width >= 64rem\) \{\s*\[data-vaul-drawer\]::after \{\s*display: none;/);
  });

  it('vaul still draws the strip on the selector that rule targets', () => {
    // If a vaul upgrade renames the attribute or stops using ::after, re-check desktop dialogs.
    expect(vaulJs).toContain('[data-vaul-drawer]:not([data-vaul-custom-container=true])::after{');
    expect(vaulJs).not.toMatch(/\[data-vaul-drawer\][^{]*::after\{[^}]*display:/);
  });
});
