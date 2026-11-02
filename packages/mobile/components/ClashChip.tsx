import { Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clashChip, clashChipA11y } from '@festie/shared/constants';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import AppPressable from './AppPressable';

interface ClashChipProps {
  count: number;
  onPress: () => void;
}

export default function ClashChip({ count, onPress }: ClashChipProps) {
  const t = useTokens();
  const styles = useStyles();
  if (count === 0) return null;
  return (
    <AppPressable
      style={styles.chip}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={clashChipA11y(count)}
    >
      <Ionicons name="warning-outline" size={t.iconSize.sm} color={t.colors.clash.mark} />
      <Text style={styles.text} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {clashChip(count)}
      </Text>
    </AppPressable>
  );
}

const useStyles = makeStyles((t) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.clash.tint,
    borderWidth: 1,
    borderColor: t.colors.clash.mark,
  },
  text: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
}));
