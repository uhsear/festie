import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFestivalDataStore } from '@festie/shared/stores';
import { DISCOVER_COPY } from '@festie/shared/constants';
import {
  artistDisplayName,
  discoverSets,
  formatTime,
  resolveFestivalTimeZone,
  topPickedGenres,
} from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useNow } from '../hooks/useNow';

interface Props {
  hPad: number;
  /** True while a search, stage or genre filter is on, or after the festival. */
  hidden: boolean;
}

/** "More like your picks": unpicked sets from the genres the user picks most. */
export default function DiscoverRow({ hPad, hidden }: Props) {
  const styles = useStyles();
  const router = useRouter();
  const nowMs = useNow();
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const profile = useFestivalDataStore((s) => s.currentProfile);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const days = useFestivalDataStore((s) => s.days);

  if (hidden || !profile) return null;
  const picks = profile.picks;
  const genres = topPickedGenres(sets, picks);
  if (genres.length === 0) return null;
  const found = discoverSets({ sets, picks, genres, days, timeZone: resolveFestivalTimeZone(festival) ?? null, nowMs });
  if (found.length === 0) return null;

  const when = (set: FestivalSet): string => {
    const day = typeof set.dayIndex === 'number' ? days[set.dayIndex] : undefined;
    return [day?.label ?? day?.date, set.startTime ? formatTime(set.startTime) : 'Time TBA'].filter(Boolean).join(' · ');
  };

  return (
    <View style={styles.wrap}>
      <View style={{ paddingHorizontal: hPad }}>
        <Text style={styles.heading} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {DISCOVER_COPY.row.heading}
        </Text>
        <Text style={styles.sub} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {DISCOVER_COPY.row.sub(genres)}
        </Text>
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={found}
        keyExtractor={(s) => s.id}
        contentContainerStyle={[styles.list, { paddingHorizontal: hPad }]}
        renderItem={({ item }) => {
          const stage = stages.find((st) => st.id === item.stageId)?.name;
          const name = artistDisplayName(item, festival?.b2bSeparator);
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/set/${item.id}`)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={[name, when(item), stage].filter(Boolean).join(', ')}
            >
              <Text style={styles.artist} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {name}
              </Text>
              <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {when(item)}
              </Text>
              {stage ? (
                <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {stage}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { marginTop: t.spacing[3], gap: t.spacing[2] },
  heading: { ...typeStyle('title'), color: t.colors.text.primary },
  sub: { ...typeStyle('caption'), color: t.colors.text.muted },
  list: { gap: t.spacing[3] },
  card: {
    width: 190,
    minHeight: 44,
    gap: t.spacing[1],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  artist: { ...typeStyle('body', 600), color: t.colors.text.primary },
  meta: { ...typeStyle('caption'), color: t.colors.text.secondary },
}));
