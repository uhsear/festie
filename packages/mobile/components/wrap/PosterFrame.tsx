import type { ReactNode } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { POSTER } from '@festie/shared/tokens';
import { posterBand } from '@festie/shared/utils';
import { posterFont } from '../../hooks/useTokens';

interface Props {
  festivalName: string;
  kicker: string;
  byline?: string | null;
  children: ReactNode;
}

const { width: W, height: H, padding, colors: C, font: F, layout: L } = POSTER;
const MARK = require('../../assets/splash-icon.png');

/**
 * Shared 1080x1920 share-poster frame: one festival-hue band, a left-aligned header with the
 * mark, a body that starts at a fixed y, and a footer. Mirrors web PosterFrame, and both place
 * their boxes from POSTER.layout.
 * Fixed-pixel artwork: every Text turns off font scaling, the documented
 * exception to the typeStyle() rule, so the capture is the same at any OS font size.
 */
export default function PosterFrame({ festivalName, kicker, byline, children }: Props) {
  return (
    <View style={s.poster}>
      <View style={[s.band, { backgroundColor: posterBand(festivalName).colour }]} />
      <View style={s.header}>
        <View style={s.brand}>
          <Image source={MARK} style={s.mark} accessible={false} />
          <Text allowFontScaling={false} style={s.wordmark}>FESTIE</Text>
        </View>
        <Text allowFontScaling={false} style={s.kicker}>{kicker}</Text>
        <Text allowFontScaling={false} style={s.festival} numberOfLines={2}>{festivalName}</Text>
        {byline ? <Text allowFontScaling={false} style={s.byline}>{byline}</Text> : null}
      </View>
      <View style={s.body}>{children}</View>
      <Text allowFontScaling={false} style={s.footer}>FESTIE.US</Text>
    </View>
  );
}

const s = StyleSheet.create({
  poster: { width: W, height: H, backgroundColor: C.ground, overflow: 'hidden' },
  band: { position: 'absolute', top: 0, left: 0, width: W, height: POSTER.band.height },
  header: { position: 'absolute', top: L.headerTop, left: padding, width: W - 2 * padding, height: L.headerHeight },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 20, height: L.markSize },
  mark: { width: L.markSize, height: L.markSize },
  wordmark: {
    ...posterFont(POSTER.weight, true),
    fontSize: F.wordmark,
    letterSpacing: 6,
    color: C.text,
    lineHeight: F.wordmark + 8,
  },
  kicker: {
    ...posterFont(400),
    fontSize: F.kicker,
    color: C.secondary,
    marginTop: 24,
    letterSpacing: 3,
  },
  festival: {
    ...posterFont(POSTER.weight, true),
    fontSize: F.festival,
    color: C.text,
    marginTop: 12,
  },
  byline: {
    ...posterFont(400),
    fontSize: F.byline,
    color: C.secondary,
    marginTop: 8,
  },
  body: { position: 'absolute', top: L.bodyTop, left: padding, width: W - 2 * padding, bottom: padding + L.footerHeight + 24 },
  footer: {
    ...posterFont(400),
    position: 'absolute',
    left: padding,
    bottom: padding,
    height: L.footerHeight,
    fontSize: F.footer,
    color: C.secondary,
    letterSpacing: 6,
  },
});
