import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@festie/shared/tokens';
import { PRIORITY_LABEL } from '@festie/shared/constants';
import { SCHEDULE_IMAGE_LAYOUT, SCHEDULE_POSTER_METRICS as M } from '@festie/shared/utils';
import type { ScheduleImageFormat, ScheduleImageModel } from '@festie/shared/utils';

const POSTER = {
  bg: colors.bg.primary, // #080810
  text: colors.text.primary, // #eaeaf2
  muted: colors.text.secondary, // #9999bb
  priority: { must: '#ff3366', 'want-to-see': '#ffaa00', maybe: '#9999bb' },
} as const;

interface Props {
  model: ScheduleImageModel;
  format: ScheduleImageFormat;
}

/**
 * Fixed-size picks poster (story, lock screen or A4 print), rendered off-screen and
 * captured to a PNG with react-native-view-shot. The native twin of the web
 * ScheduleImagePoster: both read SCHEDULE_POSTER_METRICS, flat background instead of radial glows.
 * Fixed-pixel image: text ignores the OS font size (documented exception to the typeStyle() rule).
 */
export default function ScheduleImagePoster({ model, format }: Props) {
  const layout = SCHEDULE_IMAGE_LAYOUT[format];
  const k = layout.rowHeight / M.row.base;
  const r = (n: number) => Math.round(n * k);
  return (
    <View
      style={[
        s.poster,
        {
          width: layout.width,
          height: layout.height,
          paddingTop: layout.topReserve || M.padY,
          paddingBottom: layout.bottomReserve || M.padY,
        },
      ]}
    >
      <Text allowFontScaling={false} style={s.festival} numberOfLines={1}>
        {model.festivalName}
      </Text>
      <Text allowFontScaling={false} style={s.day} numberOfLines={1}>
        {model.dayLabel}
      </Text>
      <View style={s.rows}>
        {model.rows.map((row) => (
          <View key={row.setId} style={[s.row, { height: layout.rowHeight, gap: r(M.row.gap) }]}>
            <View
              style={{
                width: r(M.row.barWidth),
                height: r(M.row.barHeight),
                borderRadius: r(M.row.barWidth) / 2,
                backgroundColor: row.stageColor ?? colors.text.secondary,
              }}
            />
            <Text
              allowFontScaling={false}
              style={[s.time, { width: r(M.row.timeWidth), fontSize: r(M.row.timeSize) }]}
              numberOfLines={1}
            >
              {row.time}
            </Text>
            <View style={s.info}>
              <Text
                allowFontScaling={false}
                style={[s.artist, { fontSize: r(M.row.artistSize), lineHeight: r(M.row.artistLine) }]}
                numberOfLines={1}
              >
                {row.artist}
              </Text>
              <Text
                allowFontScaling={false}
                style={[s.stage, { fontSize: r(M.row.stageSize), lineHeight: r(M.row.stageLine) }]}
                numberOfLines={1}
              >
                {row.stage}
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              style={[s.priority, { fontSize: r(M.row.prioritySize), color: POSTER.priority[row.priority] }]}
              numberOfLines={1}
            >
              {PRIORITY_LABEL[row.priority]}
            </Text>
          </View>
        ))}
      </View>
      <Text allowFontScaling={false} style={s.footer} numberOfLines={1}>
        {model.footer}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  poster: {
    backgroundColor: POSTER.bg,
    paddingHorizontal: M.padX,
  },
  festival: { color: POSTER.text, fontSize: M.titleSize, lineHeight: M.titleLine, fontWeight: '700' },
  day: {
    color: POSTER.muted,
    fontSize: M.daySize,
    lineHeight: M.dayLine,
    marginTop: M.dayGapTop,
    marginBottom: M.dayGapBottom,
  },
  rows: { flex: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  time: { color: POSTER.text, fontVariant: ['tabular-nums'] },
  info: { flex: 1 },
  artist: { color: POSTER.text, fontWeight: '700' },
  stage: { color: POSTER.muted },
  priority: { fontWeight: '700' },
  footer: { color: POSTER.muted, fontSize: M.footerSize, lineHeight: M.footerLine, marginTop: M.footerGapTop },
});
