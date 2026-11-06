import { View, Text } from 'react-native';
import type { TextStyle } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LOCKSCREEN_TAG_SCALE } from '@festie/shared/utils';
import type {
  LockscreenGridBlock,
  LockscreenGridPage,
  LockscreenListPage,
  LockscreenListRow,
  LockscreenModel,
  LockscreenPalette,
} from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';

const CLASH_500 = 'ClashDisplay-Medium';
const CLASH_600 = 'ClashDisplay-Semibold';
const CLASH_700 = 'ClashDisplay-Bold';
const GROTESK_500 = 'SpaceGrotesk_500Medium';
const GROTESK_600 = 'SpaceGrotesk_600SemiBold';
const GROTESK_700 = 'SpaceGrotesk_700Bold';

const GLYPH: Record<Priority, string> = { must: '★', 'want-to-see': '●', maybe: '○' };

/** Line height 1.1 matches the model's row budget and the web renderer. */
const txt = (u: number, sizeU: number, family: string, color: string, extra?: TextStyle): TextStyle => ({
  fontSize: sizeU * u,
  lineHeight: sizeU * u * 1.1,
  fontFamily: family,
  color,
  ...extra,
});

function T(props: { style: TextStyle; children: React.ReactNode; lines?: number }) {
  return (
    <Text allowFontScaling={false} numberOfLines={props.lines} style={props.style}>
      {props.children}
    </Text>
  );
}

interface Props {
  model: LockscreenModel;
  /** Index into model.pages. */
  page: number;
  /**
   * Points per model pixel. 1 lays the image out at its pixel size in points.
   * Previews pass a small value: on Android a full-size Svg is a bitmap of
   * density x pixels and crashes with "trying to draw too large".
   * The capture copy passes 1 / PixelRatio so iOS snapshots it at the device
   * scale without exceeding its 8192 px limit.
   */
  pointScale?: number;
}

/**
 * One lock-screen wallpaper image, drawn from the shared LockscreenModel. Every
 * coordinate in the model is in u (1% of image width), so each box is positioned
 * absolutely at u * unit. Captured off-screen with react-native-view-shot at
 * device points (see pointScale). Fixed-pixel image: text ignores the OS font size.
 * Matches the web LockscreenPoster; the dark glow and Poster beams are SVG gradients.
 * shortcut: beams have no blur (web blurs them by 1.2u); add an SVG filter if the edges look hard on a device.
 */
export default function LockscreenPoster({ model, page, pointScale = 1 }: Props) {
  const u = (model.width * pointScale) / 100;
  const pm = model.pages[page];
  if (!pm) return null;
  const { palette: p, background: bg } = model;
  const W = model.width * pointScale;
  const H = model.height * pointScale;
  const side = model.sideU * u;
  const body = pm.body;
  const art = model.poster;
  const rule = pm.poster?.rule;
  const { header, footer } = pm;

  return (
    <View style={{ width: W, height: H, backgroundColor: bg.color, overflow: 'hidden' }}>
      {bg.glow || art ? (
        <Svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
          <Defs>
            {bg.glow ? (
              <RadialGradient id="glow" cx={W / 2} cy={bg.glow.cyU * u} rx={1.2 * W} ry={0.4 * H} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={bg.glow.color} stopOpacity={bg.glow.alpha} />
                <Stop offset="0.7" stopColor={bg.glow.color} stopOpacity={0} />
              </RadialGradient>
            ) : null}
            {art?.beams.map((b, i) => (
              <LinearGradient key={b.x} id={`beam${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={b.color} stopOpacity={0} />
                <Stop offset="1" stopColor={b.color} stopOpacity={0.55} />
              </LinearGradient>
            ))}
          </Defs>
          {bg.glow ? <Rect x={0} y={0} width={W} height={H} fill="url(#glow)" /> : null}
          {art?.beams.map((b, i) => (
            <Rect key={b.x} x={b.x * u} y={b.y * u} width={b.width * u} height={b.height * u} fill={`url(#beam${i})`} />
          ))}
        </Svg>
      ) : null}
      {bg.sheet ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: bg.sheet.topU * u,
            bottom: 0,
            backgroundColor: bg.sheet.color,
            borderTopLeftRadius: bg.sheet.radiusU * u,
            borderTopRightRadius: bg.sheet.radiusU * u,
          }}
        />
      ) : null}
      {art ? (
        <View
          style={{
            position: 'absolute',
            left: art.panel.x * u,
            top: art.panel.y * u,
            width: art.panel.width * u,
            height: art.panel.height * u,
            backgroundColor: art.panel.fill,
            borderColor: art.panel.border,
            borderWidth: 0.15 * u,
            borderRadius: art.panel.radiusU * u,
          }}
        />
      ) : null}

      <View
        style={{
          position: 'absolute',
          left: side,
          right: side,
          top: header.y * u,
          height: header.height * u,
          paddingBottom: 1.6 * u,
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2.2 * u }}>
          <T style={txt(u, header.daySizeU, CLASH_700, p.text, { lineHeight: header.daySizeU * u * 0.95 })} lines={1}>
            {pm.poster
              ? [...header.day].map((ch, n) => (
                  <Text key={n} style={{ color: pm.poster!.dayColors[n] }}>
                    {ch}
                  </Text>
                ))
              : header.day}
          </T>
          {header.pageChip ? (
            <View style={{ backgroundColor: p.text, borderRadius: 3 * u, paddingHorizontal: 1.6 * u, paddingVertical: 0.6 * u }}>
              <T style={txt(u, 3.2, GROTESK_700, bg.sheet?.color ?? bg.color, { lineHeight: 3.2 * u })}>{header.pageChip}</T>
            </View>
          ) : null}
        </View>
        <View style={{ flexShrink: 1 }}>
          <T style={txt(u, header.metaSizeU, GROTESK_700, p.text, { textAlign: 'right' })} lines={1}>
            {header.metaTop ? <Text style={{ fontFamily: GROTESK_500, color: p.text2 }}>{`${header.metaTop} · `}</Text> : null}
            {header.metaBottom}
          </T>
        </View>
      </View>
      {rule ? (
        rule.map((r) => (
          <View
            key={r.x}
            style={{ position: 'absolute', left: r.x * u, width: r.width * u, top: (r.y - r.height) * u, height: r.height * u, backgroundColor: r.color }}
          />
        ))
      ) : (
        <View
          style={{
            position: 'absolute',
            left: side,
            right: side,
            top: (header.y + header.height) * u,
            height: 0.15 * u,
            backgroundColor: p.border,
          }}
        />
      )}

      {body.kind === 'list' ? <ListBody body={body} u={u} side={side} p={p} /> : <GridBody body={body} u={u} side={side} p={p} />}

      <View
        style={{
          position: 'absolute',
          left: footer.x * u,
          width: footer.width * u,
          top: footer.y * u,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.2 * u,
        }}
      >
        {footer.showMark ? <View style={{ width: 1.8 * u, height: 1.8 * u, borderRadius: 0.9 * u, backgroundColor: p.want }} /> : null}
        <T style={txt(u, footer.sizeU, GROTESK_500, p.muted, { lineHeight: footer.sizeU * u })} lines={1}>
          {footer.text}
        </T>
      </View>
    </View>
  );
}

function ListBody({ body, u, side, p }: { body: LockscreenListPage; u: number; side: number; p: LockscreenPalette }) {
  return (
    <>
      {body.rows.map((row) => (
        <ListRow key={row.setId} row={row} body={body} u={u} side={side} p={p} />
      ))}
      {body.clashSpans.map((s) => (
        <View
          key={s.y}
          style={{ position: 'absolute', left: s.x * u, top: s.y * u, width: s.width * u, height: s.height * u, borderRadius: s.width * u, backgroundColor: p.clash }}
        />
      ))}
      {body.divider ? (
        <View
          style={{
            position: 'absolute',
            left: side,
            right: side,
            top: body.divider.y * u,
            paddingTop: 0.4 * u,
            borderTopWidth: 0.15 * u,
            borderStyle: 'dashed',
            borderColor: p.border,
          }}
        >
          <T style={txt(u, 2.2, GROTESK_600, p.muted, { letterSpacing: 0.22 * u })} lines={1}>
            {body.divider.label}
          </T>
        </View>
      ) : null}
    </>
  );
}

function ListRow({ row, body, u, side, p }: { row: LockscreenListRow; body: LockscreenListPage; u: number; side: number; p: LockscreenPalette }) {
  const compact = body.tier === 'M' || body.tier === 'S';
  const { layout } = body;
  const artistFont = row.priority === 'must' ? CLASH_700 : row.priority === 'maybe' ? CLASH_500 : CLASH_600;
  const last = row.artistLines.length - 1;
  return (
    <View
      style={{
        position: 'absolute',
        left: side,
        right: side,
        top: row.y * u,
        height: row.height * u,
        flexDirection: 'row',
        alignItems: compact ? 'center' : 'flex-start',
        paddingTop: compact ? 0 : 1 * u,
        borderBottomWidth: 0.12 * u,
        borderColor: p.border,
      }}
    >
      <View style={{ width: layout.timeWidth * u, marginRight: (compact ? 1.5 : 2) * u }}>
        <Text allowFontScaling={false} numberOfLines={1} style={txt(u, body.timeSizeU, GROTESK_700, p.text, { opacity: row.timeRepeat ? 0 : 1 })}>
          {row.time}
          <Text style={txt(u, body.periodSizeU, GROTESK_600, p.text2)}> {row.period}</Text>
        </Text>
        {compact ? null : (
          <T style={txt(u, 3, GROTESK_500, p.text2, { marginTop: 0.9 * u })} lines={1}>
            {row.until}
          </T>
        )}
      </View>
      {compact ? (
        <View
          style={{
            width: layout.chipWidth * u,
            marginRight: 2 * u,
            alignItems: 'center',
            backgroundColor: row.stageMark,
            borderRadius: 1 * u,
            paddingVertical: 0.5 * u,
          }}
        >
          <T style={txt(u, body.chipSizeU, GROTESK_700, row.ink, { textTransform: 'uppercase', letterSpacing: 0.04 * body.chipSizeU * u })} lines={1}>
            {row.stageShort}
          </T>
        </View>
      ) : (
        <View style={{ width: 0.8 * u, marginRight: 1.6 * u, alignSelf: 'stretch', borderRadius: 0.4 * u, backgroundColor: row.stageMark }} />
      )}
      <View style={{ width: layout.artistWidth * u }}>
        {row.artistLines.map((line, n) => (
          <Text key={n} allowFontScaling={false} numberOfLines={1} style={txt(u, row.artistSizeU, artistFont, row.artistColor)}>
            {line}
            {compact && row.tag && n === last ? (
              <Text style={{ fontFamily: GROTESK_500, fontSize: row.artistSizeU * LOCKSCREEN_TAG_SCALE * u, color: p.text2 }}>{` ${row.tag}`}</Text>
            ) : null}
          </Text>
        ))}
        {compact ? null : (
          <T style={txt(u, 3, GROTESK_600, row.stageText, { marginTop: 0.7 * u })} lines={1}>
            {row.stage}
            {row.tag ? ` · ${row.tag}` : ''}
            {row.clash ? <Text style={{ color: p.clash }}>{` · ${row.clash.label}`}</Text> : null}
          </T>
        )}
      </View>
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 1.6 * u }}>
        {row.crew ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0.4 * u }}>
            {row.crew.initials.map((ini, k) => (
              <View
                key={`${ini}-${k}`}
                style={{ width: 3.4 * u, height: 3.4 * u, borderRadius: 1.7 * u, backgroundColor: p.border, alignItems: 'center', justifyContent: 'center' }}
              >
                <T style={txt(u, 1.6, GROTESK_700, p.text)}>{ini}</T>
              </View>
            ))}
            {row.crew.more > 0 ? <T style={txt(u, 2.4, GROTESK_500, p.text2)}>{`+${row.crew.more}`}</T> : null}
            {row.crew.solo ? <T style={txt(u, 2.4, GROTESK_500, p.text2)}>solo</T> : null}
          </View>
        ) : null}
        {row.priority ? <T style={txt(u, 3.6, GROTESK_700, row.glyphColor ?? p.text, { lineHeight: 3.6 * u })}>{GLYPH[row.priority]}</T> : null}
      </View>
    </View>
  );
}

function GridBody({ body, u, side, p }: { body: LockscreenGridPage; u: number; side: number; p: LockscreenPalette }) {
  const label = body.labelSizeU;
  return (
    <>
      {body.columns.map((c) => (
        <View
          key={c.stageId}
          style={{
            position: 'absolute',
            left: c.x * u,
            width: c.width * u,
            top: body.headerY * u,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 0.9 * u,
            overflow: 'hidden',
          }}
        >
          <View style={{ width: 1.4 * u, height: 1.4 * u, borderRadius: 0.7 * u, backgroundColor: c.mark }} />
          <T style={txt(u, label, GROTESK_700, c.text)} lines={1}>
            {c.short}
          </T>
        </View>
      ))}
      {body.hours.map((h) => (
        <View key={h.y} style={{ position: 'absolute', left: side, right: side, top: h.y * u }}>
          <View style={{ borderTopWidth: 0.1 * u, borderStyle: h.dashed ? 'dashed' : 'solid', borderColor: p.border }} />
          <T style={txt(u, label, GROTESK_600, p.muted, { marginTop: 0.3 * u })}>{h.label}</T>
        </View>
      ))}
      {body.blocks.map((b) => (
        <GridBlock key={`${b.setId}-${b.carryOver ? 'c' : 'n'}`} b={b} u={u} p={p} label={label} />
      ))}
      {body.notes.length ? (
        <>
          {body.notes.map((n) => (
            <View key={n.n} style={{ position: 'absolute', left: n.x * u, top: n.y * u, width: n.width * u }}>
              {n.lines.map((line, i) => (
                <Text key={i} allowFontScaling={false} numberOfLines={1} ellipsizeMode="clip" style={txt(u, body.noteSizeU, GROTESK_500, p.text2, { height: body.noteRowU * u })}>
                  {line}
                </Text>
              ))}
            </View>
          ))}
        </>
      ) : (
        <View style={{ position: 'absolute', left: body.legendX * u, width: body.legendWidth * u, top: body.legendY * u }}>
          <T style={txt(u, label, GROTESK_500, p.text2, { textAlign: 'center' })} lines={1}>
            {body.legend}
          </T>
        </View>
      )}
    </>
  );
}

function GridBlock({ b, u, p, label }: { b: LockscreenGridBlock; u: number; p: LockscreenPalette; label: number }) {
  const must = b.priority === 'must';
  const corner = b.picked && b.priority && !must ? GLYPH[b.priority] : null;
  const ringColor = b.outline ?? (b.ring ? p.text : null);
  const ringW = ringColor ? (b.outline ? 0.3 : 0.4) : 0;
  const borderL = b.picked ? ringW : 0.8;
  return (
    <View
      style={{
        position: 'absolute',
        left: b.x * u,
        top: b.y * u,
        width: b.width * u,
        height: b.height * u,
        backgroundColor: b.fill,
        borderRadius: 0.8 * u,
        borderTopLeftRadius: b.carryOver ? 0 : 0.8 * u,
        borderTopRightRadius: b.carryOver ? 0 : 0.8 * u,
        borderWidth: ringW * u,
        borderColor: ringColor ?? undefined,
        borderLeftWidth: borderL * u,
        borderLeftColor: b.picked ? (ringColor ?? undefined) : b.edge,
        paddingTop: 0.8 * u,
        paddingBottom: 0.8 * u,
        paddingLeft: (b.textX - b.x - borderL) * u,
        paddingRight: (b.width - (b.textX - b.x) - b.textWidth - ringW) * u,
        overflow: 'hidden',
      }}
    >
      {b.timeShown ? (
        <T style={txt(u, label, GROTESK_600, b.ink)} lines={1}>
          {must ? '★ ' : ''}
          {b.time}
        </T>
      ) : null}
      {b.artistLines.map((line, n) => (
        <Text key={n} allowFontScaling={false} numberOfLines={1} ellipsizeMode="clip" style={txt(u, b.artistSizeU, b.picked ? CLASH_700 : CLASH_600, b.ink)}>
          {line}
        </Text>
      ))}
      {corner ? (
        <View style={{ position: 'absolute', top: 0.4 * u, right: 0.6 * u }}>
          <T style={txt(u, label, GROTESK_700, b.ink, { lineHeight: label * u })}>{corner}</T>
        </View>
      ) : null}
    </View>
  );
}
