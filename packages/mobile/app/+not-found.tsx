import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Button from '../components/Button';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/** Unknown routes and deep links land here; the copy matches web routes/not-found.tsx. */
const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[4],
    paddingHorizontal: t.spacing[6],
    backgroundColor: t.colors.bg.primary,
  },
  title: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  body: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
    maxWidth: 320,
  },
}));

export default function NotFoundScreen() {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Ionicons name="compass-outline" size={48} color={t.colors.text.muted} />
      <Text style={styles.title} accessibilityRole="header">Page not found</Text>
      <Text style={styles.body}>
        That link does not match anything in Festie. It may have moved, or the address has a typo.
      </Text>
      <Button label="Back to the schedule" onPress={() => router.replace('/(tabs)')} />
    </View>
  );
}
