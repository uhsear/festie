import { useState } from 'react';
import { View, Text } from 'react-native';
import { PRIORITY_LABELS, INTRO_LINEUP_COPY } from '@festie/shared/constants';
import {
  INTRO_INITIAL_PICKS,
  INTRO_LINEUP,
  countIntroPicks,
  cycleIntroPick,
  findIntroClash,
} from '@festie/shared/utils';
import type { IntroPicks } from '@festie/shared/utils';
import AppPressable from './AppPressable';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

/** A scripted miniature Friday card. Pressing a set cycles its priority; overlapping picks draw one clash line. */
export default function IntroLineup() {
  const t = useTokens();
  const styles = useStyles();
  const [picks, setPicks] = useState<IntroPicks>(INTRO_INITIAL_PICKS);
  const clash = findIntroClash(picks);
  const priorityColor = {
    must: t.colors.priority.must,
    'want-to-see': t.colors.priority.want,
    maybe: t.colors.priority.maybe,
  } as const;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.day}>{INTRO_LINEUP_COPY.day}</Text>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{INTRO_LINEUP_COPY.picks(countIntroPicks(picks))}</Text>
        </View>
      </View>
      {INTRO_LINEUP.map((set) => {
        const pick = picks[set.id] ?? null;
        const label = pick ? PRIORITY_LABELS[pick] : INTRO_LINEUP_COPY.unpicked;
        return (
          <AppPressable
            key={set.id}
            onPress={() => setPicks((p) => ({ ...p, [set.id]: cycleIntroPick(p[set.id] ?? null) }))}
            accessibilityRole="button"
            accessibilityLabel={`${set.artist}, ${set.time}, ${label}`}
            style={styles.row}
          >
            <View style={[styles.dot, { backgroundColor: pick ? priorityColor[pick] : t.colors.text.muted }]} />
            <Text style={styles.artist}>{set.artist}</Text>
            <Text style={styles.time}>{set.time}</Text>
            <Text style={[styles.label, { color: pick ? priorityColor[pick] : t.colors.text.muted }]}>{label}</Text>
          </AppPressable>
        );
      })}
      <Text style={styles.clash} accessibilityLiveRegion="polite">
        {clash ? INTRO_LINEUP_COPY.clash(clash[0].artist, clash[1].artist) : ' '}
      </Text>
      <Text style={styles.hint}>{INTRO_LINEUP_COPY.hint}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    width: '100%',
    maxWidth: 320,
    padding: t.spacing[4],
    gap: t.spacing[3],
    borderRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  day: { ...typeStyle('title'), color: t.colors.text.primary },
  pill: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[20],
    borderWidth: 1,
    borderColor: t.colors.aquaAlpha[30],
  },
  pillText: { ...typeStyle('caption'), color: t.colors.accent.aqua },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  artist: { ...typeStyle('label'), flex: 1, color: t.colors.text.primary },
  time: { ...typeStyle('caption'), color: t.colors.text.muted },
  label: { ...typeStyle('caption'), width: 80 },
  clash: { ...typeStyle('caption'), color: t.colors.clash.mark },
  hint: { ...typeStyle('caption'), color: t.colors.text.muted },
}));
