import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { colors } from '@festie/shared/tokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';

const COUNT = 24;
const PALETTE = [colors.accent.aqua, colors.text.primary, colors.text.secondary];

function Piece({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const spec = useMemo(() => {
    const angle = (index / COUNT) * Math.PI * 2;
    const dist = 90 + ((index * 37) % 70);
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 30,
      color: PALETTE[index % PALETTE.length]!,
      spin: (index % 2 ? 1 : -1) * 360,
    };
  }, [index]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateX: spec.dx * progress.value },
      { translateY: spec.dy * progress.value + 60 * progress.value * progress.value },
      { rotate: `${spec.spin * progress.value}deg` },
    ],
  }));
  return <Animated.View style={[s.piece, { backgroundColor: spec.color }, style]} />;
}

/** One-shot burst of 24 squares, played once on mount. Renders nothing under reduced motion. */
export default function ConfettiBurst() {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
  }, [reduceMotion, progress]);
  if (reduceMotion) return null;
  return (
    <View style={s.layer} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: COUNT }, (_, i) => (
        <Piece key={i} index={i} progress={progress} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  piece: { position: 'absolute', width: 10, height: 10, borderRadius: 2 },
});
