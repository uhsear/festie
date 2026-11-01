import { Image } from 'react-native';
import { makeStyles, useLargeText } from '../hooks/useTokens';

const useStyles = makeStyles((t) => ({
  mark: {
    width: 64,
    height: 64,
    borderRadius: t.radii.md,
    alignSelf: 'center',
    marginBottom: t.spacing[3],
  },
}));

/** Existing app icon as the brand mark; decorative, the wordmark beside it names the app. */
export default function BrandMark() {
  const styles = useStyles();
  const largeText = useLargeText();
  if (largeText) return null;
  return (
    <Image
      source={require('../assets/icon.png')}
      style={styles.mark}
      accessible={false}
      importantForAccessibility="no"
      accessibilityIgnoresInvertColors
    />
  );
}
