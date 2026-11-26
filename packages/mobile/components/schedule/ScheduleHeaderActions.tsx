import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useStyles } from './styles';

interface ScheduleHeaderActionsProps {
  handleRefresh: () => void;
  isLoading: boolean;
  viewMode: "timeline" | "cards";
  width: number;
}

export default function ScheduleHeaderActions({
  handleRefresh,
  isLoading,
  viewMode,
  width,
}: ScheduleHeaderActionsProps) {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  return (
<View style={styles.headerActions}>
  {/* Manual refresh for ALL views — the RefreshControls only cover the Cards
      list + fallback scroll, leaving Timeline with no pull-to-refresh. */}
  {/* Cards has pull-to-refresh, so the button only shows in Timeline. */}
  {width >= 400 && viewMode === 'timeline' ? (
    <TouchableOpacity
      style={styles.headerIconButton}
      onPress={handleRefresh}
      disabled={isLoading}
      activeOpacity={0.7}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Refresh schedule"
      accessibilityState={{ busy: isLoading }}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={t.colors.accent.aqua} />
      ) : (
        <Ionicons name="refresh" size={t.iconSize.lg} color={t.colors.accent.aqua} />
      )}
    </TouchableOpacity>
  ) : null}
  <TouchableOpacity
    style={styles.headerNowPill}
    onPress={() => router.push('/festival-mode')}
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel="Open Now and Next"
  >
    {/* "Live" is reserved for location (P1-2); flash = Now & Next. */}
    <Ionicons name="flash" size={t.iconSize.md} color={t.colors.accent.aqua} />
    <Text style={styles.headerNowText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      Now
    </Text>
  </TouchableOpacity>
</View>
  );
}
