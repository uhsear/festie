import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, markCaught } from '@festie/shared/services';
import { useAuthStore, useFestivalDataStore } from '@festie/shared/stores';
import type { FestivalSet, WrapResponse } from '@festie/shared/types';
import { applyCaughtMark, artistDisplayName, catchableMeta, caughtFor, selectCatchable } from '@festie/shared/utils';
import PressableScale from './PressableScale';
import { useHaptics } from '../hooks/useHaptics';
import { makeStyles, typeStyle, useLargeText, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';

interface Props {
  festivalId: string;
  nowMs: number;
  timeZone?: string;
  getStageName: (stageId: string) => string | undefined;
  b2bSeparator?: string;
}

const SAVE_ERROR = "Couldn't save that. Try again.";

/**
 * Now & Next card: up to 3 picks that are playing or ended in the last 2 hours,
 * each with a one-tap "Caught it" toggle. Marks go through markCaught, so they
 * queue offline. Caught state is read from the Wrap data; a failed fetch leaves
 * every row unmarked.
 */
export default function CaughtNowCard({ festivalId, nowMs, timeZone, getStageName, b2bSeparator }: Props) {
  const styles = useStyles();
  const t = useTokens();
  const haptics = useHaptics();
  const largeText = useLargeText();
  const user = useAuthStore((s) => s.user);
  const sets = useFestivalDataStore((s) => s.sets) as FestivalSet[];
  const days = useFestivalDataStore((s) => s.days);
  const picks = useFestivalDataStore((s) => s.currentProfile?.picks);
  const [data, setData] = useState<WrapResponse>();
  const [overlay, setOverlay] = useState<ReadonlyMap<string, boolean | null>>(new Map());
  const [error, setError] = useState(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const items = useMemo(
    () => (user ? selectCatchable({ sets, days, picks, nowMs, timeZone }) : []),
    [user, sets, days, picks, nowMs, timeZone],
  );
  const hasItems = items.length > 0;
  const itemIds = items.map((i) => i.set.id).join(',');

  useFocusEffect(
    useCallback(() => {
      if (!itemIds) return;
      let cancelled = false;
      api
        .get<WrapResponse>(`/ratings/wrap/${festivalId}`)
        .then((res) => {
          if (!cancelled) setData(res);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [itemIds, festivalId]),
  );

  useEffect(() => () => clearTimeout(errorTimer.current), []);

  if (!user || !hasItems) return null;

  const toggle = (setId: string) => {
    const previous = overlay.has(setId) ? overlay.get(setId) : undefined;
    const prevShown = caughtFor(data, overlay, setId);
    const next = prevShown === true ? null : true;
    haptics.select();
    setOverlay((m) => new Map(m).set(setId, next));
    setData((w) => w && applyCaughtMark(w, setId, next));
    AccessibilityInfo.announceForAccessibility(next ? 'Marked as caught' : 'Mark removed');
    markCaught(setId, next, user.id).catch(() => {
      setOverlay((m) => {
        const copy = new Map(m);
        if (previous === undefined) copy.delete(setId);
        else copy.set(setId, previous);
        return copy;
      });
      setData((w) => w && applyCaughtMark(w, setId, prevShown));
      setError(true);
      clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setError(false), 3000);
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        Did you catch it?
      </Text>
      {items.map((item) => {
        const artist = artistDisplayName(item.set, b2bSeparator);
        const selected = caughtFor(data, overlay, item.set.id) === true;
        return (
          <View key={item.set.id} style={[styles.row, largeText && styles.rowStacked]}>
            <View style={styles.text}>
              <Text style={styles.artist} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {artist}
              </Text>
              <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {catchableMeta(item, nowMs, item.set.stageId ? getStageName(item.set.stageId) : null)}
              </Text>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Caught ${artist}`}
              accessibilityState={{ selected }}
              hitSlop={8}
              onPress={() => toggle(item.set.id)}
              style={[styles.button, selected && styles.buttonOn]}
            >
              {selected ? <Ionicons name="checkmark" size={16} color={t.colors.accent.aqua} /> : null}
              <Text
                style={[styles.buttonLabel, selected && styles.buttonLabelOn]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {selected ? 'Caught' : 'Caught it'}
              </Text>
            </PressableScale>
          </View>
        );
      })}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {SAVE_ERROR}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    gap: t.spacing[3],
    padding: t.spacing[4],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  title: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  artist: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  meta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  buttonOn: {
    borderColor: t.colors.accent.aqua,
  },
  buttonLabel: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  buttonLabelOn: {
    color: t.colors.accent.aqua,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.accent.coral,
  },
}));
