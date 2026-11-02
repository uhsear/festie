import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName, festivalStartMinutes } from '@festie/shared/utils';
import { clashPromptCopy, clashesWith } from '@festie/shared/constants';
import { duration as motionDuration } from '@festie/shared/tokens';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useReduceMotion } from '../hooks/useReduceMotion';

interface Props {
  /** The set currently open in the detail screen. */
  currentSet: FestivalSet;
  /**
   * Sets that overlap `currentSet` and are also PICKED — already day-index
   * guarded and de-duped upstream by detectConflicts in conflicts.ts.
   */
  conflicts: FestivalSet[];
  b2bSeparator?: string;
  /**
   * Resolve the user's pick priority for a set. When both sides of a clash are
   * `must`, the prompt escalates to an explicit "you have a conflict" — the
   * unavoidable decision worth surfacing loudly (Clashfinder pattern). Optional:
   * without it every clash uses the softer "keep one" copy.
   */
  getPriority?: (setId: string) => Priority | null | undefined;
  /**
   * Demote/clear one side of a clash, with the display name of the act being
   * cleared for the undo toast. Maps to usePickClear(), which is offline-queued —
   * resolving a clash works on dead signal.
   */
  onClear: (setId: string, label: string) => void;
}

/** Stable, order-independent key so a resolved/dismissed pair never re-nags. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** "2 acts at 8:30" anchors on the later start — when both are first on stage. */
function overlapStartLabel(a: FestivalSet, b: FestivalSet): string {
  const aS = festivalStartMinutes(a.startTime);
  const bS = festivalStartMinutes(b.startTime);
  const later = aS >= bS ? a : b;
  return formatTime(later.startTime);
}

/**
 * Inline clash prompt (M1, mobile parity of the web ClashPrompt). For each
 * overlapping PICKED pair through the open set, names both acts and lets the
 * user keep one — clearing the other via savePick(...,null). Shows once per
 * pair (in-memory for the screen's lifetime); after "Keep both" one quiet
 * "Clashes with" line stays as the lasting signal so we don't double-nag.
 */
export default function ClashPrompt({ currentSet, conflicts, b2bSeparator, getPriority, onClear }: Props) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const reduceMotion = useReduceMotion();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  // Pair keys we've already buzzed for, so a re-render (or another conflict
  // appearing) never re-fires the warning for a clash the user already felt.
  const warnedKeys = useRef<Set<string>>(new Set());

  const dismissPair = useCallback((key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const active = useMemo(
    () => conflicts.filter((c) => !dismissed.has(pairKey(currentSet.id, c.id))),
    [conflicts, dismissed, currentSet.id],
  );

  // DC22: fire warning() once when a NEW conflict surfaces — warning()'s own
  // documented use-case (a missed-headliner clash is exactly the moment a
  // glance-down festival user wants a physical nudge). Tracked per pair key so
  // it never re-buzzes a clash already felt or one the user is just scrolling past.
  useEffect(() => {
    const fresh = active.some((c) => !warnedKeys.current.has(pairKey(currentSet.id, c.id)));
    for (const c of active) warnedKeys.current.add(pairKey(currentSet.id, c.id));
    if (fresh) haptics.warning();
  }, [active, currentSet.id, haptics]);

  // Resolve a clash: clear the chosen-against side, dismiss the pair, and confirm
  // with a success buzz — clearing a conflict is a real "decision made" moment.
  const resolve = useCallback(
    (clearId: string, label: string, key: string) => {
      haptics.success();
      onClear(clearId, label);
      dismissPair(key);
    },
    [haptics, onClear, dismissPair],
  );

  const keepBoth = useCallback(
    (key: string) => {
      haptics.tap();
      dismissPair(key);
    },
    [haptics, dismissPair],
  );

  if (conflicts.length === 0) return null;

  const currentName = artistDisplayName(currentSet, b2bSeparator);
  const quiet = conflicts.filter((c) => dismissed.has(pairKey(currentSet.id, c.id)));

  return (
    <View style={styles.wrap}>
      {active.length > 1 ? (
        <View style={styles.summary} accessibilityRole="header">
          <Ionicons name="warning" size={t.iconSize.sm} color={t.colors.accent.coral} />
          <Text style={styles.summaryText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {`${active.length} clashes with ${currentName}`}
          </Text>
        </View>
      ) : null}
      {active.map((c) => {
        const key = pairKey(currentSet.id, c.id);
        const otherName = artistDisplayName(c, b2bSeparator);
        const at = overlapStartLabel(currentSet, c);
        // Both sides a must-see → escalate to an explicit clash.
        const hard = getPriority?.(currentSet.id) === 'must' && getPriority?.(c.id) === 'must';
        const { title, body } = clashPromptCopy({ hard, at, currentName, otherName });
        const card = (
          <View style={styles.card} accessibilityRole="alert">
            <View style={styles.header}>
              <Ionicons name="alert-circle" size={t.iconSize.sm} color={t.colors.accent.coral} />
              <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {title}
              </Text>
            </View>
            <Text style={styles.body}>{body}</Text>
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.keepButton}
                onPress={() => resolve(c.id, otherName, key)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Keep ${currentName}, clear ${otherName}`}
              >
                <Ionicons name="checkmark" size={t.iconSize.xs} color={t.colors.accent.aqua} />
                <Text style={styles.keepText} numberOfLines={1}>{`Keep ${currentName}`}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keepButton}
                onPress={() => resolve(currentSet.id, currentName, key)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Keep ${otherName}, clear ${currentName}`}
              >
                <Ionicons name="checkmark" size={t.iconSize.xs} color={t.colors.accent.aqua} />
                <Text style={styles.keepText} numberOfLines={1}>{`Keep ${otherName}`}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={() => keepBoth(key)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Keep both acts"
              >
                <Text style={styles.dismissText}>Keep both</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
        if (reduceMotion) return <View key={c.id}>{card}</View>;
        return (
          <Animated.View
            key={c.id}
            entering={FadeIn.duration(motionDuration.med)}
            exiting={FadeOut.duration(motionDuration.fast)}
            layout={LinearTransition.duration(motionDuration.med)}
          >
            {card}
          </Animated.View>
        );
      })}
      {quiet.length > 0 ? (
        <View style={styles.quiet}>
          <Ionicons name="warning" size={14} color={t.colors.text.muted} />
          <Text style={styles.quietText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {clashesWith(quiet.map((c) => artistDisplayName(c, b2bSeparator)))}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: t.spacing[2],
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  summaryText: {
    ...typeStyle('label'),
    color: t.colors.accent.coral,
    flexShrink: 1,
  },
  quiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  quietText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  card: {
    gap: t.spacing[2],
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  title: {
    ...typeStyle('label'),
    color: t.colors.accent.coral,
    flex: 1,
  },
  body: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  keepButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.card,
    flexShrink: 1,
    maxWidth: '100%',
  },
  keepText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  dismissButton: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.pill,
  },
  dismissText: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
  },
}));
