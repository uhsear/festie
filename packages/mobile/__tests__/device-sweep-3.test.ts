import { describe, it, expect } from 'vitest';
import { selectMyPicks, useFestivalDataStore } from '@festie/shared/stores';
import { buildPlanSnapshotInput } from '@festie/shared/utils';
import { read } from './read-source';

// Source-level guards (mobile tests run in plain node with no RN render harness) plus the guest pick path.

describe('device sweep 3', () => {
  it('hides the app behind the splash and the first-run intro from screen readers', () => {
    const src = read('app/_layout.tsx');
    expect(src).toContain("importantForAccessibility={loading || introShowing ? 'no-hide-descendants' : 'auto'}");
    expect(src).toContain('accessibilityElementsHidden={loading || introShowing}');
    expect(src).toContain('{introShowing && <FirstRunIntro');
  });

  it('a guest sees their device picks in the plan share snapshot', () => {
    useFestivalDataStore.setState({
      currentProfile: null,
      currentFestivalId: 'fest-1',
      guestPicks: { 'fest-1': { 'set-a': 'must' } },
    });
    const picks = selectMyPicks(useFestivalDataStore.getState());
    expect(picks).toEqual({ 'set-a': 'must' });
    const { picksCount } = buildPlanSnapshotInput({
      festival: { id: 'fest-1', name: 'Fest' },
      picks: picks ?? undefined,
      meetingPoints: [],
      nowMs: 0,
    });
    expect(picksCount).toBe(1);
  });

  it('reads picks through selectMyPicks wherever the viewer own picks are used', () => {
    for (const file of [
      'components/PlanQRShare.tsx',
      'components/PlanQRScan.tsx',
      'app/festival-mode.tsx',
      'app/grid.tsx',
      'hooks/useNowNext.ts',
      'components/CaughtNowCard.tsx',
    ]) {
      const src = read(file);
      expect(src, file).toContain('selectMyPicks');
      expect(src, file).not.toMatch(/currentProfile\??\)?\??\.picks/);
    }
    expect(read('components/PlanQRShare.tsx')).not.toContain('!currentProfile');
  });

  it('sets the tab indicator color in both themes', () => {
    const src = read('app/(tabs)/_layout.tsx');
    expect(src).toContain('indicatorColor={colors.aquaAlpha[15]}');
    expect(src).not.toContain('indicatorColor: colors.aquaAlpha[15]');
  });

  it('offline card puts the button under the status text and absorbs the trailing glyph', () => {
    const src = read('components/OfflineReadinessCard.tsx');
    expect(src).toContain('styles.buttonRow');
    expect(src).toContain(String.raw`sizeNote + '\u00A0'`);
    expect(src.indexOf('styles.buttonRow')).toBeGreaterThan(src.indexOf('Show offline download details'));
  });

  it('picks image labels Today only for the real current day', () => {
    const src = read('app/picks-image.tsx');
    expect(src).toContain('c.index === todayIndex ?');
    expect(src).toContain('logicalDayIndexAt(days, nowMs, resolveFestivalTimeZone(festival))');
    expect(src).not.toContain('c.index === selectedDay ?');
  });

  it('wrap hero label is singular for one set', () => {
    expect(read('app/wrap.tsx')).toContain("heroValue === 1 ? 'set' : 'sets'");
  });

  it('picks empty state names the Lineup tab', () => {
    const src = read('components/picks/PicksNoFestivalState.tsx');
    expect(src).toContain('Lineup tab');
    expect(src).not.toContain('Schedule tab');
  });

  it('screen header subtitle carries the trailing glyph fix', () => {
    expect(read('components/ScreenHeader.tsx')).toContain(String.raw`subtitle + '\u00A0'`);
  });

  it('festival picker drops the offline note when the list shows its own offline error', () => {
    const src = read('components/schedule/SchedulePickerView.tsx');
    expect(src).toContain('pickingFestival && offlineMode && hasFestivals');
  });

  it('account screen draws nothing for a signed-out visitor', () => {
    expect(read('app/(tabs)/account.tsx')).toContain('if (!user) return null;');
  });

  it('privacy policy uses typographic quotes', () => {
    expect(read('app/privacy.tsx')).toContain('\u201cwe\u201d and \u201cus\u201d mean');
  });
});
