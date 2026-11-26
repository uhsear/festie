import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { POSTER } from '@festie/shared/tokens';
import type { WrapCard } from '@festie/shared/types';
import { RATING_IONICON } from '../../lib/ratingIcon';
import { posterFont } from '../../hooks/useTokens';
import PosterDominant from './PosterDominant';
import PosterFrame from './PosterFrame';

interface Props {
  card: WrapCard;
  festivalName: string;
  byline?: string | null;
}

const { colors: C, font: F, layout: L } = POSTER;

/** One Wrap card drawn in the shared poster frame: one dominant object, then at most five rows in a time column with a rail. Fixed-pixel artwork (see PosterFrame). */
export default function WrapCardPoster({ card, festivalName, byline }: Props) {
  const named = card.kind === 'top' || card.kind === 'memory';
  const rows = card.rows?.slice(0, L.maxRows) ?? [];
  return (
    <PosterFrame festivalName={festivalName} kicker={card.kicker} byline={byline}>
      {card.dominant ? (
        <PosterDominant value={card.dominant.value} label={named ? card.headline : card.dominant.label} sub={card.sub} />
      ) : (
        <Text allowFontScaling={false} style={s.headline} numberOfLines={3}>{card.headline}</Text>
      )}
      {rows.map((row, i) => (
        <View key={`${row.primary}-${i}`} style={s.row}>
          <View style={s.rail} />
          <Text allowFontScaling={false} style={s.time} numberOfLines={1}>
            {row.time ?? String(i + 1).padStart(2, '0')}
          </Text>
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
      {card.quote ? (
        <View>
          <Text allowFontScaling={false} style={s.quote}>{`“${card.quote.text}”`}</Text>
          <Text allowFontScaling={false} style={s.quoteBy}>{card.quote.by}</Text>
        </View>
      ) : null}
      {card.stats?.length ? (
        <View style={s.stats}>
          {card.stats.map((stat) => (
            <View key={stat.label} style={s.statCell}>
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
  headline: { ...posterFont(POSTER.weight), fontSize: F.headline, color: C.text, textAlign: 'left' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 24, height: L.rowHeight, borderBottomWidth: 1, borderBottomColor: C.rule },
  rail: { width: L.railWidth, height: L.railHeight, borderRadius: L.railWidth / 2, backgroundColor: C.rail },
  time: { ...posterFont(400), width: L.timeWidth, fontSize: F.time, color: C.text, fontVariant: ['tabular-nums'] },
  rowInfo: { flex: 1 },
  artist: { ...posterFont(POSTER.weight), fontSize: F.artist, color: C.text },
  secondary: { ...posterFont(400), fontSize: F.secondary, color: C.secondary, marginTop: 4 },
  badge: { ...posterFont(POSTER.weight), fontSize: F.kicker, color: C.accent },
  quote: { ...posterFont(400), fontStyle: 'italic', fontSize: F.quote, color: C.text, textAlign: 'left' },
  quoteBy: { ...posterFont(400), fontSize: F.secondary, color: C.secondary, marginTop: 16 },
  stats: { marginTop: 32, flexDirection: 'row', gap: 18 },
  statCell: { flex: 1, borderRadius: 20, borderWidth: 1, borderColor: C.rule, backgroundColor: C.tile, paddingVertical: 28, alignItems: 'center' },
  statValue: { ...posterFont(POSTER.weight), fontSize: F.statValue, color: C.accent, lineHeight: 64 },
  statLabel: { ...posterFont(400), fontSize: F.statLabel, color: C.secondary, marginTop: 8, letterSpacing: 2 },
});
