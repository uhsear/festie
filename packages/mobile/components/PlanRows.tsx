import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COPY } from '@festie/shared/constants';
import type { PlanListItem, PlanListKind } from '@festie/shared/utils';
import { artistDisplayName, formatTime, fmtDurationMinutes, reminderLeadLabel } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { priorityColor } from '../lib/priorityColor';
import AppPressable from './AppPressable';

/** "6 min walk from Main Stage", shown above the set you walk to. */
export function WalkRow({ minutes, fromStage }: { minutes: number; fromStage: string }) {
  const t = useTokens();
  const styles = useStyles();
  const label = COPY.myDay.walk(minutes, fromStage);
  return (
    <View style={styles.walkRow} accessible accessibilityLabel={label}>
      <Ionicons name="footsteps-outline" size={t.iconSize.xs} color={t.colors.text.muted} />
      <Text style={styles.mutedText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A free hole between picks: "45 min free". */
export function GapRow({ minutes }: { minutes: number }) {
  const styles = useStyles();
  const label = COPY.myDay.free(fmtDurationMinutes(minutes));
  return (
    <View style={styles.gapRow} accessible accessibilityLabel={label}>
      <Text style={styles.mutedText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A crew meet-up slotted into the day. */
export function MeetRow({ label, location, timeLabel }: { label: string; location: string; timeLabel: string }) {
  const t = useTokens();
  const styles = useStyles();
  const title = COPY.myDay.meet(label);
  return (
    <View style={styles.meetRow} accessible accessibilityLabel={`${title}, ${location}, ${timeLabel}`}>
      <Ionicons name="location-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.mutedText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
          {[timeLabel, location].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

/** A set in the Reminders or Notes list. Opens the set sheet. */
export function PlanListRow({
  item,
  listKind,
  stageName,
  onPress,
}: {
  item: PlanListItem;
  listKind: PlanListKind;
  stageName: string;
  onPress: () => void;
}) {
  const t = useTokens();
  const styles = useStyles();
  const name = artistDisplayName(item.set);
  const time = formatTime(item.set.startTime);
  const detail =
    listKind === 'reminders' && item.reminderMinutes != null ? reminderLeadLabel(item.reminderMinutes) : item.note;
  const a11yDetail =
    listKind === 'reminders' && item.reminderMinutes != null ? `reminder ${detail}` : `note: ${detail ?? ''}`;
  return (
    <AppPressable
      style={styles.planRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${[time, stageName].filter(Boolean).join(', ')}, ${a11yDetail}`}
    >
      <View style={styles.planHead}>
        {item.priority ? <View style={[styles.dot, { backgroundColor: priorityColor(t, item.priority) }]} /> : null}
        <Text style={styles.rowTitle} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <Text style={styles.mutedText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
        {[time, stageName].filter(Boolean).join(' · ')}
      </Text>
      {detail ? (
        <View style={styles.detailRow}>
          {listKind === 'reminders' ? (
            <Ionicons name="notifications-outline" size={t.iconSize.xs} color={t.colors.accent.aqua} />
          ) : null}
          <Text style={styles.detailText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={3}>
            {detail}
          </Text>
        </View>
      ) : null}
    </AppPressable>
  );
}

const useStyles = makeStyles((t) => ({
  walkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingLeft: t.spacing[2],
    minHeight: 32,
  },
  gapRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.colors.border.default,
  },
  meetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[3],
    minHeight: 44,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.card,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...typeStyle('body', 700),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  mutedText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  planRow: {
    gap: t.spacing[1],
    padding: t.spacing[3],
    minHeight: 44,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[1],
  },
  detailText: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
}));
