import { View, Text, StyleSheet } from 'react-native';
import { POSTER } from '@festie/shared/tokens';
import { crewPosterContent } from '@festie/shared/utils';
import { posterFont } from '../hooks/useTokens';
import type {
  CrewWrapOverlapPair,
  CrewWrapSeenTogether,
  CrewWrapMemberSummary,
  CrewWrapData,
} from '@festie/shared/types';
import PosterDominant from './wrap/PosterDominant';
import PosterFrame from './wrap/PosterFrame';

const { colors: C, font: F } = POSTER;

// Re-export the shared types so existing importers (e.g. app/wrap.tsx) keep
// importing `CrewWrapData` from this component module unchanged.
export type { CrewWrapOverlapPair, CrewWrapSeenTogether, CrewWrapMemberSummary, CrewWrapData };

interface Props {
  crewName: string;
  festivalName: string;
  wrap: CrewWrapData;
  showMoney: boolean;
}

/**
 * Fixed 1080x1920 (9:16) crew-recap poster on the shared PosterFrame, rendered
 * off-screen and captured to a PNG via react-native-view-shot. Literal pixel
 * sizes from POSTER; text ignores the OS font size (documented exception to the
 * typeStyle() rule). Degrades gracefully on empty crews.
 */
export default function CrewWrapPoster({ crewName, festivalName, wrap, showMoney }: Props) {
  const topOverlap = wrap.topOverlap;
  const { dominant, spotlight, stats, seenTogether } = crewPosterContent(wrap, { showMoney });
  const statCells = stats.map((cell) => ({ label: cell.label.toUpperCase(), value: cell.value }));

  return (
    <PosterFrame festivalName={festivalName} kicker="CREW WRAP">
      <PosterDominant value={dominant.value} label={dominant.label} sub={crewName} />
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
        <Text allowFontScaling={false} style={s.superLabel}>{spotlight.label.toUpperCase()}</Text>
        <Text allowFontScaling={false} style={s.superValue} numberOfLines={1}>
          {spotlight.value}
        </Text>
        {spotlight.sub ? <Text allowFontScaling={false} style={s.superSub}>{spotlight.sub}</Text> : null}
      </View>

      <View>
        <Text allowFontScaling={false} style={s.superLabel}>SETS YOU SAW TOGETHER</Text>
        {seenTogether.length > 0 ? (
          seenTogether.map((set) => (
            <View key={set.setId} style={[s.seenRow, { borderBottomColor: C.rule }]}>
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
          <View key={cell.label} style={[s.statCell, { backgroundColor: C.tile, borderColor: C.rule }]}>
            <Text allowFontScaling={false} style={s.statValue}>{cell.value}</Text>
            <Text allowFontScaling={false} style={s.statLabel}>{cell.label}</Text>
          </View>
        ))}
      </View>
    </PosterFrame>
  );
}

const s = StyleSheet.create({
  superlative: { marginBottom: 24 },
  superLabel: { ...posterFont(500), fontSize: F.statLabel, letterSpacing: 4, color: C.secondary, marginBottom: 10 },
  superValue: { ...posterFont(700), fontSize: F.artist, color: C.text },
  superSub: { ...posterFont(400), fontSize: F.secondary, color: C.secondary, marginTop: 4 },
  seenRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1 },
  seenArtist: { ...posterFont(700), flex: 1, fontSize: F.artist, color: C.text },
  seenCount: { ...posterFont(700), fontSize: F.secondary, color: C.accent },
  empty: { ...posterFont(400), fontSize: F.secondary, color: C.secondary, marginTop: 8 },
  statsGrid: { marginTop: 24, flexDirection: 'row', gap: 18 },
  statCell: { flex: 1, borderRadius: 20, borderWidth: 1, paddingVertical: 28, alignItems: 'center' },
  statValue: { ...posterFont(700), fontSize: F.statValue, color: C.accent, lineHeight: 64 },
  statLabel: { ...posterFont(400), fontSize: F.statLabel, color: C.secondary, marginTop: 8, letterSpacing: 2, textAlign: 'center' },
});
