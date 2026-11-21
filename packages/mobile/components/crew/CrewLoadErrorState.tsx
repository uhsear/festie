import { View } from 'react-native';
import ScreenHeader from '../ScreenHeader';
import EmptyState from '../EmptyState';

import { useStyles } from './styles';

interface CrewLoadErrorStateProps {
  retry: () => void;
}

export default function CrewLoadErrorState({
  retry,
}: CrewLoadErrorStateProps) {
  const styles = useStyles();
  return (
  <View style={styles.screen} testID="crew-screen">
    <ScreenHeader title="Crew" icon="people" />
    <EmptyState
      icon="cloud-offline-outline"
      title="Couldn't load your crew"
      message="Check your connection, then try again."
      action={{ label: 'Try again', onPress: retry }}
    />
  </View>
  );
}
