import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { api, markCaught } from '@festie/shared/services';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import { formatTime, isWrapUnlocked, selectSetsToRate } from '@festie/shared/utils';
import type { WrapFestival, WrapPlannedSet, WrapResponse } from '@festie/shared/types';
import EmptyState from '../components/EmptyState';
import Button from '../components/Button';
import RatingButtons from '../components/RatingButtons';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';

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
  const { festival: festivalParam } = useLocalSearchParams<{ festival?: string }>();
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestival?.id);
  const festivalId = festivalParam || currentFestivalId;

  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [index, setIndex] = useState(0);
  const [seenId, setSeenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    api
      .get<WrapResponse>(`/ratings/wrap/${festivalId}`)
      .then((res) => {
        if (cancelled) return;
        setData({ festival: res.festival, sets: selectSetsToRate(res.planned, res.festival) });
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
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

  const advance = useCallback(() => setIndex((i) => i + 1), []);
  const next = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(advance, reduceMotion ? 0 : 300);
  }, [advance, reduceMotion]);

  const mark = useCallback(
    (setId: string, caught: boolean) => {
      if (!userId) return;
      markCaught(setId, caught, userId).catch((err) => console.warn('Mark set caught failed', err));
    },
    [userId],
  );

  const header = <Stack.Screen options={{ title: 'Rate your night', headerShown: true }} />;

  const fullListLink = festivalId ? (
    <TouchableOpacity
      onPress={() => router.push({ pathname: '/caught', params: { festival: festivalId } })}
      style={styles.fullList}
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

  if (data.sets.length === 0) {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="musical-notes-outline"
          title="Nothing to rate right now"
          message="Sets you picked show up here after they end."
        />
        {fullListLink}
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
          title="All rated"
          message="Thanks. Your ratings go into your wrap."
          action={{
            label: unlocked ? 'See your wrap' : 'Back to picks',
            onPress: () =>
              unlocked
                ? router.replace({ pathname: '/wrap', params: { festival: festivalId } })
                : router.replace('/(tabs)/picks'),
          }}
        />
        {fullListLink}
      </View>
    );
  }

  const set = data.sets[index]!;
  const meta = metaLine(set, data.festival);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {header}
      {fullListLink}
      <Text style={styles.progress} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {`${index + 1} of ${data.sets.length}`}
      </Text>
      <Text style={styles.artist} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
        {set.artist || 'Unknown artist'}
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
          label="Skipped"
          variant="secondary"
          onPress={() => {
            mark(set.setId, false);
            advance();
          }}
          style={styles.caughtButton}
        />
      </View>
      <View style={styles.rating}>
        <RatingButtons
          key={set.setId}
          setId={set.setId}
          festivalId={festivalId}
          showMemory={false}
          onRated={() => {
            mark(set.setId, true);
            next();
          }}
        />
      </View>
      <Button label="Skip" variant="ghost" onPress={advance} />
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
    ...typeStyle('title'),
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
  rating: {
    marginVertical: t.spacing[3],
  },
}));
