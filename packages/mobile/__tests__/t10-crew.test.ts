import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('T10 crew large-text guards', () => {
  it('CrewStatus has the one-sentence banner and a wrapping empty line', () => {
    const src = read('components/CrewStatus.tsx');
    expect(src).toContain('Not live: each status shows when that crewmate last had signal.');
    expect(src).not.toContain('not live tracking');
    expect(src).not.toContain('<Text style={styles.emptyText} numberOfLines={1}>');
    expect(src).toContain('<Text style={styles.emptyText}>');
  });

  it('CrewSos has the short note', () => {
    expect(read('components/CrewSos.tsx')).toContain('Alerts your whole crew. Needs signal to send.');
  });

  it('CrewTabBar hides inactive labels at large text but keeps a11y and testID', () => {
    const src = read('components/CrewTabBar.tsx');
    expect(src).toContain('useLargeText()');
    expect(src).toContain('accessibilityLabel=');
    expect(src).toContain('testID={`crew-tab-${tab.key}`}');
  });

  it('crew.tsx wraps the invite buttons and keeps their testIDs', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).toContain('inviteActions');
    expect(src).toContain('crew-action-share-invite');
    expect(src).toContain('crew-action-regenerate-invite');
    expect(src).toContain('useLargeText()');
  });
});
