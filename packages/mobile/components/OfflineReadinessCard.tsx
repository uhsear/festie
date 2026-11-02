import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { SectionReadiness } from '@festie/shared/stores';
import { timeAgo, offlineStatusLabel, offlineActionLabel } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useOfflineDownload } from '../hooks/useOfflineDownload';

interface Props {
  festivalId: string;
}

// R18: Animated aqua dot for the active/syncing state.
// Pulse: opacity 1 -> 0.45 -> 1 at 900ms. Skips animation when reduce-motion is on.
function ActiveDot() {
  const dotStyles = useDotStyles();
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.7;
      return;
    }
    opacity.value = withRepeat(withTiming(0.45, { duration: 450, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [reduceMotion, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[dotStyles.activeDot, animStyle]} />;
}

const useDotStyles = makeStyles((t) => ({
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 9999,
    backgroundColor: t.colors.accent.aqua,
  },
}));

// R18: per-step row.
function StepRow({
  label,
  section,
  tick,
  onRetry,
}: {
  label: string;
  section: SectionReadiness;
  tick: number;
  onRetry?: () => void;
}) {
  // tick forces re-render so "synced N ago" advances from the device clock.
  void tick;

  const t = useTokens();
  const styles = useRowStyles();

  const isPending = section.status === 'idle';
  const isActive = section.status === 'syncing';
  const isDone = section.status === 'ready';
  const isError = section.status === 'error';

  const timeLabel =
    isDone && section.syncedAt != null
      ? `synced ${timeAgo(section.syncedAt)}`
      : isDone
        ? 'ready'
        : isError && section.syncedAt != null
          ? `failed · ${timeAgo(section.syncedAt)}`
          : isError
            ? 'failed'
            : null;

  return (
    <View
      style={styles.row}
      accessibilityRole="none"
      accessibilityLabel={`${label}: ${isActive ? 'downloading' : isDone ? 'ready' : isError ? 'error' : 'not downloaded'}`}
    >
      {/* Step indicator */}
      <View style={styles.indicator}>
        {isDone ? (
          <Ionicons name="checkmark-circle" size={16} color={t.colors.accent.aqua} />
        ) : isError ? (
          <Ionicons name="alert-circle" size={16} color={t.colors.accent.coral} />
        ) : isActive ? (
          <ActiveDot />
        ) : (
          <View style={styles.pendingDot} />
        )}
      </View>

      {/* Step label */}
      <Text
        style={[
          styles.label,
          isDone && styles.labelDone,
          isActive && styles.labelActive,
          isPending && styles.labelPending,
          isError && styles.labelError,
        ]}
      >
        {label}
      </Text>

      {/* Right-side: time label or retry */}
      {isError && onRetry ? (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={`Retry ${label}`}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      ) : timeLabel ? (
        <Text style={[styles.timeLabel, isError && styles.timeLabelError]} numberOfLines={1}>
          {timeLabel}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Mobile offline-download card (mirror of web's OfflineReadinessCard).
 *
 * One header row (status text, action button, chevron) that stays one line
 * until opened; the chevron reveals the description and the per-step list
 * (schedule / picks / crew / weather / art, plus "Offline map" for festivals
 * with an archive). State comes from `useOfflineDownload`, which also drives
 * the status chips. Hidden for a past festival when nothing was saved.
 */
export default function OfflineReadinessCard({ festivalId }: Props) {
  const t = useTokens();
  const styles = useCardStyles();
  const { steps, summary, download, isDownloading, hasMap } = useOfflineDownload(festivalId);
  const [expanded, setExpanded] = useState(false);

  // 30s tick so "synced N ago" keeps advancing from the device clock.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (summary.hidden) return null;

  const icon =
    summary.overall === 'ready' ? (
      <Ionicons name="checkmark-circle" size={16} color={t.colors.accent.aqua} />
    ) : summary.overall === 'partial' ? (
      <Ionicons name="alert-circle" size={16} color={t.colors.accent.coral} />
    ) : summary.overall === 'syncing' ? (
      <ActiveDot />
    ) : (
      <Ionicons name="download-outline" size={16} color={t.colors.text.muted} />
    );

  return (
    <View style={styles.card} accessibilityRole="none" accessibilityLabel="Download festival for offline">
      <View style={styles.header}>
        <View style={styles.statusIcon}>{icon}</View>
        <Text style={styles.statusText} numberOfLines={2}>
          {offlineStatusLabel(summary)}
        </Text>
        <TouchableOpacity
          onPress={download}
          disabled={isDownloading}
          accessibilityRole="button"
          accessibilityLabel={
            isDownloading ? 'Downloading' : summary.hasDownloaded ? 'Update offline cache' : 'Download for offline'
          }
          accessibilityState={{ busy: isDownloading, disabled: isDownloading }}
          style={[styles.button, isDownloading && styles.buttonBusy]}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>{offlineActionLabel(summary)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Show offline download details"
          accessibilityState={{ expanded }}
          style={styles.chevron}
        >
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.text.muted} />
        </TouchableOpacity>
      </View>

      {expanded ? (
        <>
          <Text style={styles.subtitle}>
            {hasMap
              ? 'Saves the schedule, your picks, crew plan, weather, artist art and the festival map so they work with no signal.'
              : 'Saves the schedule, your picks, crew plan, weather and artist art so they work with no signal. The map needs signal at this festival.'}
          </Text>
          <View style={styles.stepList} accessibilityRole="list">
            {steps.map(({ key, label, section, detail }, i) => (
              <View key={key} style={i < steps.length - 1 ? styles.stepBorder : undefined}>
                <StepRow
                  label={label}
                  section={section}
                  tick={tick}
                  onRetry={section.status === 'error' ? download : undefined}
                />
                {detail ? <Text style={styles.detail}>{detail}</Text> : null}
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const useCardStyles = makeStyles((t) => ({
  card: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    padding: t.spacing[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  statusIcon: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    ...typeStyle('label'),
    flex: 1,
    color: t.colors.text.primary,
  },
  subtitle: {
    ...typeStyle('caption'),
    marginTop: t.spacing[3],
    color: t.colors.text.secondary,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accent.aqua,
    borderRadius: t.radii.sm,
    paddingVertical: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    flexShrink: 0,
    minHeight: 44,
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
  chevron: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepList: {
    marginTop: t.spacing[3],
  },
  detail: {
    ...typeStyle('micro'),
    color: t.colors.accent.coral,
    paddingBottom: t.spacing[2],
  },
  stepBorder: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
}));

const useRowStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
  },
  indicator: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 9999,
    backgroundColor: t.colors.border.light,
  },
  label: {
    ...typeStyle('caption'),
    flex: 1,
    color: t.colors.text.primary,
  },
  labelDone: {
    color: t.colors.text.primary,
  },
  labelActive: {
    color: t.colors.text.secondary,
  },
  labelPending: {
    color: t.colors.text.muted,
  },
  labelError: {
    color: t.colors.accent.coral,
  },
  timeLabel: {
    ...typeStyle('micro'),
    color: t.colors.accent.aqua,
    flexShrink: 0,
  },
  timeLabelError: {
    color: t.colors.accent.coral,
  },
  retryButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    ...typeStyle('micro', 600),
    color: t.colors.accent.coral,
  },
}));
