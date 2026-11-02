import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { clashChip, clashChipA11y, COPY } from '@festie/shared/constants';
import { useViewAs } from '@festie/shared/hooks';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import AppPressable from './AppPressable';

interface ClashChipProps {
  count: number;
  picked: number;
}

export default function ClashChip({ count, picked }: ClashChipProps) {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const { target } = useViewAs();
  if (count === 0) {
    // View as shows someone else's sets, so "No clashes" would mislead.
    if (picked === 0 || target !== null) return null;
    return (
      <View style={styles.none} accessibilityRole="text">
        <Text style={styles.noneText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {COPY.clash.none}
        </Text>
      </View>
    );
  }
  return (
    <AppPressable
      style={styles.chip}
      onPress={() => router.navigate({ pathname: '/(tabs)/picks', params: { show: 'clashes' } })}
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
  none: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
  },
  noneText: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
  },
  text: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
}));
