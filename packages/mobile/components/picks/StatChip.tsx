import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useStyles } from './styles';

/** A summary + focus-filter chip ("Must · 8"). Tapping toggles the filter. */
export default function StatChip({
  label,
  count,
  color,
  icon,
  active,
  danger,
  onPress,
}: {
  label: string;
  count: number;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const t = useTokens();
  const styles = useStyles();
  const accent = danger ? t.colors.accent.coral : t.colors.accent.aqua;
  return (
    <TouchableOpacity
      style={[styles.statChip, active && (danger ? styles.statChipActiveDanger : styles.statChipActive)]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count}${active ? ', filtering' : ''}`}
    >
      {icon ? (
        <Ionicons name={icon} size={t.iconSize.xs} color={color ?? t.colors.text.muted} />
      ) : color ? (
        <View style={[styles.statDot, { backgroundColor: color }]} />
      ) : null}
      <Text
        style={[styles.statLabel, active && { color: accent }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[styles.statCount, active && { color: accent }]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
      >
        {count}
      </Text>
    </TouchableOpacity>
  );
}
