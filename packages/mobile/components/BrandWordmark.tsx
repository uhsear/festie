import type { ComponentProps } from 'react';
import Animated from 'react-native-reanimated';
import { AUTH_COPY } from '@festie/shared/constants';
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

/** The FESTIE wordmark on the sign-in screens. The BrandMark above it is the mark. */
export default function BrandWordmark({ entering }: Pick<ComponentProps<typeof Animated.Text>, 'entering'>) {
  const styles = useStyles();
  return (
    <Animated.Text
      style={styles.wordmark}
      maxFontSizeMultiplier={typeScaleCap('display-lg')}
      accessibilityRole="header"
      entering={entering}
    >
      {AUTH_COPY.wordmark}
    </Animated.Text>
  );
}
