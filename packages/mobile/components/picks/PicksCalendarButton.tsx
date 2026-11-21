import { Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useStyles } from './styles';

interface PicksCalendarButtonProps {
  exportBusy: boolean;
  handleAddToCalendar: () => void;
  noPicks: boolean;
}

export default function PicksCalendarButton({
  exportBusy,
  handleAddToCalendar,
  noPicks,
}: PicksCalendarButtonProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
<TouchableOpacity
  style={[styles.calendarButton, (exportBusy || noPicks) && styles.calendarButtonDisabled]}
  onPress={handleAddToCalendar}
  disabled={exportBusy || noPicks}
  activeOpacity={0.8}
  accessibilityRole="button"
  accessibilityState={{ disabled: exportBusy || noPicks }}
  accessibilityLabel="Add picks to calendar"
>
  {exportBusy ? (
    <ActivityIndicator size="small" color={t.colors.accent.aqua} />
  ) : (
    <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
  )}
  <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
    {exportBusy ? 'Exporting…' : 'Calendar'}
  </Text>
</TouchableOpacity>
  );
}
