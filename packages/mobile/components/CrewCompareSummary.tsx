import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import {
  artistDisplayName,
  fmtZonedClock,
  formatGapLength,
  type CrewSplit,
  type CrewTogether,
  type FreeSlot,
} from '@festie/shared/utils';
import type { CrewCompareColumn } from '@festie/shared/hooks';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import Button from './Button';

interface Props {
  columns: CrewCompareColumn[];
  freeTogether: FreeSlot[];
  split: CrewSplit[];
  together: CrewTogether[];
  timeZone: string | undefined;
}

/**
 * Compare's colour key (one dot per member, matching the column header bars),
 * the "Free together" times when nobody in the crew has a pick, and the
 * "Split" and "Together" lists.
 */
export default function CrewCompareSummary({ columns, freeTogether, split, together, timeZone }: Props) {
  const styles = useStyles();
  const router = useRouter();
  const names = (ids: string[]) =>
    ids
      .map((id) => columns.find((c) => c.profileId === id))
      .map((c) => (c?.isMe ? 'You' : (c?.name ?? 'Crew member')))
      .join(', ');

  return (
    <View style={styles.wrap}>
      <View style={styles.key} accessibilityLabel="Crew colour key">
        {columns.map((col) => (
          <View key={col.profileId} style={styles.keyItem}>
            <View style={[styles.dot, { backgroundColor: col.color }]} importantForAccessibility="no" />
            <Text style={styles.keyText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {col.isMe ? 'You' : col.name}
            </Text>
          </View>
        ))}
      </View>
      {freeTogether.length > 0 ? (
        <View style={styles.free}>
          <Text style={styles.heading} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
            Free together
          </Text>
          <Text style={styles.note} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Nobody in the crew has a pick then.
          </Text>
          <View style={styles.chips}>
            {freeTogether.map((slot) => (
              <Text key={slot.startMs} style={styles.chip} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {`${fmtZonedClock(slot.startMs, timeZone)} – ${fmtZonedClock(slot.endMs, timeZone)} · ${formatGapLength(slot.minutes)}`}
              </Text>
            ))}
          </View>
          <Button
            label="Add meeting point"
            variant="secondary"
            size="sm"
            onPress={() => router.push({ pathname: '/(tabs)/crew', params: { tab: 'find' } })}
          />
        </View>
      ) : null}
      {split.length > 0 ? (
        <View style={styles.free}>
          <Text style={styles.heading} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
            Split
          </Text>
          <Text style={styles.note} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            The crew picked different sets at the same time.
          </Text>
          {split.map((s) => (
            <View key={s.startMs}>
              <Text style={styles.rowTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {`${fmtZonedClock(s.startMs, timeZone)} – ${fmtZonedClock(s.endMs, timeZone)}`}
              </Text>
              {s.sides.map((side) => (
                <Text key={side.set.id} style={styles.keyText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {`${artistDisplayName(side.set)}: ${names(side.memberIds)}`}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {together.length > 0 ? (
        <View style={styles.free}>
          <Text style={styles.heading} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
            Together
          </Text>
          <Text style={styles.note} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Sets you can see as a group, with no clash.
          </Text>
          {together.map((t) => (
            <Text key={t.set.id} style={styles.keyText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {`${artistDisplayName(t.set)} · ${fmtZonedClock(t.startMs, timeZone)} · ${names(t.memberIds)}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    marginBottom: t.spacing[3],
    gap: t.spacing[3],
  },
  key: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[3],
  },
  keyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  keyText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  free: {
    padding: t.spacing[3],
    gap: t.spacing[2],
    alignItems: 'flex-start',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.glass.border,
    backgroundColor: t.colors.bg.card,
  },
  heading: {
    ...typeStyle('label', 700),
    color: t.colors.text.primary,
  },
  note: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  rowTitle: {
    ...typeStyle('caption', 700),
    color: t.colors.text.primary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  chip: {
    ...typeStyle('caption', 700),
    color: t.colors.text.primary,
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
}));
