import { describe, it, expect } from 'vitest';
import { read } from './read-source';
import { headerTopPadding } from '../contexts/TopBannerContext';

describe('headerTopPadding (FU-P56)', () => {
  it('owns the status-bar inset when no overlay shows', () => {
    expect(headerTopPadding(24, 16, 0, 8)).toBe(40);
  });

  it('starts below a one-line strip that already ends inside its own padding', () => {
    expect(headerTopPadding(24, 16, 24 + 16, 8)).toBe(48);
  });

  it('starts below two strips instead of sitting under the second', () => {
    expect(headerTopPadding(24, 16, 24 + 44 + 44, 8)).toBe(120);
  });
});

describe('top banner tap targets (FU-P56)', () => {
  it('grows the compact SOS strip and the failed-sync bar to 44 pt only over a header that pads below them, with no hitSlop', () => {
    const sos = read('components/SosBanner.tsx');
    expect(sos).toContain('headerPadsBelow && { minHeight: topInset + MIN_TAP_TARGET }');
    expect(sos).toContain('const MIN_TAP_TARGET = 44');
    expect(sos).not.toContain('hitSlop');
    const offline = read('components/OfflineBanner.tsx');
    expect(offline).toContain('headerPadsBelow && { minHeight: insets.top + 44 }');
    expect(offline).not.toContain('hitSlop');
  });
});

describe('native stack headers (FU-P56)', () => {
  it('only ScreenHeader registers as padding below the overlay', () => {
    expect(read('components/ScreenHeader.tsx')).toContain('useAddPaddedHeader()');
    expect(read('components/SosBanner.tsx')).toContain('useHeaderPadsBelowBanner()');
    expect(read('components/OfflineBanner.tsx')).toContain('useHeaderPadsBelowBanner()');
  });
});

describe('Timeline segment while the lineup flyer shows (FU-P56)', () => {
  it('disables the Timeline segment and the segment is inert', () => {
    const switcher = read('components/schedule/ScheduleViewSwitcher.tsx');
    expect(switcher).toContain("disabled: o.value === 'timeline'");
    expect(read('app/(tabs)/index.tsx')).toContain('flyerShowing={!!flyer}');
    const segmented = read('components/SegmentedControl.tsx');
    expect(segmented).toContain('disabled={option.disabled}');
    expect(segmented).toContain('disabled: !!option.disabled');
  });
});
