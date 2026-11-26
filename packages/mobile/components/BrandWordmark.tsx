import Animated, { FadeInDown } from 'react-native-reanimated';
import { AUTH_COPY } from '@festie/shared/constants';
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

/** The FESTIE wordmark on the sign-in screens. The BrandMark above it is the mark. `revealDelay` (ms) fades it in unless reduce motion is on. */
export default function BrandWordmark({ revealDelay }: { revealDelay?: number }) {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const reveal = revealDelay === undefined ? undefined : FadeInDown.delay(revealDelay).duration(350);
  return (
    <Animated.Text
      style={styles.wordmark}
      maxFontSizeMultiplier={typeScaleCap('display-lg')}
      accessibilityRole="header"
      entering={reduceMotion ? undefined : reveal}
    >
      {AUTH_COPY.wordmark}
    </Animated.Text>
  );
}
