import { describe, expect, it } from 'vitest';
import { read } from './read-source';

const src = read('app/(tabs)/crew.tsx');
const findTab = read('components/crew/CrewFindTab.tsx');

describe('crew invite card scrolls with the tab body', () => {
  it('is not pinned in the crew chrome', () => {
    const chrome = src.slice(
      src.indexOf('<View style={[styles.crewChrome, tabletInset]}>'),
      src.indexOf('<CrewTabBar'),
    );
    expect(chrome).not.toContain('inviteCard');
  });

  it('renders once in each of the four scroll bodies', () => {
    const tabs = ['Members', 'Plan', 'Find', 'Money'].map((name) => read(`components/crew/Crew${name}Tab.tsx`));
    for (const tab of tabs) expect(tab.match(/\{inviteCard\}/g)?.length).toBe(1);
    expect(src.match(/inviteCard=\{inviteCard\}/g)?.length).toBe(4);
  });

  it('sits after SOS on Find so SOS stays visible without scrolling', () => {
    const sos = findTab.indexOf('<CrewSos');
    const card = findTab.indexOf('{inviteCard}');
    expect(sos).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(sos);
    expect(card).toBeLessThan(findTab.indexOf('<CrewCheckIn'));
  });

  it('keeps the iOS tab bar inset', () => {
    expect(src).toContain('IOS_NATIVE_TAB_BAR_HEIGHT + insets.bottom');
  });
});
