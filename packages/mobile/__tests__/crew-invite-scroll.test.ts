import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'app', '(tabs)', 'crew.tsx'), 'utf8');

describe('crew invite card scrolls with the tab body', () => {
  it('is not pinned in the crew chrome', () => {
    const chrome = src.slice(
      src.indexOf('<View style={[styles.crewChrome, tabletInset]}>'),
      src.indexOf('<CrewTabBar'),
    );
    expect(chrome).not.toContain('inviteCard');
  });

  it('renders once in each of the four scroll bodies', () => {
    expect(src.match(/\{inviteCard\}/g)?.length).toBe(4);
  });

  it('sits after SOS on Find so SOS stays visible without scrolling', () => {
    const find = src.indexOf("crewTab === 'find' ?");
    const sos = src.indexOf('<CrewSos', find);
    const card = src.indexOf('{inviteCard}', find);
    expect(sos).toBeGreaterThan(find);
    expect(card).toBeGreaterThan(sos);
    expect(card).toBeLessThan(src.indexOf('<CrewCheckIn', find));
  });

  it('keeps the iOS tab bar inset', () => {
    expect(src).toContain('IOS_NATIVE_TAB_BAR_HEIGHT + insets.bottom');
  });
});
