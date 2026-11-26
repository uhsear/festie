import { View, Text, StyleSheet } from 'react-native';
import { POSTER } from '@festie/shared/tokens';
import { posterFont } from '../../hooks/useTokens';

const { colors: C, font: F, layout: L } = POSTER;

/** The one dominant typographic object on a share poster: a short value at POSTER.dominantSize and its label. Mirrors web PosterDominant. */
export default function PosterDominant({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <View style={s.block}>
      <Text allowFontScaling={false} style={s.value} numberOfLines={1}>{value}</Text>
      <Text allowFontScaling={false} style={s.label} numberOfLines={1}>{label}</Text>
      {sub ? <Text allowFontScaling={false} style={s.sub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  block: { height: L.dominantBlock },
  value: {
    ...posterFont(POSTER.weight, true),
    height: L.dominantHeight,
    fontSize: POSTER.dominantSize,
    lineHeight: L.dominantHeight,
    color: C.text,
  },
  label: { ...posterFont(POSTER.weight, true), fontSize: F.headline, lineHeight: Math.round(F.headline * 1.1), color: C.accent },
  sub: { ...posterFont(400), fontSize: F.secondary, color: C.secondary, marginTop: 8 },
});
