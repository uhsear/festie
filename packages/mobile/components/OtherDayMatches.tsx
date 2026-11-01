import { View, Text, TouchableOpacity } from 'react-native';
import type { FestivalSet } from '@festie/shared/types';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

interface OtherDayMatchesProps {
  groups: { dayIndex: number; sets: FestivalSet[] }[];
  days: { index: number; date: string; label?: string }[];
  getStageName: (stageId: string) => string | undefined;
  b2bSeparator?: string;
  onSelectDay: (dayIndex: number) => void;
}

/** "Also on {day}" rows for a search that matches artists on days other than the selected one. */
export default function OtherDayMatches({ groups, days, getStageName, b2bSeparator, onSelectDay }: OtherDayMatchesProps) {
  const styles = useStyles();
  if (groups.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {groups.map((group) => {
        const day = days.find((d) => d.index === group.dayIndex);
        const dayLabel = day?.label ?? day?.date ?? `Day ${group.dayIndex + 1}`;
        return (
          <View key={group.dayIndex} style={styles.group}>
            <Text style={styles.header} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {`Also on ${dayLabel}`}
            </Text>
            {group.sets.map((set) => {
              const artist = artistDisplayName(set, b2bSeparator);
              const stage = getStageName(set.stageId) || 'Unknown';
              const time = set.startTime ? formatTime(set.startTime) : 'TBA';
              return (
                <TouchableOpacity
                  key={set.id}
                  style={styles.row}
                  onPress={() => onSelectDay(group.dayIndex)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${artist} on ${dayLabel}`}
                >
                  <Text style={styles.rowText} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {`${artist} · ${stage} · ${time}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[3],
    paddingVertical: t.spacing[3],
  },
  group: {
    gap: t.spacing[1],
  },
  header: {
    ...typeStyle('label', 700),
    color: t.colors.text.primary,
  },
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  rowText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
}));
