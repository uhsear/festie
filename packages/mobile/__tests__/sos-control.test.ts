import { describe, it, expect } from 'vitest';
import { read } from './read-source';

describe('the one SOS control (DP-38)', () => {
  const control = read('components/SosControl.tsx');
  const banner = read('components/SosBanner.tsx');

  it('holds for the shared duration and names itself "Send SOS" with a hint', () => {
    expect(control).toContain('delayLongPress={SOS_CONTROL.holdMs}');
    expect(control).toContain('onLongPress={confirmRaise}');
    expect(control).toContain('accessibilityLabel={SOS_CONTROL.name}');
    expect(control).toContain('accessibilityHint={SOS_CONTROL.hint}');
  });

  it('opens the confirm on a screen reader double-tap, not only on the hold', () => {
    expect(control).toContain('if (screenReader) confirmRaise()');
    expect(control).toContain("addEventListener('screenReaderChanged'");
  });

  it('gates the hold ring and the alert pulse on Reduce Motion', () => {
    expect(control).toContain('reduceMotion ? 1 : withTiming(1');
    expect(control).toContain('!alerting || reduceMotion');
  });

  it('is mounted by the map, crew and Now & Next screens and by no other raise button', () => {
    for (const file of ['app/(tabs)/map.tsx', 'app/(tabs)/crew.tsx', 'app/festival-mode.tsx']) {
      expect(read(file), file).toContain('<SosControl');
      expect(read(file), file).not.toContain('useSosRaise');
    }
    expect(read('components/CrewSos.tsx')).not.toContain('useSosRaise');
  });

  it('slides the incoming banner in at the medium spatial duration and flashes it twice, gated by Reduce Motion', () => {
    expect(banner).toContain('FadeInDown.duration(durationSpatial.med)');
    expect(banner).toContain('entering={reduceMotion ? undefined');
    expect(banner).toContain('withTiming(0, { duration: half })), 2)');
    expect(banner).toContain('if (!arrivalKey || reduceMotion) return;');
  });

  it('floats the top banners over the screen so none of them moves content (FU-P4)', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('style={styles.topOverlay}');
    expect(layout).toMatch(/topOverlay: \{\s*position: 'absolute'/);
    // The overlay is painted after the navigator, and the banners are no longer siblings in the flow.
    expect(layout.indexOf('style={styles.topOverlay}')).toBeGreaterThan(layout.indexOf('style={styles.appShell}'));
    // The header pads by the overlay's height instead (FU-P56), so nothing covers it.
    expect(layout).toContain('setTopBannerHeight(Math.ceil(e.nativeEvent.layout.height))');
    expect(read('components/ScreenHeader.tsx')).toContain('useTopBannerHeight()');
  });

  it('shrinks the SOS banner to a one-line strip after the arrival, so it never covers a header', () => {
    expect(banner).toContain('const FULL_WIDTH_MS = duration.slow * 2 + 2_000');
    expect(banner).toContain('setTimeout(() => setCompactFor(arrivalKey), FULL_WIDTH_MS)');
    expect(banner).toContain('onActiveChange?.(active)');
    expect(banner).not.toContain('pillSlot');
    expect(banner).not.toMatch(/position: 'absolute'/);
  });

  it('keeps every persistent top bar to one line inside the status-bar inset plus a header top padding (FU-P4)', () => {
    const offline = read('components/OfflineBanner.tsx');
    expect(offline).not.toContain('numberOfLines={2}');
    expect(offline).not.toMatch(/paddingTop: insets\.top \+/);
  });

  it('ends lists clear of the control: its footprint plus a cushion', () => {
    expect(control).toContain('export const SOS_CONTROL_CLEARANCE = BOTTOM_GAP + SIZE + spacing[2]');
    expect(control).toContain('bottom: bottomInset + BOTTOM_GAP');
    expect(read('app/festival-mode.tsx')).toContain('insets.bottom + SOS_CONTROL_CLEARANCE');
  });
});
