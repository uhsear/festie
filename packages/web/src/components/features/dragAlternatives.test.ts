// WCAG 2.5.7: every drag gesture keeps a single-pointer alternative.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

const components = join(__dirname, '..');
const srcRoot = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(components, rel), 'utf8');

// Files that own a Drawer.Root. IOSInstallSheet reaches vaul through ui/Sheet, whose header holds the Close button.
const CHECKED_DRAWERS = ['features/DetailPanel.tsx', 'ui/Sheet.tsx'];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('drag gestures keep a button alternative', () => {
  it('set detail sheet has a Close button', () => {
    const src = read('features/DetailPanel.tsx');
    expect(src).toContain('Drawer.Root');
    expect(src).toContain('aria-label="Close detail panel"');
  });

  it('shared Sheet has a Close button, and the install sheet uses it', () => {
    const sheet = read('ui/Sheet.tsx');
    expect(sheet).toContain('Drawer.Root');
    expect(sheet).toContain('label="Close"');
    const install = read('features/IOSInstallSheet.tsx');
    expect(install).toContain("import Sheet from '../ui/Sheet'");
    expect(install).toContain('onCloseClick');
  });

  it('day strip swipe has day buttons', () => {
    const src = read('layout/SubHeader.tsx');
    expect(src).toContain('useSwipeDays');
    expect(src).toContain('handleDaySelect');
  });

  it('every file with a Drawer.Root is checked above', () => {
    const found = tsxFiles(srcRoot)
      .filter((f) => !f.endsWith('.test.tsx') && readFileSync(f, 'utf8').includes('Drawer.Root'))
      .map((f) => relative(components, f).split(sep).join('/'));
    expect(found.sort()).toEqual([...CHECKED_DRAWERS].sort());
  });
});
