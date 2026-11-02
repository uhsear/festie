import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { POSTER } from '@festie/shared/tokens';
import { festivalTint } from '@festie/shared/utils';
import type { WrapCard } from '@festie/shared/types';
import { RATING_IONICON } from '../../lib/ratingIcon';
import PosterFrame from './PosterFrame';

interface Props {
  card: WrapCard;
  festivalName: string;
  byline?: string | null;
}

const { colors: C, font: F } = POSTER;

/** One Wrap card drawn in the shared poster frame. Fixed-pixel artwork (see PosterFrame). */
export default function WrapCardPoster({ card, festivalName, byline }: Props) {
  const tint = festivalTint(festivalName);
  return (
    <PosterFrame festivalName={festivalName} kicker={card.kicker} byline={byline}>
      <Text allowFontScaling={false} style={s.headline} numberOfLines={3}>{card.headline}</Text>
      {card.sub ? <Text allowFontScaling={false} style={s.sub}>{card.sub}</Text> : null}
      {card.rows?.length ? (
        <View style={s.rows}>
          {card.rows.map((row, i) => (
            <View key={`${row.primary}-${i}`} style={[s.row, { borderBottomColor: tint.faint }]}>
              <View style={s.rowInfo}>
                <Text allowFontScaling={false} style={s.artist} numberOfLines={1}>{row.primary}</Text>
                {row.secondary ? (
                  <Text allowFontScaling={false} style={s.secondary} numberOfLines={1}>{row.secondary}</Text>
                ) : null}
              </View>
              {row.badge ? (
                <Text allowFontScaling={false} style={s.badge}>{row.badge}</Text>
              ) : row.rating ? (
                <Ionicons name={RATING_IONICON[row.rating] ?? 'trophy'} size={F.statValue} color={C.accent} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {card.quote ? (
        <View style={s.quoteWrap}>
          <Text allowFontScaling={false} style={s.quote}>{`“${card.quote.text}”`}</Text>
          <Text allowFontScaling={false} style={s.quoteBy}>{card.quote.by}</Text>
        </View>
      ) : null}
      {card.stats?.length ? (
        <View style={s.stats}>
          {card.stats.map((stat) => (
            <View key={stat.label} style={[s.statCell, { backgroundColor: tint.pale, borderColor: tint.faint }]}>
              <Text allowFontScaling={false} style={s.statValue}>{stat.value}</Text>
              <Text allowFontScaling={false} style={s.statLabel}>{stat.label.toUpperCase()}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </PosterFrame>
  );
}

const s = StyleSheet.create({
  headline: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: F.headline, color: C.text, textAlign: 'left' },
  sub: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: F.secondary, color: C.secondary, marginTop: 16, textAlign: 'left' },
  rows: { marginTop: 48 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 24, borderBottomWidth: 1 },
  rowInfo: { flex: 1, paddingRight: 24 },
  artist: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: F.artist, color: C.text },
  secondary: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: F.secondary, color: C.secondary, marginTop: 4 },
  badge: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: F.kicker, color: C.accent },
  quoteWrap: { marginTop: 48 },
  quote: { fontFamily: 'SpaceGrotesk_400Regular', fontStyle: 'italic', fontSize: F.quote, color: C.text, textAlign: 'left' },
  quoteBy: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: F.secondary, color: C.secondary, marginTop: 24 },
  stats: { marginTop: 48, flexDirection: 'row', gap: 18 },
  statCell: { flex: 1, borderRadius: 20, borderWidth: 1, paddingVertical: 28, alignItems: 'center' },
  statValue: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: F.statValue, color: C.accent, lineHeight: 64 },
  statLabel: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: F.statLabel, color: C.secondary, marginTop: 8, letterSpacing: 2 },
});
