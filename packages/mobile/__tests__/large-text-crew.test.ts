import { describe, expect, it } from 'vitest';
import { read } from './read-source';


describe('T10 crew large-text guards', () => {
  it('CrewStatus has the one-sentence banner and a wrapping empty line', () => {
    const src = read('components/CrewStatus.tsx');
    expect(src).toContain('CREW_STATUS_HONESTY');
    expect(src).not.toContain('not live tracking');
    expect(src).not.toContain('<Text style={styles.emptyText} numberOfLines={1}>');
    expect(src).toContain('<Text style={styles.emptyText}>');
  });

  it('CrewSos has no raise button: the one SosControl raises', () => {
    const src = read('components/CrewSos.tsx');
    expect(src).not.toContain('useSosRaise');
    expect(src).not.toContain('Alerts your whole crew');
  });

  it('CrewTabBar drops icons, not labels, at large text and keeps a11y and testID', () => {
    const src = read('components/CrewTabBar.tsx');
    expect(src).toContain('useLargeText()');
    expect(src).toContain('{!largeText ? (');
    expect(src).not.toContain('!largeText || active');
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
