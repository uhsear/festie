import { describe, expect, it } from 'vitest';
import { read } from './read-source';

describe('signal as a state of the surface (DP-42)', () => {
  it('offline is a slim persistent status row: no amber slab, no dismiss, amber on the icon only', () => {
    const src = read('components/OfflineBanner.tsx');
    expect(src).not.toContain('Dismiss offline notice');
    expect(src).not.toContain('setDismissed');
    expect(src).toMatch(/statusRow: \{[^}]*backgroundColor: t\.colors\.bg\.secondary/s);
    expect(src).not.toMatch(/banner: \{[^}]*accent\.amber/s);
    expect(src).toContain('color={t.colors.accent.amber}');
    expect(src).toContain('`Offline, ${pendingSync} change');
  });

  it('the freshness chip derives its dot from the shared signal state and glows only while live', () => {
    const src = read('components/FreshnessChip.tsx');
    expect(src).toContain('signalStateFor(cachedAt, offlineMode)');
    expect(src).toContain('signalGlows(signal) ? <View style={[styles.halo');
    expect(src).not.toContain('chipBgOffline');
    expect(src).not.toContain('accent.amber');
  });
});
