import { Image } from 'react-native';
import { useUIStore } from '@festie/shared/stores';
import { makeStyles, useLargeText } from '../hooks/useTokens';

const useStyles = makeStyles((t) => ({
  mark: {
    width: 64,
    height: 64,
    alignSelf: 'center',
    marginBottom: t.spacing[3],
  },
}));

const MARK_STAGE = require('../assets/splash-icon.png');
const MARK_DAYLIGHT = require('../assets/splash-icon-daylight.png');

/** Transparent brand mark (same art as web favicon.svg, Daylight pin and tent on the light theme); decorative, the wordmark beside it names the app. */
export default function BrandMark() {
  const styles = useStyles();
  const largeText = useLargeText();
  const theme = useUIStore((s) => s.theme);
  if (largeText) return null;
  return (
    <Image
      source={theme === 'daylight' ? MARK_DAYLIGHT : MARK_STAGE}
      style={styles.mark}
      accessible={false}
      importantForAccessibility="no"
      accessibilityIgnoresInvertColors
    />
  );
}
