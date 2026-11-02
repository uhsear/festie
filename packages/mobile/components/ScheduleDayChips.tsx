import { View, Text, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useFestivalDataStore, useFestivalStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { logicalDayIndexAt, resolveFestivalTimeZone, visibleDayIndexes } from '@festie/shared/utils';
import { makeStyles, typeStyle, MAX_FONT_SCALE, type Tokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useNow } from '../hooks/useNow';

/** Day selector row. Hidden days drop out; a trailing "+N hidden" chip restores them. */
export default function ScheduleDayChips({ hPad }: { hPad: number }) {
  const styles = useStyles();
  const haptics = useHaptics();
  const { getDays } = useFestival();
  const currentFestival = useFestivalDataStore((s) => s.currentFestival);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const hiddenDays = useFestivalStore((s) => s.hiddenDays);
  const setHiddenDays = useFestivalStore((s) => s.setHiddenDays);
  const nowMs = useNow(60_000);

  const days = getDays();
  if (days.length <= 1) return null;

  const todayIndex = logicalDayIndexAt(days, nowMs, resolveFestivalTimeZone(currentFestival));
  const visible = visibleDayIndexes(days.length, hiddenDays, selectedDay);
  const hiddenCount = hiddenDays.length;

  return (
    <View style={styles.daysWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.daysContent, { paddingHorizontal: hPad }]}
      >
        {visible.map((dayPos) => {
          const day = days[dayPos];
          if (!day) return null;
          const active = day.index === selectedDay;
          const isToday = dayPos === todayIndex;
          return (
            <TouchableOpacity
              key={day.index}
              style={styles.dayChip}
              onPress={() => {
                haptics.select();
                setSelectedDay(day.index);
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Day: ${day.label ?? day.date}${isToday ? ' (today)' : ''}`}
            >
              <View style={[styles.dayChipBg, active && styles.dayChipBgActive]} pointerEvents="none" />
              {isToday ? <View style={[styles.todayDot, active && styles.todayDotActive]} /> : null}
              <Text
                style={[styles.dayText, active && styles.dayTextActive]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                textBreakStrategy="simple"
              >
                {day.label ?? day.date}
              </Text>
            </TouchableOpacity>
          );
        })}
        {hiddenCount > 0 ? (
          <TouchableOpacity
            style={styles.dayChip}
            onPress={() => {
              haptics.select();
              setHiddenDays([]);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'day' : 'days'}`}
          >
            <View style={styles.dayChipBg} pointerEvents="none" />
            <Text style={styles.dayText} maxFontSizeMultiplier={MAX_FONT_SCALE} textBreakStrategy="simple">
              +{hiddenCount} hidden
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t: Tokens) => ({
  daysWrap: {
    paddingVertical: t.spacing[3],
  },
  daysContent: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  dayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    // spacing[6]: enough horizontal room that the longest day labels
    // ("Saturday"/"Sunday") clear the pill's rounded edge comfortably — the
    // bg-sibling stops the clip, this keeps the trailing glyph off the edge.
    paddingHorizontal: t.spacing[6],
    paddingVertical: t.spacing[3],
    // WCAG 2.5.5 / 2.5.8 minimum 44x44px touch target (motor accessibility).
    minHeight: 44,
  },
  // Visual (bg/border/radius) lives on this absolutely-positioned sibling,
  // painted behind the label — not on dayChip itself. A Text that's a CHILD of
  // a bg+borderRadius View gets clipped to the rounded bounds on Android; as a
  // sibling it can't be (see SegmentedControl's thumb for the same pattern).
  dayChipBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  dayChipBgActive: {
    backgroundColor: t.colors.accent.aqua,
    borderColor: t.colors.accent.aqua,
  },
  dayText: {
    ...typeStyle('label'),
    // Android Fabric under-measures the final Space Grotesk glyph in these
    // centered pills. The system face preserves the complete day label.
    fontFamily: Platform.OS === 'android' ? undefined : typeStyle('label').fontFamily,
    color: t.colors.text.secondary,
  },
  dayTextActive: {
    color: t.colors.text.onLightAccent,
  },
  todayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.accent.aqua,
  },
  todayDotActive: {
    backgroundColor: t.colors.text.onLightAccent,
  },
}));
