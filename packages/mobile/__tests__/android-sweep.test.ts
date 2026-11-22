import { describe, it, expect } from 'vitest';
import { read } from './read-source';

// Source-level guards for the Android device sweep: mobile tests run in plain node with no RN render harness.

describe('android sweep', () => {
  it('audit search input is not flex:1 inside the column search box (it collapsed to zero height)', () => {
    const field = read('app/admin/audit.tsx').match(/useFilterStyles = makeStyles\(\(t\) => \(\{\s*field: \{([^}]*)\}/)![1]!;
    expect(field).not.toMatch(/flex:/);
  });

  it('crew tab hides the section load failure while offline', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).toContain('const sectionLoadError = offlineMode ? null : loadedSectionsError;');
    expect(src.indexOf('const offlineMode = useUIStore')).toBeLessThan(src.indexOf('useCrewSections(activeCrew?.id)'));
  });

  it('offline chip shows the alert style only when a step failed', () => {
    const src = read('components/OfflineStatusChip.tsx');
    expect(src).toContain("overall === 'partial' && summary.hasError");
    expect(src).toContain('summary.pending.join');
    expect(read('components/OfflineReadinessCard.tsx')).toContain("summary.overall === 'partial' && summary.hasError");
  });

  it('picks actions wrap two per row at large text', () => {
    const header = read('components/picks/PicksHeader.tsx');
    expect(header).toContain('useLargeText()');
    expect(header).toContain('styles.headerActionsLarge');
    expect(read('components/picks/PicksCalendarButton.tsx')).toContain('styles.calendarButtonLarge');
    const styles = read('components/picks/styles.ts');
    expect(styles).toMatch(/headerActionsLarge: \{\s*flexWrap: 'wrap'/);
  });

  it('crew tab labels carry the Fabric trailing-glyph fix', () => {
    expect(read('components/CrewTabBar.tsx')).toContain("{tab.label + '\u00A0'}");
  });

  it('rate screen keeps its full-list link above the gesture bar', () => {
    const src = read('app/rate.tsx');
    expect(src).toContain('useSafeAreaInsets()');
    expect(src).toContain('paddingBottom: insets.bottom');
  });

  it('crew invite actions carry visible labels and the day RSVP card sits on bg.primary', () => {
    const members = read('components/crew/CrewMembersTab.tsx');
    for (const label of ['>Share<', '>QR code<', '>New code<']) expect(members).toContain(label);
    expect(read('components/CrewMyDays.tsx')).toContain('backgroundColor: t.colors.bg.primary');
  });

  it('admin lineup import and crews use the native stack header, not the tab-style one', () => {
    for (const file of ['app/admin/lineup-import.tsx', 'app/admin/crews.tsx']) {
      const src = read(file);
      expect(src).not.toContain('ScreenHeader');
      expect(src).not.toContain('headerShown: false');
      expect(src).toContain('headerShown: true');
    }
  });

  it('status bar icons flip while the offline banner paints behind them', () => {
    expect(read('app/_layout.tsx')).toContain("(theme === 'daylight') !== bannerActive");
  });

  it('every Alert with a Cancel button can be dismissed with the Android back button', () => {
    const files = [
      'app/(tabs)/account.tsx',
      'app/(tabs)/crew.tsx',
      'hooks/usePicksCalendar.ts',
      'components/CrewExpenses.tsx',
      'components/CrewSos.tsx',
    ];
    for (const file of files) {
      const src = read(file);
      const cancels = src.match(/style: 'cancel'/g)?.length ?? 0;
      const cancelable = src.match(/cancelable: true/g)?.length ?? 0;
      expect(cancelable, file).toBeGreaterThanOrEqual(cancels);
    }
    // A Cancel that does work must also run it when Back dismisses the dialog.
    expect(read('components/CrewExpenses.tsx')).toContain('onDismiss: unlock');
    expect(read('app/set/[setId].tsx')).toContain('onDismiss: dismissAsk');
  });

  it('a declined notification permission says so and that it can be asked again', () => {
    expect(read('components/AccountNotificationsSection.tsx')).toContain('Permission was declined');
  });

  it('admin analytics and audit show the mapped error, so a rate limit is not a connection problem', () => {
    for (const file of ['app/admin/analytics.tsx', 'app/admin/audit.tsx']) {
      const src = read(file);
      expect(src).toContain('mapErrorToUserMessage(err');
      expect(src).not.toContain('message="Something went wrong reaching the server."');
    }
  });

  it('the join landing re-selects the joined crew when another crew is still the active one', () => {
    const src = read('app/(tabs)/crew.tsx');
    expect(src).toContain('crews.some((c) => c.id === joinedParam)');
    expect(src).toContain('selectCrew(joinedParam)');
  });
});
