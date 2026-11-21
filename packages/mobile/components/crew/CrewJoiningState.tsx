import { View } from 'react-native';
import ScreenHeader from '../ScreenHeader';
import EmptyState from '../EmptyState';

import { useStyles } from './styles';

export default function CrewJoiningState() {
  const styles = useStyles();
  return (
  <View style={styles.screen} testID="crew-screen">
    <ScreenHeader title="Crew" icon="people" />
    <EmptyState
      icon="cloud-offline-outline"
      title="Joining when you're back online"
      message="Your join is saved on this device. The crew opens once you reconnect."
    />
  </View>
  );
}
