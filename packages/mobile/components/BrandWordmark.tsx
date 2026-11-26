import Animated, { FadeIn } from 'react-native-reanimated';
import { AUTH_COPY } from '@festie/shared/constants';
import { duration as motionDuration } from '@festie/shared/tokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { makeStyles, typeScaleCap, typeStyle } from '../hooks/useTokens';

const useStyles = makeStyles((t) => ({
  // OD-2: house-light text, not coral. Coral on screen means danger, SOS or Must only.
  wordmark: {
    ...typeStyle('display-lg'),
    color: t.colors.text.primary,
    textAlign: 'center',
    marginBottom: t.spacing[1],
  },
}));

/** The FESTIE wordmark on the sign-in screens. The BrandMark above it is the mark. `reveal` fades it in at the medium duration, with no delay, unless reduce motion is on. */
export default function BrandWordmark({ reveal }: { reveal?: boolean }) {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  return (
    <Animated.Text
      style={styles.wordmark}
      maxFontSizeMultiplier={typeScaleCap('display-lg')}
      accessibilityRole="header"
      entering={reduceMotion ? undefined : reveal ? FadeIn.duration(motionDuration.med) : undefined}
    >
      {AUTH_COPY.wordmark}
    </Animated.Text>
  );
}
