import { useCallback } from 'react';
import { Pressable, Platform } from 'react-native';
import type { PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { pressScale, spring } from '@festie/shared/tokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useTokens } from '../hooks/useTokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Press-squish primitive for SMALL controls — chips, tab pills, priority/rating
 * buttons. Extracted from SegmentedControl's Segment so every small control
 * shares one tokenized scale animation: a `spring.touch` spring to the shared
 * `pressScale` token (the same press value as web). A spring carries its
 * velocity into the new target, so a rapid second tap stays continuous. When
 * OS Reduce Motion is on we never touch the shared value, so the control stays
 * at scale 1 with no motion.
 *
 * RULE: squish-for-small-controls (PressableScale), fade/ripple-for-large-surfaces
 * (AppPressable). Cards keep the opacity/ripple feel; buttons/chips/pills squish.
 */
export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. Defaults to the shared `pressScale` token (0.96). */
  pressedScale?: number;
}

export default function PressableScale({
  style,
  pressedScale = pressScale,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const reduceMotion = useReduceMotion();
  const t = useTokens();
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - pressedScale) }],
  }));

  const handlePressIn = useCallback<NonNullable<PressableProps['onPressIn']>>(
    (e) => {
      if (!reduceMotion) {
        // eslint-disable-next-line react-hooks/immutability -- imperative Reanimated shared-value write in an event handler; .value mutation is the animation API and has no derived-state equivalent
        pressed.value = withSpring(1, spring.touch);
      }
      onPressIn?.(e);
    },
    [reduceMotion, pressed, onPressIn],
  );

  const handlePressOut = useCallback<NonNullable<PressableProps['onPressOut']>>(
    (e) => {
      if (!reduceMotion) {
        // eslint-disable-next-line react-hooks/immutability -- imperative Reanimated shared-value write in an event handler; .value mutation is the animation API and has no derived-state equivalent
        pressed.value = withSpring(0, spring.touch);
      }
      onPressOut?.(e);
    },
    [reduceMotion, pressed, onPressOut],
  );

  return (
    <AnimatedPressable
      style={[style, animatedStyle]}
      // Bounded theme-token ripple so Android gets native press feedback alongside the squish.
      android_ripple={Platform.OS === 'android' ? { color: t.colors.overlay[4] } : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
