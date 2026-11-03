import { useCallback } from 'react';
import { View, Text } from 'react-native';
import { useCrewStore, useUIStore } from '@festie/shared/stores';
import { useCrewDaysIndex } from '@festie/shared/hooks';
import { myDaysPayload, formatDayChip } from '@festie/shared/utils';
import type { CrewDayAnswer, FestivalDay } from '@festie/shared/types';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import SegmentedControl, { type SegmentOption } from './SegmentedControl';

type Choice = CrewDayAnswer | 'none';

const OPTIONS: readonly SegmentOption<Choice>[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'Not going' },
];

const SAVE_ERROR = "Couldn't save your days. Try again.";

interface CrewMyDaysProps {
  crewId: string;
  myUserId: string;
  /** Festival days of the crew's festival; position is the day index. */
  days: readonly FestivalDay[];
}

/** "Your days": one Going / Maybe / Not going control per festival day. Tap the selected answer to clear it. */
export default function CrewMyDays({ crewId, myUserId, days }: CrewMyDaysProps) {
  const styles = useStyles();
  const index = useCrewDaysIndex();
  const setMyDays = useCrewStore((s) => s.setMyDays);

  const choose = useCallback(
    (dayIndex: number, current: CrewDayAnswer | undefined, picked: Choice) => {
      if (picked === 'none') return;
      const answer = picked === current ? null : picked;
      setMyDays(crewId, myUserId, myDaysPayload(index, myUserId, dayIndex, answer)).catch(() => {
        useUIStore.getState().showToast(SAVE_ERROR, { kind: 'error' });
      });
    },
    [crewId, myUserId, index, setMyDays],
  );

  if (days.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
        Your days
      </Text>
      <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {"So your crew knows who's there each day."}
      </Text>
      {days.map((day, dayIndex) => {
        const chip = formatDayChip(day);
        const current = index.get(myUserId)?.get(dayIndex);
        return (
          <View key={day.id} style={styles.dayBlock}>
            <Text style={styles.dayLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {chip.date ? `${chip.label} · ${chip.date}` : chip.label}
            </Text>
            {/* Remount when cleared: the control keeps its thumb on the last answer otherwise. */}
            <SegmentedControl<Choice>
              key={current ? 'set' : 'none'}
              options={OPTIONS}
              value={current ?? 'none'}
              onChange={(v) => choose(dayIndex, current, v)}
              accessibilityLabel={`${chip.label}: are you going?`}
            />
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    marginTop: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  title: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  dayBlock: {
    gap: t.spacing[1],
  },
  dayLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
}));
