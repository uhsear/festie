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
});
