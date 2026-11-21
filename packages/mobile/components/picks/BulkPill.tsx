import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useStyles } from './styles';

/** A tappable bulk-add pill ("Main Stage · 8") used in the bulk panel. */
export default function BulkPill({
  label,
  count,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  count: number;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.bulkActionPill, disabled && !busy && styles.bulkActionPillDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Add all ${count} ${label} sets`}
    >
      {busy ? (
        <ActivityIndicator size="small" color={t.colors.accent.aqua} />
      ) : (
        <>
          <Text style={styles.bulkActionPillText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {label}
          </Text>
          <View style={styles.bulkActionCount}>
            <Text style={styles.bulkActionCountText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{count}</Text>
          </View>
        </>
      )}
    </TouchableOpacity>
  );
}
