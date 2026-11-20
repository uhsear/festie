import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useFestivalStore } from '@festie/shared/stores';
import { useInterestedRows } from '@festie/shared/hooks';
import { lineupDays, lineupEntryBadge, lineupEntryName, markedWithoutSet } from '@festie/shared/utils';
import { useNow } from '../hooks/useNow';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

/**
 * The Picks tab group "Marked, no set yet": acts the user marked that no set covers. Each row has the
 * same badge as the lineup. A mark turns into a pick row once sets exist, so the group hides when empty.
 */
export default function MarkedNoSet() {
  const styles = useStyles();
  const rows = markedWithoutSet(useInterestedRows());
  const festival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const sets = useFestivalStore((s) => s.sets);
  const nowMs = useNow(60_000);
  const lineup = useMemo(() => lineupDays(days, sets), [days, sets]);
  if (rows.length === 0) return null;

  return (
    <View style={styles.group}>
      <Text style={styles.heading} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        Marked, no set yet
      </Text>
      {rows.map((row) => (
        <View key={row.entry.id} style={styles.row}>
          <Text style={styles.name} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {lineupEntryName(row.entry, festival?.b2bSeparator)}
          </Text>
          {lineupEntryBadge(row.entry, row.cover, lineup, festival?.publishedAt, nowMs).map((badge) => (
            <View key={badge.kind} style={styles.pill}>
              <Text style={styles.pillText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {badge.text}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  group: { marginBottom: t.spacing[3] },
  heading: { ...typeStyle('label'), color: t.colors.text.primary, marginBottom: t.spacing[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.spacing[2], minHeight: 44 },
  name: { ...typeStyle('body'), color: t.colors.text.primary },
  pill: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 2,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  pillText: { ...typeStyle('caption'), color: t.colors.text.secondary },
}));
