import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@festie/shared/services';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import { festivalPhase, selectSetsToRate } from '@festie/shared/utils';
import type { WrapResponse } from '@festie/shared/types';
import Button from './Button';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

/**
 * Picks-tab banner: shown during or after the festival when picked sets have
 * ended and are not rated yet. Fetches the Wrap data each time the tab gains focus.
 */
export default function RateNightBanner() {
  const styles = useStyles();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const days = useFestivalDataStore((s) => s.days);
  const [count, setCount] = useState(0);
  const festivalId = festival?.id;
  const phase = festivalPhase(festival, days);
  const eligible = !!user && !!festivalId && (phase === 'live' || phase === 'post');

  useFocusEffect(
    useCallback(() => {
      if (!eligible) return;
      let cancelled = false;
      api
        .get<WrapResponse>(`/ratings/wrap/${festivalId}`)
        .then((res) => {
          if (!cancelled) setCount(selectSetsToRate(res.planned, res.festival).length);
        })
        .catch(() => {
          if (!cancelled) setCount(0);
        });
      return () => {
        cancelled = true;
      };
    }, [eligible, festivalId]),
  );

  if (!eligible || count === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.body}>
        <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {`${count} ${count === 1 ? 'set' : 'sets'} to rate`}
        </Text>
        <Text style={styles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          Rate them while you still remember.
        </Text>
      </View>
      <Button
        label="Rate now"
        size="sm"
        onPress={() => router.push({ pathname: '/rate', params: { festival: festivalId! } })}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    marginBottom: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  sub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
}));
