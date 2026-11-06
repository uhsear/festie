import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useFestivalDataStore } from '@festie/shared/stores';
import {
  lockscreenChangeText,
  lockscreenChanges,
  lockscreenSavedKey,
  parseSavedImageRecord,
  savedImageExpired,
} from '@festie/shared/utils';
import Button from './Button';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

/**
 * Picks-tab banner: shown when a set on a saved lock-screen image has moved, changed
 * stage or name, or left the lineup. Checks the saved images each time the tab gains
 * focus and hides once every set on the image has ended or the image is saved again.
 */
export default function LockscreenStaleBanner() {
  const styles = useStyles();
  const router = useRouter();
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const days = useFestivalDataStore((s) => s.days);
  const [stale, setStale] = useState<{ dayIndex: number; text: string } | null>(null);
  const festivalId = festival?.id;
  const timeZone = festival?.timeZone;
  const b2bSeparator = festival?.b2bSeparator;

  useFocusEffect(
    useCallback(() => {
      if (!festivalId || !sets.length) {
        setStale(null);
        return;
      }
      let cancelled = false;
      const dayIndexes = [...new Set([...days.map((d, i) => d.dayIndex ?? i), ...sets.map((s) => s.dayIndex ?? 0)])];
      AsyncStorage.multiGet(dayIndexes.map((d) => lockscreenSavedKey(festivalId, d)))
        .then((rows) => {
          if (cancelled) return;
          const now = Date.now();
          for (const [, raw] of rows) {
            const record = parseSavedImageRecord(raw);
            if (!record || savedImageExpired(record, sets, days, now, timeZone)) continue;
            const text = lockscreenChangeText(lockscreenChanges(record, sets, stages, b2bSeparator));
            if (text) {
              setStale({ dayIndex: record.dayIndex, text });
              return;
            }
          }
          setStale(null);
        })
        .catch((err: unknown) => console.warn('lock-screen banner: could not read saved images', err));
      return () => {
        cancelled = true;
      };
    }, [festivalId, sets, stages, days, timeZone, b2bSeparator]),
  );

  if (!stale) return null;

  return (
    <View style={styles.card}>
      <Text style={[styles.body, styles.text]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {stale.text}
      </Text>
      <Button
        label="Re-save"
        size="sm"
        onPress={() => router.push({ pathname: '/picks-image', params: { day: String(stale.dayIndex) } })}
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
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  body: { flex: 1 },
  text: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
}));
