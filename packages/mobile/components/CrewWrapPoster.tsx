import { View, Text, StyleSheet } from 'react-native';
import { POSTER } from '@festie/shared/tokens';
import { festivalTint } from '@festie/shared/utils';
import type {
  CrewWrapOverlapPair,
  CrewWrapSeenTogether,
  CrewWrapMemberSummary,
  CrewWrapData,
} from '@festie/shared/types';
import PosterFrame from './wrap/PosterFrame';

const { colors: C, font: F } = POSTER;

// Re-export the shared types so existing importers (e.g. app/wrap.tsx) keep
// importing `CrewWrapData` from this component module unchanged.
export type { CrewWrapOverlapPair, CrewWrapSeenTogether, CrewWrapMemberSummary, CrewWrapData };

interface Props {
  crewName: string;
  festivalName: string;
  wrap: CrewWrapData;
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

/**
 * Fixed 1080x1920 (9:16) crew-recap poster on the shared PosterFrame, rendered
 * off-screen and captured to a PNG via react-native-view-shot. Literal pixel
 * sizes from POSTER; text ignores the OS font size (documented exception to the
 * typeStyle() rule). Degrades gracefully on empty crews.
 */
export default function CrewWrapPoster({ crewName, festivalName, wrap }: Props) {
  const tint = festivalTint(festivalName);
  const topOverlap = wrap.topOverlap;
  const seenTogether = wrap.setsSeenTogether.slice(0, 5);
  const statCells = [
    { label: 'CREW', value: String(wrap.memberCount) },
    { label: 'SEEN TOGETHER', value: String(wrap.setsSeenTogether.length) },
    { label: 'SPLIT', value: money(wrap.totalSplit) },
  ];

  return (
    <PosterFrame festivalName={festivalName} kicker="CREW WRAP">
      <Text allowFontScaling={false} style={s.crew} numberOfLines={2}>{crewName}</Text>
      <View style={s.superlative}>
        <Text allowFontScaling={false} style={s.superLabel}>MOST-OVERLAPPING TASTE</Text>
        <Text allowFontScaling={false} style={s.superValue} numberOfLines={1}>
          {topOverlap ? `${topOverlap.aName} + ${topOverlap.bName}` : 'Rate more sets together'}
        </Text>
        {topOverlap ? (
          <Text allowFontScaling={false} style={s.superSub} numberOfLines={1}>
            {topOverlap.shared} shared favourite{topOverlap.shared === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>

      <View style={s.superlative}>
        <Text allowFontScaling={false} style={s.superLabel}>BIGGEST SPENDER</Text>
        <Text allowFontScaling={false} style={s.superValue} numberOfLines={1}>
          {wrap.biggestSpender ? wrap.biggestSpender.name : 'No expenses yet'}
        </Text>
        {wrap.biggestSpender ? <Text allowFontScaling={false} style={s.superSub}>fronted {money(wrap.biggestSpender.amount)}</Text> : null}
      </View>

      <View>
        <Text allowFontScaling={false} style={s.superLabel}>SETS YOU SAW TOGETHER</Text>
        {seenTogether.length > 0 ? (
          seenTogether.map((set) => (
            <View key={set.setId} style={[s.seenRow, { borderBottomColor: tint.faint }]}>
              <Text allowFontScaling={false} style={s.seenArtist} numberOfLines={1}>
                {set.artist || set.setId}
              </Text>
              <Text allowFontScaling={false} style={s.seenCount}>{set.count} loved it</Text>
            </View>
          ))
        ) : (
          <Text allowFontScaling={false} style={s.empty}>No sets two of you both rated 4 or higher — yet.</Text>
        )}
      </View>

      <View style={s.statsGrid}>
        {statCells.map((cell) => (
          <View key={cell.label} style={[s.statCell, { backgroundColor: tint.pale, borderColor: tint.faint }]}>
            <Text allowFontScaling={false} style={s.statValue}>{cell.value}</Text>
            <Text allowFontScaling={false} style={s.statLabel}>{cell.label}</Text>
          </View>
        ))}
      </View>
    </PosterFrame>
  );
}

const s = StyleSheet.create({
  crew: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: F.headline, color: C.text, textAlign: 'left', marginBottom: 32 },
  superlative: { marginBottom: 32 },
  superLabel: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: F.statLabel, letterSpacing: 4, color: C.secondary, marginBottom: 10 },
  superValue: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: F.artist, color: C.text },
  superSub: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: F.secondary, color: C.secondary, marginTop: 4 },
  seenRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18, borderBottomWidth: 1 },
  seenArtist: { fontFamily: 'SpaceGrotesk_700Bold', flex: 1, fontSize: F.artist, color: C.text },
  seenCount: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: F.secondary, color: C.accent },
  empty: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: F.secondary, color: C.secondary, marginTop: 8 },
  statsGrid: { marginTop: 40, flexDirection: 'row', gap: 18 },
  statCell: { flex: 1, borderRadius: 20, borderWidth: 1, paddingVertical: 28, alignItems: 'center' },
  statValue: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: F.statValue, color: C.accent, lineHeight: 64 },
  statLabel: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: F.statLabel, color: C.secondary, marginTop: 8, letterSpacing: 2, textAlign: 'center' },
});
