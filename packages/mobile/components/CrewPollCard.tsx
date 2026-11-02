import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { duration as motionDuration } from '@festie/shared/tokens';
import type { CrewMember, CrewPoll, Priority } from '@festie/shared/types';
import {
  decisionSetId,
  fmtZonedClock,
  isPollClosed,
  pollDecision,
  pollNonVoterIds,
  pollPercent,
  tallyPoll,
  voterNamesLine,
} from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import Button from './Button';
import CrewSyncMarker from './CrewSyncMarker';

interface CrewPollCardProps {
  poll: CrewPoll;
  currentUserId: string;
  canEnd: boolean;
  members: CrewMember[];
  timeZone?: string;
  picks?: Record<string, Priority>;
  voting: boolean;
  onVote: (optionIndex: number) => void;
  onEnd: () => void;
  onNudge: () => void;
  /** Omitted when the crew's festival is not the current one, which hides the button. */
  onAddToPicks?: (setId: string) => void;
}

/**
 * R26: Animated result bar — width transitions via Reanimated withTiming (400ms).
 * Instant when reduce-motion is on. Only the fill bar is animated; option row
 * border / gestures are untouched.
 */
function PollBarFill({
  pct,
  isMine,
  isWinning,
  reduceMotion,
  barStyle,
  winningStyle,
}: {
  pct: number;
  isMine: boolean;
  isWinning: boolean;
  reduceMotion: boolean;
  barStyle: object;
  winningStyle: object;
}) {
  const t = useTokens();
  const widthPct = useSharedValue(pct);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      // Snap to initial value without animation on mount.
      isFirstRender.current = false;
      widthPct.value = pct;
      return;
    }
    widthPct.value = reduceMotion ? pct : withTiming(pct, { duration: 400 });
    // widthPct is a useSharedValue (stable ref); listed to satisfy exhaustive-deps
    // without changing when the effect re-runs (only pct / reduceMotion drive it).
  }, [pct, reduceMotion, widthPct]);

  const animStyle = useAnimatedStyle(() => ({
    width: `${widthPct.value}%` as unknown as number,
  }));

  return (
    <Animated.View
      style={[barStyle, isWinning && winningStyle, isMine && { backgroundColor: t.colors.aquaAlpha[30] }, animStyle]}
    />
  );
}

/** One poll: live bars, voter names, decision, end and reminder actions. */
export default function CrewPollCard({
  poll,
  currentUserId,
  canEnd,
  members,
  timeZone,
  picks,
  voting,
  onVote,
  onEnd,
  onNudge,
  onAddToPicks,
}: CrewPollCardProps) {
  const t = useTokens();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();

  const tally = tallyPoll(poll, currentUserId);
  const isClosed = isPollClosed(poll);
  const decision = pollDecision(poll, tally);
  const winningSetId = isClosed ? decisionSetId(poll, decision) : null;
  const endMs = Date.parse((isClosed ? (poll.closed_at ?? poll.closes_at) : poll.closes_at) ?? '');
  const endLine = Number.isNaN(endMs) ? null : `${isClosed ? 'Ended' : 'Ends'} ${fmtZonedClock(endMs, timeZone)}`;
  const subLine = [poll.multi_answer ? 'Pick any' : null, endLine].filter(Boolean).join(' · ');

  const memberIds = members.map((m) => m.userId);
  const waitingOn = pollNonVoterIds(poll, memberIds).filter((id) => id !== currentUserId).length;
  const canRemind = canEnd && !isClosed && !poll._optimistic && waitingOn > 0 && !poll.nudged_at;
  const reminded = canEnd && !isClosed && !!poll.nudged_at;
  const topCount = Math.max(0, ...tally.counts);

  // DC8: polls fade/reflow in and out as they're created/closed; gated
  // on Reduce Motion (a plain View = instant).
  const PollContainer = reduceMotion ? View : Animated.View;
  const motionProps = reduceMotion
    ? {}
    : {
        entering: FadeIn.duration(motionDuration.med),
        exiting: FadeOut.duration(motionDuration.fast),
        layout: LinearTransition.duration(motionDuration.med),
      };

  return (
    <PollContainer style={styles.pollCard} {...motionProps}>
      <View style={styles.pollHeader}>
        <Text style={styles.pollQuestion}>{poll.question}</Text>
        <Text style={styles.pollVotes}>{tally.voterCount} voted</Text>
      </View>
      {subLine ? <Text style={styles.pollMeta}>{subLine}</Text> : null}
      <CrewSyncMarker item={poll} />
      {poll.options.map((text, i) => {
        const votes = tally.counts[i] ?? 0;
        const pct = pollPercent(votes, tally.voterCount);
        const isMine = tally.myIndexes.includes(i);
        const isWinning = votes === topCount && votes > 0;
        const voterLine = voterNamesLine(tally.voters[i] ?? [], members);
        const tail = voterLine ? `, ${voterLine}` : '';
        // R22: stagger poll options on initial reveal; cap at index 9.
        const optionEntering = reduceMotion ? undefined : FadeInDown.delay(Math.min(i, 9) * 40).duration(250);
        return (
          <Animated.View key={`${poll.id}-${i}`} entering={optionEntering}>
            <TouchableOpacity
              style={[styles.optionButton, isMine && styles.optionButtonMine]}
              onPress={() => onVote(i)}
              disabled={voting || isClosed}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ disabled: isClosed }}
              accessibilityLabel={
                isClosed ? `${text}, ${pct} percent${tail} (poll ended)` : `Vote for ${text}, ${pct} percent${tail}`
              }
            >
              {/* R26: animated width bar */}
              <PollBarFill
                pct={pct}
                isMine={isMine}
                isWinning={isWinning}
                reduceMotion={reduceMotion}
                barStyle={styles.optionFill}
                winningStyle={styles.optionFillWinning}
              />
              <View style={styles.optionContent}>
                <View style={styles.optionLabelCol}>
                  <View style={styles.optionTextRow}>
                    {/* DC25: 15 is off-grid; snap to iconSize.sm (16). */}
                    {isMine ? <Ionicons name="checkmark-circle" size={16} color={t.colors.accent.aqua} /> : null}
                    <Text style={styles.optionText} numberOfLines={1}>
                      {text}
                    </Text>
                  </View>
                  {voterLine ? (
                    <Text style={styles.voterLine} numberOfLines={1}>
                      {voterLine}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.optionPct}>{pct}%</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        );
      })}
      {isClosed ? (
        <View style={styles.decisionRow}>
          <Ionicons name="checkmark-circle" size={t.iconSize.compact} color={t.colors.accent.aqua} />
          <Text style={styles.decisionText}>{decision.text}</Text>
        </View>
      ) : null}
      {winningSetId && onAddToPicks ? (
        picks?.[winningSetId] ? (
          <Text style={styles.pollMeta}>In your picks</Text>
        ) : (
          <Button
            label="Add to my picks"
            variant="secondary"
            onPress={() => onAddToPicks(winningSetId)}
            accessibilityLabel="Add to my picks"
          />
        )
      ) : null}
      {canRemind ? (
        <TouchableOpacity
          onPress={onNudge}
          style={styles.actionRow}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Remind ${waitingOn} ${waitingOn === 1 ? 'person' : 'people'}`}
        >
          <Ionicons name="notifications-outline" size={t.iconSize.compact} color={t.colors.text.secondary} />
          <Text style={styles.actionText}>
            Remind {waitingOn} {waitingOn === 1 ? 'person' : 'people'}
          </Text>
        </TouchableOpacity>
      ) : null}
      {reminded ? <Text style={styles.pollMeta}>Reminder sent</Text> : null}
      {canEnd && !isClosed && !poll._optimistic ? (
        <TouchableOpacity
          onPress={onEnd}
          style={styles.actionRow}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="End poll"
        >
          <Ionicons name="lock-closed-outline" size={t.iconSize.compact} color={t.colors.text.secondary} />
          <Text style={styles.actionText}>End poll</Text>
        </TouchableOpacity>
      ) : null}
    </PollContainer>
  );
}

const useStyles = makeStyles((t) => ({
  pollCard: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    // R2 hairline: neutral white 0.08 separator (was border.light 0.1).
    borderColor: t.colors.glass.border,
    backgroundColor: t.colors.bg.secondary,
  },
  pollHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[2],
  },
  pollQuestion: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  pollVotes: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  pollMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  optionButton: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: t.radii.default,
    borderWidth: 1,
    // R2 hairline: neutral white 0.08 separator (was border.default 0.06).
    borderColor: t.colors.glass.border,
    backgroundColor: t.colors.bg.input,
  },
  optionButtonMine: {
    borderColor: t.colors.accent.aqua,
  },
  optionFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: t.colors.ring.aqua,
  },
  optionFillWinning: {
    backgroundColor: t.colors.ring.coral,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
  },
  optionLabelCol: {
    flex: 1,
  },
  optionTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  optionText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  voterLine: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  optionPct: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  decisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  decisionText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[1],
  },
  actionText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
