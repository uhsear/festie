import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { GUEST_PROMPT_COPY } from '@festie/shared/constants';
import { makeStyles, typeStyle } from '../hooks/useTokens';
import { setReturnTo } from '../lib/returnTo';
import Button from './Button';

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    padding: t.spacing[4],
    marginBottom: t.spacing[4],
    gap: t.spacing[2],
  },
  title: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
  },
  body: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  actions: {
    gap: t.spacing[2],
    marginTop: t.spacing[2],
  },
}));

/** Tells a guest their picks live on this device and offers the account that keeps them. */
export default function GuestPicksBanner() {
  const styles = useStyles();
  const router = useRouter();
  const { title, body, cta, signIn } = GUEST_PROMPT_COPY.guestPicks;
  const go = (path: '/(auth)/register' | '/(auth)/login') => {
    setReturnTo('/(tabs)/picks');
    router.push(path);
  };
  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.actions}>
        <Button label={cta} onPress={() => go('/(auth)/register')} />
        <Button label={signIn} variant="secondary" onPress={() => go('/(auth)/login')} />
      </View>
    </View>
  );
}
