import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useClashResolver, type ClashResolution } from '@festie/shared/hooks';
import { artistDisplayName, fmtDurationMinutes, formatTime } from '@festie/shared/utils';
import type { ConflictGroup } from '@festie/shared/utils';
import { duration as motionDuration } from '@festie/shared/tokens';
import { COPY, clashCount } from '@festie/shared/constants';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useHaptics } from '../hooks/useHaptics';
import { priorityColor } from '../lib/priorityColor';

const UNDO_BAR_MS = 6000;

type Day = { index: number; date: string; label?: string };

/** Right-hand meta of a card: overlap or tight-change numbers, plus the walk. */
function clashMeta(group: ConflictGroup): string {
  const pair = group.picks.length === 2 ? group.pairs[0] : undefined;
  const walk = pair?.walkMinutes && pair.walkMinutes > 0 ? `${pair.walkMinutes} min walk` : null;
  if (group.tight) {
    const gap = pair && pair.gapMinutes > 0 ? `${pair.gapMinutes} min gap` : 'Back to back';
    return [gap, walk].filter(Boolean).join(' · ');
  }
  const overlap = group.overlapMin > 0 ? `${fmtDurationMinutes(group.overlapMin)} overlap` : 'overlapping sets';
  return [overlap, walk].filter(Boolean).join(' · ');
}

/**
 * Clashes on the picks tab, across every festival day. Each card can change
 * picks: Keep one act, Split the time between two, or clear a saved split plan.
 * Every action returns an Undo, shown in a bar at the top for 6 seconds.
 */
export default function ClashCards({ groups, days }: { groups: ConflictGroup[]; days: Day[] }) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const resolver = useClashResolver();
  const [bar, setBar] = useState<{ message: string; undo: (() => Promise<void>) | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  const run = useCallback(
    async (action: () => Promise<ClashResolution>) => {
      clearTimer();
      setBar(null);
      setBusy(true);
      try {
        const result = await action();
        haptics.success();
        setBar({ message: result.message, undo: result.undo });
        timer.current = setTimeout(() => setBar(null), UNDO_BAR_MS);
      } catch (err) {
        haptics.warning();
        setBar({ message: (err instanceof Error && err.message) || COPY.clash.failed, undo: null });
        timer.current = setTimeout(() => setBar(null), UNDO_BAR_MS);
      } finally {
        setBusy(false);
      }
    },
    [clearTimer, haptics],
  );

  const onUndo = useCallback(async () => {
    const undo = bar?.undo;
    if (!undo) return;
    clearTimer();
    setBar(null);
    setBusy(true);
    try {
      await undo();
      haptics.success();
    } catch {
      haptics.warning();
      setBar({ message: COPY.clash.failed, undo: null });
      timer.current = setTimeout(() => setBar(null), UNDO_BAR_MS);
    } finally {
      setBusy(false);
    }
  }, [bar, clearTimer, haptics]);

  if (groups.length === 0 && !bar) return null;
  return (
    <View style={styles.clashWrap}>
      {bar ? (
        <View style={styles.undoBar} accessibilityLiveRegion="polite">
          <Text style={styles.undoText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {bar.message}
          </Text>
          {bar.undo ? (
            <TouchableOpacity
              style={styles.undoButton}
              onPress={onUndo}
              accessibilityRole="button"
              accessibilityLabel={COPY.clash.undo}
            >
              <Text style={styles.undoButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {COPY.clash.undo}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {groups.length > 0 ? (
        <View style={styles.clashHeading}>
          <Ionicons name="warning-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
          <Text style={styles.clashHeadingText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {clashCount(groups.length)}
          </Text>
        </View>
      ) : null}
      {groups.map((group) => (
        <ClashCard
          key={group.picks.map((p) => p.set.id).join('|')}
          group={group}
          days={days}
          busy={busy}
          run={run}
          resolver={resolver}
        />
      ))}
    </View>
  );
}

function ClashCard({
  group,
  days,
  busy,
  run,
  resolver,
}: {
  group: ConflictGroup;
  days: Day[];
  busy: boolean;
  run: (action: () => Promise<ClashResolution>) => Promise<void>;
  resolver: ReturnType<typeof useClashResolver>;
}) {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const separator = useFestivalDataStore((s) => s.currentFestival?.b2bSeparator);

  const latest = group.picks.reduce((a, b) => (b.startMs > a.startMs ? b : a));
  const dayLabel = days.find((d) => d.index === (latest.set.dayIndex ?? 0))?.label;
  const atLabel = formatTime(latest.set.startTime);
  const meta = clashMeta(group);
  const topLine = [dayLabel, atLabel, meta].filter(Boolean).join(' · ');
  const otherCount = group.picks.length - 1;

  const plan = resolver.splitPlan(group);
  const planned = resolver.plannedSplit(group);

  const card = (
    <View style={styles.clashCard}>
      <View style={styles.clashCardHead}>
        <Text style={styles.clashCardTime} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
          {topLine}
        </Text>
        {group.tight ? (
          <View style={styles.tag}>
            <Text style={styles.tagText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {COPY.clash.tight}
            </Text>
          </View>
        ) : null}
        {planned ? (
          <View style={styles.tag}>
            <Text style={styles.tagText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {COPY.clash.splitPlanned}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.clashActList}>
        {group.picks.map((pick) => {
          const recommended = pick.set.id === group.recommendedKeepId;
          const name = artistDisplayName(pick.set, separator);
          return (
            <TouchableOpacity
              key={pick.set.id}
              style={styles.clashActRow}
              activeOpacity={0.8}
              onPress={() => router.push(`/set/${pick.set.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open details for ${name}`}
            >
              <View style={[styles.clashPriorityDot, { backgroundColor: priorityColor(t, pick.priority) }]} />
              <Text
                style={[styles.clashActName, recommended && styles.clashActNameKeep]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {name}
              </Text>
              {recommended ? (
                <View style={styles.tag}>
                  <Text style={styles.tagText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {COPY.clash.suggested}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {planned || plan ? (
        <Text style={styles.planText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {planned ?? plan?.sentence}
        </Text>
      ) : null}
      <View style={styles.buttonRow}>
        {group.picks.map((pick) => {
          const name = artistDisplayName(pick.set, separator);
          return (
            <ActionButton
              key={pick.set.id}
              label={`Keep ${name}`}
              a11y={`Keep ${name} and remove the other ${otherCount === 1 ? 'pick' : `${otherCount} picks`}`}
              disabled={busy}
              onPress={() => run(() => resolver.keep(group, pick.set.id))}
            />
          );
        })}
        {planned ? (
          <ActionButton
            label={COPY.clash.clearPlan}
            a11y={`${COPY.clash.clearPlan}: ${planned}`}
            disabled={busy}
            onPress={() => run(() => resolver.clearSplit(group))}
          />
        ) : plan ? (
          <ActionButton
            label={COPY.clash.split}
            a11y={`Split: ${plan.sentence}`}
            disabled={busy}
            onPress={() => run(() => resolver.split(group))}
          />
        ) : null}
      </View>
    </View>
  );

  if (reduceMotion) return card;
  return <Animated.View entering={FadeIn.duration(motionDuration.med)}>{card}</Animated.View>;
}

function ActionButton({
  label,
  a11y,
  disabled,
  onPress,
}: {
  label: string;
  a11y: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
    >
      <Text style={styles.actionButtonText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  clashWrap: {
    marginBottom: t.spacing[2],
    gap: t.spacing[2],
  },
  undoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    paddingLeft: t.spacing[3],
  },
  undoText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
    paddingVertical: t.spacing[2],
  },
  undoButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: t.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  clashHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  clashHeadingText: {
    ...typeStyle('label'),
    color: t.colors.accent.coral,
  },
  clashCard: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    borderLeftWidth: 4,
    backgroundColor: t.colors.bg.card,
    padding: t.spacing[3],
    gap: t.spacing[2],
  },
  clashCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  clashCardTime: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  clashActList: {
    gap: t.spacing[1],
  },
  clashActRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
  },
  clashPriorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  clashActName: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  clashActNameKeep: {
    ...typeStyle('body', 700),
    color: t.colors.text.primary,
  },
  tag: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  tagText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  planText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  actionButton: {
    minHeight: 44,
    minWidth: 44,
    maxWidth: '100%',
    paddingHorizontal: t.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
}));
