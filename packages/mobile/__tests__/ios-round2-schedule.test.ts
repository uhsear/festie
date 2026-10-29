// Source-level guards for the iOS round-2 schedule/sheet fixes. Mobile vitest
// runs in plain node with no RN renderer, so these read the files directly.
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('iOS round 2 — schedule and set sheet (source-level guards)', () => {
  it('Schedule tab: guest pick routes to login, TBA empty state offers Cards, Cards header cancels hPad', () => {
    const src = read('app/(tabs)/index.tsx');
    const handler = src.slice(src.indexOf('const handlePickChange'), src.indexOf('clearAllFilters'));
    expect(handler).toContain('if (!currentProfile)');
    expect(handler).toContain('/(auth)/login');
    expect(src).toContain("label: 'Show Cards'");
    expect(src).toContain('ListHeaderComponentStyle');
  });

  it('TBASection subtracts the section border from the inner width', () => {
    expect(read('components/TBASection.tsx')).toContain('t.spacing[4] * 4 + 2');
  });

  it('set sheet: iOS top inset skips the status bar and link buttons keep a 44pt target', () => {
    const src = read('app/set/[setId].tsx');
    expect(src).toContain("Platform.OS === 'ios' ? t.spacing[3]");
    const linkButton = src.match(/\blinkButton:\s*\{([^}]*)\}/s);
    expect(linkButton).not.toBeNull();
    expect(linkButton![1]).toContain('minHeight: 44');
  });

  it('DisplayWords applies the display word spacing and ScreenHeader uses it', () => {
    expect(read('components/DisplayWords.tsx')).toContain('wordSpacing.display');
    expect(read('components/ScreenHeader.tsx')).toContain('<DisplayWords');
  });

  it('join screen hides join actions for an invalid invite', () => {
    expect(read('app/join/[code].tsx')).toContain("inviteStatus !== 'invalid'");
  });
});
