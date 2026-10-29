import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('ios round 2 shell source guards', () => {
  it('root layout hides the back label and syncs the iOS colour scheme', () => {
    const src = read('app/_layout.tsx');
    expect(src).toContain("headerBackButtonDisplayMode: 'minimal'");
    expect(src).toContain('Appearance.setColorScheme');
  });
  it('OfflineMap FABs clear the home indicator and meet 44pt', () => {
    const src = read('components/OfflineMap.tsx');
    expect(src).toContain('useSafeAreaInsets');
    expect(src).toContain('insets.bottom');
    const block = src.slice(src.indexOf('  dropPinButton: {'), src.indexOf('  dropPinButtonActive: {'));
    expect(block).not.toContain('minHeight: 40');
  });
  it('admin screen uses the native header', () => {
    expect(read('app/admin/index.tsx')).not.toContain('headerShown: false');
  });
  it('history rank numerals are not medal-coloured', () => {
    expect(read('components/AccountHistorySection.tsx')).not.toContain('color: MEDAL[i]');
  });
  // A visible field label that repeats an input's accessibilityLabel made VoiceOver read the name twice and
  // made Maestro's tapOn: "Password" hit the label, not the field (iOS sweep, 2026-10-29).
  it('auth field labels do not duplicate the input accessibility label', () => {
    for (const file of ['app/(auth)/login.tsx', 'app/(auth)/register.tsx', 'app/(auth)/forgot-password.tsx']) {
      const src = read(file);
      const inputNames = new Set(
        [...src.matchAll(/<TextInput\b(?:(?!\/>)[\s\S])*?accessibilityLabel="([^"]+)"/g)].map((m) => m[1]),
      );
      for (const m of src.matchAll(/<Text\b([^>]*)>\s*([^<{]+?)\s*<\/Text>/g)) {
        if (inputNames.has(m[2]!)) expect(m[1], `${file}: label "${m[2]}"`).toContain('accessible={false}');
      }
    }
  });
  it('privacy shows the effective date', () => {
    expect(read('app/privacy.tsx')).toContain('Effective May 31, 2026');
  });
});
