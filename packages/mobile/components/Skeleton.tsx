import { type DimensionValue, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { useFestivalModeStore } from '@festie/shared/stores';
import { easing } from '@festie/shared/tokens';
import { useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { shouldPulse } from '../lib/ambientMotion';

/**
 * R7 (design-inspiration-deep-2026-06-10): ambient-loop half-cycle aligned to
 * spec — 700ms in / 700ms out, opacity 0.4 → 0.8. Kept as a named constant so
 * Skeleton and LiveDot share one cadence. Promote to duration.pulse token (F38)
 * when the motion.ts token pass lands.
 */
const PULSE_DURATION = 700;

interface SkeletonProps {
  /** Block width — number (px) or percentage string. Defaults to full width. */
  width?: DimensionValue;
  /** Block height in px. */
  height?: number;
  /** Corner radius (defaults to the standard token radius). */
  radius?: number;
  /**
   * R7: adds the aqua hairline border (rgba(0,232,208,0.08)) used on card-shaped
   * skeletons for rhythm continuity. Pass `card` when the skeleton represents a
   * full card container (crew member row, set card, FM card) rather than an
   * inline text/circle block.
   */
  card?: boolean;
  style?: ViewStyle | ViewStyle[];
}

/**
 * A single shimmering placeholder block. Pulses its opacity to signal "content
 * loading" and matches a real element's geometry so the layout doesn't jump when
 * data arrives. Honors the OS Reduce Motion setting and festival low-power mode (RN has no CSS
 * `prefers-reduced-motion`): when reduced, it renders a static dimmed block
 * instead of animating. Always hidden from the accessibility tree — a
 * screen-reader user hears the screen's `progressbar`/loading label, not the
 * decorative blocks.
 *
 * Uses Reanimated (withRepeat) to match the app's single animation system
 * (LiveDot, SegmentedControl, PressableScale) rather than the legacy Animated API.
 */
export function Skeleton({ width = '100%', height = 16, radius, card = false, style }: SkeletonProps) {
  const t = useTokens();
  const reduceMotion = useReduceMotion();
  const lowPowerMode = useFestivalModeStore((st) => st.lowPowerMode);
  const pulsing = shouldPulse({ reduceMotion, lowPowerMode });
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(opacity);
      opacity.value = 0.6;
      return;
    }
    // R7: Pulse 0.4 ↔ 0.8 forever; -1 repeats, `true` reverses each cycle.
    opacity.value = 0.4;
    opacity.value = withRepeat(
      withTiming(0.8, { duration: PULSE_DURATION, easing: Easing.bezier(...easing.standard.bezier) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [pulsing, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? t.radii.default,
          backgroundColor: t.colors.bg.secondary,
          // R7: card-shaped skeletons carry the aqua hairline so they read
          // with the same rhythm as the real cards they replace.
          ...(card && {
            borderWidth: 1,
            borderColor: t.colors.aquaAlpha[8],
          }),
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export default Skeleton;
