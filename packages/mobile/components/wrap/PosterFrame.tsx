import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { POSTER } from '@festie/shared/tokens';
import { festivalTint } from '@festie/shared/utils';

interface Props {
  festivalName: string;
  kicker: string;
  byline?: string | null;
  children: ReactNode;
}

const { width: W, height: H, padding, colors: C, font: F } = POSTER;

/**
 * Shared 1080x1920 share-poster frame (header, centred body, footer) over the
 * festival tint with two radial glows. Mirrors web PosterFrame.
 * Fixed-pixel artwork: every Text turns off font scaling, the documented
 * exception to the typeStyle() rule, so the capture is the same at any OS font size.
 */
export default function PosterFrame({ festivalName, kicker, byline, children }: Props) {
  const tint = festivalTint(festivalName);
  return (
    <View style={[s.poster, { backgroundColor: tint.bg }]}>
      <Svg width={W} height={H} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="glowTop" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={tint.active} stopOpacity={POSTER.glowAlpha} />
            <Stop offset="0.6" stopColor={tint.active} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="glowBottom" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={C.glowBottom} stopOpacity={POSTER.glowAlpha} />
            <Stop offset="0.6" stopColor={C.glowBottom} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={W / 2} cy={0} rx={W * 0.6} ry={H * 0.45} fill="url(#glowTop)" />
        <Ellipse cx={W / 2} cy={H} rx={W * 0.6} ry={H * 0.45} fill="url(#glowBottom)" />
      </Svg>
      <View style={s.header}>
        <Text allowFontScaling={false} style={s.wordmark}>FESTIE</Text>
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
  poster: { width: W, height: H, padding, flexDirection: 'column', overflow: 'hidden' },
  header: { alignItems: 'center' },
  wordmark: {
    fontFamily: 'ClashDisplay-Bold',
    fontSize: F.wordmark,
    letterSpacing: 8,
    color: C.wordmark,
    lineHeight: 104,
  },
  kicker: {
    fontFamily: 'SpaceGrotesk_400Regular',
    fontSize: F.kicker,
    color: C.secondary,
    marginTop: 16,
    letterSpacing: 3,
  },
  festival: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: F.festival,
    color: C.text,
    marginTop: 18,
    textAlign: 'center',
  },
  byline: {
    fontFamily: 'SpaceGrotesk_400Regular',
    fontSize: F.byline,
    color: C.secondary,
    marginTop: 8,
    textAlign: 'center',
  },
  body: { flex: 1, justifyContent: 'center' },
  footer: {
    fontFamily: 'SpaceGrotesk_400Regular',
    textAlign: 'center',
    fontSize: F.footer,
    color: C.secondary,
    letterSpacing: 6,
  },
});
