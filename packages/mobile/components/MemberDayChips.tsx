import { View, Text } from 'react-native';
import { useCrewDaysIndex } from '@festie/shared/hooks';
import { memberDayChips } from '@festie/shared/utils';
import type { FestivalDay } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { inkOnFill } from '../lib/inkOnFill';

interface MemberDayChipsProps {
  userId: string;
  name: string;
  days: readonly FestivalDay[];
}

/** Small per-day chips under a member's name: filled Going, outlined Maybe (`?`), struck-through Not going. */
export default function MemberDayChips({ userId, name, days }: MemberDayChipsProps) {
  const t = useTokens();
  const styles = useStyles();
  const index = useCrewDaysIndex();
  const { chips, a11y } = memberDayChips(index, userId, [...days]);
  if (chips.length === 0) return null;
  const goingInk = inkOnFill(t.colors.accent.aqua, t.colors.text.onAccent, t.colors.text.onLightAccent);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${name}: ${a11y}`}>
      {chips.map((chip) => (
        <View
          key={chip.dayIndex}
          style={[styles.chip, chip.answer === 'going' && styles.chipGoing, chip.answer === 'maybe' && styles.chipMaybe]}
        >
          <Text
            style={[
              styles.text,
              chip.answer === 'going' && { color: goingInk },
              chip.answer === 'maybe' && styles.textMaybe,
              chip.answer === 'no' && styles.textNo,
            ]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {chip.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[1],
  },
  chip: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 2,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  chipGoing: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  chipMaybe: {
    borderColor: t.colors.accent.aqua,
  },
  text: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  textMaybe: {
    color: t.colors.accent.aqua,
  },
  textNo: {
    textDecorationLine: 'line-through',
  },
}));
