import { View, Text, TouchableOpacity } from 'react-native';
import { makeStyles, typeStyle, MAX_FONT_SCALE, type Tokens } from '../hooks/useTokens';

interface Props {
  summary: string;
  onClearAll: () => void;
  hPad: number;
}

/** Results summary + Clear-all. Shown only while a filter narrows the list. */
export default function ScheduleResultsRow({ summary, onClearAll, hPad }: Props) {
  const styles = useStyles();
  return (
    <View style={[styles.resultsRow, { paddingHorizontal: hPad }]}>
      <Text style={styles.resultsText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {summary}
      </Text>
      <TouchableOpacity
        onPress={onClearAll}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="Clear all filters"
      >
        <Text style={styles.clearAllText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Clear all
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles((t: Tokens) => ({
  // Sits between the filter chrome and the list; the count reads left, the
  // recovery action right.
  resultsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[3],
    paddingTop: t.spacing[2],
    paddingBottom: t.spacing[1],
  },
  resultsText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  clearAllText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
}));
