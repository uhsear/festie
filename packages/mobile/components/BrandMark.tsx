import { Image } from 'react-native';
import { makeStyles, useLargeText } from '../hooks/useTokens';

const useStyles = makeStyles((t) => ({
  mark: {
    width: 64,
    height: 64,
    alignSelf: 'center',
    marginBottom: t.spacing[3],
  },
}));

/** Transparent brand mark (same art as web favicon.svg); decorative, the wordmark beside it names the app. */
export default function BrandMark() {
  const styles = useStyles();
  const largeText = useLargeText();
  if (largeText) return null;
  return (
    <Image
      source={require('../assets/splash-icon.png')}
      style={styles.mark}
      accessible={false}
      importantForAccessibility="no"
      accessibilityIgnoresInvertColors
    />
  );
}
