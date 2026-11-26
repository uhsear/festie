import type { ReactNode } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { duration as motionDuration } from '@festie/shared/tokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

/**
 * Fades a Now & Next card in at the medium duration. Callers key it by set id, so
 * a new live or next set remounts it and plays the entrance once. Reduce Motion
 * renders the card as is.
 */
export default function SetChangeEnter({ children }: { children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  if (reduceMotion) return <>{children}</>;
  return <Animated.View entering={FadeIn.duration(motionDuration.med)}>{children}</Animated.View>;
}
