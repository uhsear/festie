import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchWrap, isApiClientError, markCaught } from '@festie/shared/services';
import { WRAP_STATE_COPY } from '@festie/shared/constants';
import { useFestival } from '@festie/shared/hooks';
import { useAuthStore, useFestivalDataStore, useUIStore } from '@festie/shared/stores';
import { formatTime, isWrapUnlocked, isWrapUpcoming, selectSetsToRate } from '@festie/shared/utils';
import type { WrapFestival, WrapPlannedSet } from '@festie/shared/types';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import RatingButtons from '../components/RatingButtons';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useHaptics } from '../hooks/useHaptics';
import { ArtistNameInline } from '../components/ArtistName';
import { safeStageColor } from '../lib/stageColor';

type Loaded = { festival: WrapFestival; sets: WrapPlannedSet[] };

function metaLine(set: WrapPlannedSet, festival: WrapFestival): string {
  const day = set.dayIndex === null ? null : (festival.days[set.dayIndex]?.label ?? `Day ${set.dayIndex + 1}`);
  return [set.stageName, day, set.startTime ? formatTime(set.startTime) : null].filter(Boolean).join(' · ');
}

/**
 * "Rate your night" — the picked sets that have ended and are not rated yet,
 * one at a time. The list is frozen on first load so rated sets do not vanish
 * from under the user mid-flow.
 */
export default function RateScreen() {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { getStageColor } = useFestival();
  const { festival: festivalParam } = useLocalSearchParams<{ festival?: string }>();
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestival?.id);
  const festivalId = festivalParam || currentFestivalId;

  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reload, setReload] = useState(0);
  const [index, setIndex] = useState(0);
  const [seenId, setSeenId] = useState<string | null>(null);
  const [anyRated, setAnyRated] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    fetchWrap(festivalId)
      .then((res) => {
        if (cancelled) return;
        setData({ festival: res.festival, sets: selectSetsToRate(res.planned, res.festival) });
        setError(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setNotFound(isApiClientError(e) && e.status === 404);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [festivalId, reload]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Clearing the pending auto-advance keeps a quick Next or Missed it from advancing twice.
  const advance = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setIndex((i) => i + 1);
  }, []);
  const next = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(advance, reduceMotion ? 0 : 300);
  }, [advance, reduceMotion]);

  const mark = useCallback(
    (setId: string, caught: boolean) => {
      if (!userId) return;
      markCaught(setId, caught, userId).catch(() => {
        haptics.warning();
        useUIStore.getState().showToast("Couldn't save that. Try again.", { kind: 'error' });
      });
    },
    [userId, haptics],
  );

  const header = <Stack.Screen options={{ title: 'Rate your night', headerShown: true }} />;

  // Under the empty states the link is the last item, so it clears the gesture bar; atop the rating card it must not.
  const fullListLink = (clearBottomInset: boolean) =>
    festivalId ? (
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/caught', params: { festival: festivalId } })}
        style={[styles.fullList, clearBottomInset && { paddingBottom: insets.bottom + t.spacing[2] }]}
        accessibilityRole="link"
        accessibilityLabel="See the full list"
      >
        <Text style={styles.fullListText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          See the full list
        </Text>
      </TouchableOpacity>
    ) : null;

  if (!festivalId) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="musical-notes-outline"
          title="Nothing to rate right now"
          message="Sets you picked show up here after they end."
        />
      </View>
    );
  }

  if (error && !data && notFound) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="musical-notes-outline"
          title={WRAP_STATE_COPY.notFound.title}
          message={WRAP_STATE_COPY.notFound.description}
        />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load your sets"
          action={{
            label: 'Try again',
            onPress: () => {
              setError(false);
              setReload((n) => n + 1);
            },
          }}
        />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[styles.screen, styles.centered]}>
        {header}
        <ActivityIndicator color={t.colors.accent.aqua} />
      </View>
    );
  }

  if (isWrapUpcoming(data.festival)) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="musical-notes-outline"
          title={WRAP_STATE_COPY.notStarted.title}
          message={WRAP_STATE_COPY.notStarted.description}
        />
      </View>
    );
  }

  if (data.sets.length === 0) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="musical-notes-outline"
          title="Nothing to rate right now"
          message="Sets you picked show up here after they end."
        />
        {fullListLink(true)}
      </View>
    );
  }

  if (index >= data.sets.length) {
    const unlocked = isWrapUnlocked(data.festival);
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="checkmark-circle-outline"
          title={anyRated ? 'All rated' : "That's everything for now"}
          message={anyRated ? 'Thanks. Your ratings go into your wrap.' : 'Rate any set from the full list whenever you like.'}
          action={{
            label: unlocked ? 'See your wrap' : 'Back to picks',
            onPress: () =>
              unlocked
                ? router.replace({ pathname: '/wrap', params: { festival: festivalId } })
                : router.replace('/(tabs)/picks'),
          }}
        />
        {fullListLink(true)}
      </View>
    );
  }

  const set = data.sets[index]!;
  const meta = metaLine(set, data.festival);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {header}
      {fullListLink(false)}
      <Text style={styles.progress} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {`${index + 1} of ${data.sets.length}`}
      </Text>
      <View
        style={styles.rail}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Sets rated"
        accessibilityValue={{ min: 1, max: data.sets.length, now: index + 1 }}
      >
        <View
          style={[
            styles.railFill,
            {
              width: `${((index + 1) / data.sets.length) * 100}%`,
              backgroundColor: safeStageColor(set.stageId ? getStageColor(set.stageId) : undefined, t.colors.text.muted),
            },
          ]}
        />
      </View>
      <Text style={styles.artist} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
        <ArtistNameInline name={set.artist || 'Unknown artist'}>{set.artist || 'Unknown artist'}</ArtistNameInline>
      </Text>
      {meta ? (
        <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {meta}
        </Text>
      ) : null}
      <View style={styles.caughtRow}>
        <Button
          label="Saw it"
          variant={seenId === set.setId ? 'primary' : 'secondary'}
          accessibilityState={{ selected: seenId === set.setId }}
          onPress={() => {
            mark(set.setId, true);
            setSeenId(set.setId);
          }}
          style={styles.caughtButton}
        />
        <Button
          label="Missed it"
          variant="secondary"
          onPress={() => {
            mark(set.setId, false);
            advance();
          }}
          style={styles.caughtButton}
        />
      </View>
      {seenId === set.setId ? (
        <View style={styles.rating}>
          <RatingButtons
            key={set.setId}
            setId={set.setId}
            festivalId={festivalId}
            showMemory={false}
            onRated={() => {
              setAnyRated(true);
              mark(set.setId, true);
              next();
            }}
          />
        </View>
      ) : null}
      <Button label="Next" variant="ghost" onPress={advance} />
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  progress: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  artist: {
    ...typeStyle('display-lg'),
    color: t.colors.text.primary,
    textAlign: 'center',
  },
  meta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  caughtRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
    marginTop: t.spacing[3],
  },
  caughtButton: {
    flex: 1,
  },
  fullList: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullListText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    textDecorationLine: 'underline',
  },
  rail: {
    height: 4,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.border.default,
    overflow: 'hidden',
  },
  railFill: {
    height: '100%',
    borderRadius: t.radii.pill,
  },
  rating: {
    marginVertical: t.spacing[3],
  },
}));
