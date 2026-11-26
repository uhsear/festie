import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useCrewStore, useFestivalDataStore, useUIStore } from '@festie/shared/stores';
import { formatFreshnessLabel, signalGlows, signalStateFor } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

type Surface = 'crew' | 'schedule';

interface FreshnessChipProps {
  /**
   * Which cache timestamp drives the freshness label:
   *  - `crew`     → crewStore._cachedAt (crew surfaces)
   *  - `schedule` → festivalDataStore._festivalCachedAt (schedule surfaces)
   */
  surface: Surface;
}

/**
 * Offline-honest freshness chip. Renders "Updated N ago" when online or
 * "Showing offline data · updated N ago" when `uiStore.offlineMode` is set,
 * with a small "N queued" badge driven by `uiStore.pendingSync`.
 *
 * The relative-time label comes from the SHARED `formatFreshnessLabel` util (single source
 * of truth across web + mobile). The "N ago" value advances from the device
 * clock — even on a cold offline launch — via a 30s tick.
 *
 * Renders nothing until the surface has been cached at least once.
 */
export default function FreshnessChip({ surface }: FreshnessChipProps) {
  const t = useTokens();
  const styles = useStyles();

  const offlineMode = useUIStore((s) => s.offlineMode);
  const pendingSync = useUIStore((s) => s.pendingSync);
  const crewCachedAt = useCrewStore((s) => s._cachedAt);
  const festivalCachedAt = useFestivalDataStore((s) => s._festivalCachedAt);
  const cachedAt = surface === 'crew' ? crewCachedAt : festivalCachedAt;

  // Re-render on a 30s tick so "updated N ago" keeps advancing from the device
  // clock without any network.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cachedAt == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [cachedAt]);

  const label = formatFreshnessLabel(cachedAt, offlineMode);
  if (!label || cachedAt == null) return null;

  // Colour is never alone (tokens/colors.ts): the age numeral is in the label, and the dot is a
  // shape: filled with a glow (live), dimmed hollow ring (aging), dashed ring (stale), dotted ring
  // (offline). Stale and offline lose the glow.
  const signal = signalStateFor(cachedAt, offlineMode);
  const confidenceColor = t.colors.confidence[signal === 'offline' ? 'stale' : signal];
  const dotShape = signalGlows(signal)
    ? { backgroundColor: confidenceColor }
    : {
        borderWidth: 1.5,
        borderColor: confidenceColor,
        borderStyle: signal === 'offline' ? ('dotted' as const) : signal === 'stale' ? ('dashed' as const) : ('solid' as const),
        opacity: signal === 'aging' ? 0.7 : 1,
      };

  const a11yBase = signal === 'stale' ? `${label}, may be out of date` : label;
  const a11yLabel =
    pendingSync > 0 ? `${a11yBase}, ${pendingSync} change${pendingSync === 1 ? '' : 's'} queued` : a11yBase;

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={a11yLabel}>
      <View style={styles.chip}>
        <View style={styles.chipBg} pointerEvents="none" />
        <View style={styles.dotSlot} accessible={false}>
          {/* The glow: a soft halo behind the dot, live only. A shadow would need elevation on Android. */}
          {signalGlows(signal) ? <View style={[styles.halo, { backgroundColor: confidenceColor }]} /> : null}
          <View style={[styles.dot, dotShape]} />
        </View>
        <Text style={styles.chipText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {/* Trailing NBSP absorbs Fabric's single-line self-under-measure (the
              bg-sibling already prevents the rounded-pill clip) so "…just now"
              doesn't drop its last glyph. */}
          {label + '\u00A0'}
        </Text>
      </View>

      {pendingSync > 0 ? (
        <View style={styles.queuedBadge} accessible={false}>
          <View style={styles.queuedBadgeBg} pointerEvents="none" />
          <Text style={styles.queuedText}>{pendingSync} queued</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
  // Bg/border + radius live on this absolutely-positioned sibling, painted
  // behind the dot + label — not on chip itself — so the Text child is never
  // clipped to the rounded bounds on Android (see dayChipBg for the pattern).
  chipBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.secondary,
  },
  dotSlot: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 7,
    opacity: 0.3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    ...typeStyle('caption', undefined, { tabular: true }),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  queuedBadge: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
  // Same pattern as chipBg: the "N queued" Text is a sibling of its rounded
  // fill, not a child of it, so Android can't clip the trailing glyph.
  queuedBadgeBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
  },
  queuedText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
}));
