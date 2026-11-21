import { View } from 'react-native';
import { useTokens } from '../../hooks/useTokens';
import ScreenHeader from '../ScreenHeader';
import { Skeleton } from '../Skeleton';

import { useStyles } from './styles';

interface CrewLoadingStateProps {
  tabletInset: { paddingHorizontal: number } | null;
}

export default function CrewLoadingState({
  tabletInset,
}: CrewLoadingStateProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
  <View style={styles.screen} testID="crew-screen">
    <ScreenHeader title="Crew" icon="people" />
    <View
      style={[styles.crewChrome, tabletInset]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your crews"
    >
      <Skeleton height={44} radius={t.radii.default} />
      <View style={styles.skeletonList}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton width={40} height={40} radius={20} />
            <View style={styles.skeletonRowBody}>
              <Skeleton width="55%" height={14} radius={t.radii.xs} />
              <Skeleton width="32%" height={10} radius={t.radii.xs} />
            </View>
          </View>
        ))}
      </View>
    </View>
  </View>
  );
}
