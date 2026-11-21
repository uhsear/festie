import { View } from 'react-native';
import { useTokens } from '../../hooks/useTokens';
import { Skeleton } from '../Skeleton';
import { useStyles } from './styles';

/**
 * Cold-load placeholder for the picks plan — a day header plus a few set-card
 * shaped rows so the layout matches what's about to render (no spinner, no jump).
 */
export default function PicksSkeleton() {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.listContent} accessibilityRole="progressbar" accessibilityLabel="Loading your picks">
      <Skeleton width="40%" height={20} radius={t.radii.xs} style={styles.skeletonDay} />
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonCardMain}>
            <Skeleton width="62%" height={16} radius={t.radii.xs} />
            <Skeleton width="38%" height={12} radius={t.radii.xs} />
          </View>
          <Skeleton width={72} height={28} radius={t.radii.pill} />
        </View>
      ))}
    </View>
  );
}
