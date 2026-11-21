import { View } from 'react-native';
import { useTokens } from '../../hooks/useTokens';
import { Skeleton } from '../Skeleton';
import { useStyles } from './styles';

/**
 * Cold-load placeholder for the schedule — a stage header plus a few set-card
 * shaped rows so the layout matches what's about to render (no spinner, no
 * jump). Mirrors PicksSkeleton on the Picks tab. `hPad` is passed by callers
 * that are NOT already inside a horizontally padded container.
 */
export default function ScheduleSkeleton({ hPad = 0 }: { hPad?: number }) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View
      style={[styles.skeletonContent, { paddingHorizontal: hPad }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading the schedule"
    >
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
