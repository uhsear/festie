import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCheckIn } from '@festie/shared/hooks';
import { checkinErrorMessage, type SosPosition } from '@festie/shared/services';
import { CHECKIN_COPY, CHECKIN_DURATIONS } from '@festie/shared/constants';
import { formatCountdown } from '@festie/shared/utils';
import { useTokens, makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useNow } from '../hooks/useNow';

const clockOf = (epochMs: number) =>
  new Date(epochMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Best-effort fix for the check-in: only when permission is already granted, never prompts, never blocks past 4 s. */
async function lastLocation(): Promise<SosPosition | undefined> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return undefined;
    const pos = await Promise.race([
      Location.getLastKnownPositionAsync().then(
        (seed) => seed ?? Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (!pos) return undefined;
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
      capturedAt: new Date(pos.timestamp).toISOString(),
    };
  } catch {
    return undefined;
  }
}

export default function CrewCheckIn({ crewId }: { crewId: string }) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const { checkin, busy, start, done } = useCheckIn(crewId);
  const now = useNow(30_000);
  const [starting, setStarting] = useState(false);

  const onStart = useCallback(
    async (minutes: number) => {
      if (starting || busy) return;
      setStarting(true);
      try {
        const position = await lastLocation();
        const timer = await start(minutes, position);
        haptics.success();
        if (timer) Alert.alert(CHECKIN_COPY.title, CHECKIN_COPY.started(clockOf(new Date(timer.dueAt).getTime())));
      } catch (err) {
        Alert.alert(CHECKIN_COPY.title, checkinErrorMessage(err, 'start'));
      } finally {
        setStarting(false);
      }
    },
    [starting, busy, start, haptics],
  );

  const onDone = useCallback(async () => {
    try {
      if (await done()) haptics.success();
      else Alert.alert(CHECKIN_COPY.title, CHECKIN_COPY.ended);
    } catch (err) {
      Alert.alert(CHECKIN_COPY.title, checkinErrorMessage(err, 'done'));
    }
  }, [done, haptics]);

  const dueMs = checkin ? new Date(checkin.dueAt).getTime() : 0;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="timer-outline" size={t.iconSize.md} color={t.colors.accent.amber} />
        <Text style={styles.title} accessibilityRole="header">
          {checkin ? CHECKIN_COPY.activeTitle(clockOf(dueMs)) : CHECKIN_COPY.title}
        </Text>
      </View>
      {checkin ? (
        <>
          <Text style={styles.body}>{CHECKIN_COPY.activeBody(formatCountdown(Math.max(0, dueMs - now)))}</Text>
          <TouchableOpacity
            style={styles.okButton}
            onPress={() => void onDone()}
            disabled={busy}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={CHECKIN_COPY.okA11y}
          >
            <Text style={styles.okText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{CHECKIN_COPY.ok}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.body}>{CHECKIN_COPY.idleBody}</Text>
          <View style={styles.chips}>
            {CHECKIN_DURATIONS.map(({ minutes, label }) => (
              <TouchableOpacity
                key={minutes}
                onPress={() => void onStart(minutes)}
                disabled={starting || busy}
                style={styles.chip}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Check in within ${label}`}
              >
                <Text style={styles.chipText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] },
  title: { ...typeStyle('label', 700), color: t.colors.text.primary, flex: 1 },
  body: { ...typeStyle('caption'), color: t.colors.text.secondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing[2] },
  chip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
  },
  chipText: { ...typeStyle('label'), color: t.colors.text.secondary },
  okButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.aqua,
  },
  okText: { ...typeStyle('label', 700), color: t.colors.text.onAccent },
}));
