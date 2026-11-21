import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { setReturnTo } from '../../lib/returnTo';
import { GUEST_PROMPT_COPY } from '@festie/shared/constants';
import ScreenHeader from '../ScreenHeader';
import EmptyState from '../EmptyState';

import { useStyles } from './styles';

export default function CrewGuestState() {
  const styles = useStyles();
  const router = useRouter();
  return (
  <View style={styles.screen} testID="crew-screen">
    <ScreenHeader title="Crew" icon="people" />
    <EmptyState
      icon="people-outline"
      title={GUEST_PROMPT_COPY.teasers.crew.title}
      message={GUEST_PROMPT_COPY.teasers.crew.message}
      action={{
        label: GUEST_PROMPT_COPY.createAccount,
        onPress: () => {
          setReturnTo('/(tabs)/crew');
          router.push('/(auth)/register');
        },
      }}
      secondaryAction={{
        label: GUEST_PROMPT_COPY.signIn,
        onPress: () => {
          setReturnTo('/(tabs)/crew');
          router.push('/(auth)/login');
        },
      }}
    />
  </View>
  );
}
