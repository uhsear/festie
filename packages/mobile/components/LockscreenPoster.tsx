import { View, Text } from 'react-native';
import type { TextStyle } from 'react-native';
import type {
  LockscreenGridBlock,
  LockscreenListPage,
  LockscreenListRow,
  LockscreenModel,
  LockscreenPalette,
} from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';

const CLASH_600 = 'ClashDisplay-Semibold';
const CLASH_700 = 'ClashDisplay-Bold';
const GROTESK_500 = 'SpaceGrotesk_500Medium';
const GROTESK_600 = 'SpaceGrotesk_600SemiBold';
const GROTESK_700 = 'SpaceGrotesk_700Bold';

const GLYPH: Record<Priority, string> = { must: '★', 'want-to-see': '●', maybe: '○' };
const GLYPH_COLOR = (p: LockscreenPalette): Record<Priority, string> => ({
  must: p.must,
  'want-to-see': p.want,
  maybe: p.maybe,
});

const txt = (u: number, sizeU: number, family: string, color: string, extra?: TextStyle): TextStyle => ({
  fontSize: sizeU * u,
  lineHeight: sizeU * u * 1.2,
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

/** Stepped slices stand in for a vertical gradient (no gradient module in the JS bundle). */
const BEAM_STEPS = 8;

interface Props {
  model: LockscreenModel;
  /** Index into model.pages. */
  page: number;
}

/**
 * One lock-screen wallpaper image, drawn from the shared LockscreenModel. Every
 * coordinate in the model is in u (1% of image width), so each box is positioned
 * absolutely at u * unit. Rendered off-screen at device pixels and captured with
 * react-native-view-shot. Fixed-pixel image: text ignores the OS font size.
 * shortcut: flat background, no radial glow or Festie mark (needs gradient or
 * an asset); add if the dark theme looks plain in QA.
 */
export default function LockscreenPoster({ model, page }: Props) {
  const u = model.width / 100;
  const pm = model.pages[page];
  if (!pm) return null;
  const { palette: p, background: bg } = model;
  const side = model.sideU * u;
  const body = pm.body;
  const art = model.poster;
  const rule = pm.poster?.rule;

  return (
    <View style={{ width: model.width, height: model.height, backgroundColor: bg.color, overflow: 'hidden' }}>
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

      {art?.beams.map((b) =>
        Array.from({ length: BEAM_STEPS }, (_, n) => (
          <View
            key={`${b.x}-${n}`}
            style={{
              position: 'absolute',
              left: b.x * u,
              width: b.width * u,
              top: (b.y + (b.height * n) / BEAM_STEPS) * u,
              height: (b.height / BEAM_STEPS) * u + 1,
              backgroundColor: b.color,
              opacity: (0.55 * (n + 1)) / BEAM_STEPS,
            }}
          />
        )),
      )}
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
          top: pm.header.y * u,
          height: pm.header.height * u,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1.5 * u }}>
          <T style={txt(u, pm.header.daySizeU, CLASH_700, p.text)} lines={1}>
            {pm.poster
              ? [...pm.header.day].map((ch, n) => (
                  <Text key={n} style={{ color: pm.poster!.dayColors[n] }}>
                    {ch}
                  </Text>
                ))
              : pm.header.day}
          </T>
          {pm.header.pageChip ? (
            <View
              style={{
                backgroundColor: p.text,
                borderRadius: 3 * u,
                paddingHorizontal: 1.6 * u,
                paddingVertical: 0.6 * u,
              }}
            >
              <T style={txt(u, 3.2, GROTESK_700, bg.sheet?.color ?? bg.color)}>{pm.header.pageChip}</T>
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
          <T style={txt(u, pm.header.metaSizeU, GROTESK_500, p.text2, { textAlign: 'right' })} lines={1}>{pm.header.metaTop}</T>
          <T style={txt(u, pm.header.metaSizeU, GROTESK_700, p.text, { textAlign: 'right' })} lines={1}>{pm.header.metaBottom}</T>
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
            top: (pm.header.y + pm.header.height) * u,
            height: 0.15 * u,
            backgroundColor: p.border,
          }}
        />
      )}

      {body.kind === 'list' ? (
        <>
          {body.rows.map((row) => (
            <ListRow key={row.setId} row={row} tier={body.tier} timeU={body.timeSizeU} layout={body.layout} artistU={body.artistSizeU} u={u} side={side} p={p} />
          ))}
          {body.divider ? (
            <View
              style={{
                position: 'absolute',
                left: side,
                right: side,
                top: body.divider.y * u,
                borderTopWidth: 0.15 * u,
                borderStyle: 'dashed',
                borderColor: p.border,
              }}
            >
              <T style={txt(u, 2.2, GROTESK_600, p.muted, { letterSpacing: 0.2 * u })} lines={1}>
                {body.divider.label}
              </T>
            </View>
          ) : null}
        </>
      ) : (
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
                gap: 0.8 * u,
              }}
            >
              <View style={{ width: 1.4 * u, height: 1.4 * u, borderRadius: 0.7 * u, backgroundColor: c.mark }} />
              <T style={txt(u, 2.6, GROTESK_700, c.text)} lines={1}>
                {c.short}
              </T>
            </View>
          ))}
          {body.hours.map((h) => (
            <View key={h.y} style={{ position: 'absolute', left: side, right: side, top: h.y * u }}>
              <View
                style={{
                  borderTopWidth: 0.1 * u,
                  borderStyle: h.dashed ? 'dashed' : 'solid',
                  borderColor: p.border,
                }}
              />
              <T style={txt(u, 2.4, GROTESK_600, p.muted, { marginTop: 0.2 * u })}>{h.label}</T>
            </View>
          ))}
          {body.blocks.map((b) => (
            <GridBlock key={`${b.setId}-${b.y}`} b={b} u={u} p={p} />
          ))}
          <View style={{ position: 'absolute', left: body.legendX * u, top: body.legendY * u }}>
            <T style={txt(u, 2.4, GROTESK_500, p.muted)} lines={1}>
              {body.legend}
            </T>
          </View>
        </>
      )}

      <View style={{ position: 'absolute', left: side, right: side, top: pm.footer.y * u }}>
        <T style={txt(u, 2.27, GROTESK_500, p.muted)}>{pm.footer.text}</T>
      </View>
    </View>
  );
}

function ListRow({
  row,
  tier,
  timeU,
  layout,
  artistU,
  u,
  side,
  p,
}: {
  row: LockscreenListRow;
  tier: 'XL' | 'L' | 'M';
  timeU: number;
  layout: LockscreenListPage['layout'];
  artistU: number;
  u: number;
  side: number;
  p: LockscreenPalette;
}) {
  const compact = tier === 'M';
  const periodU = tier === 'XL' ? 2.6 : tier === 'L' ? 2.4 : 2.27;
  const glyph = row.priority ? GLYPH[row.priority] : null;
  const must = row.priority === 'must';
  const artistColor = row.priority === 'maybe' ? p.text2 : p.text;
  return (
    <View
      style={{
        position: 'absolute',
        left: side,
        right: side,
        top: row.y * u,
        height: row.height * u,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 0.12 * u,
        borderColor: p.border,
      }}
    >
      {compact ? null : (
        <View
          style={{ width: 0.8 * u, marginRight: 1.6 * u, alignSelf: 'stretch', marginVertical: 0.6 * u, backgroundColor: row.stageMark }}
        />
      )}
      <View style={{ width: layout.timeWidth * u, marginRight: (compact ? 1.5 : 2) * u }}>
        <Text allowFontScaling={false} numberOfLines={1} style={txt(u, timeU, GROTESK_700, p.text)}>
          {row.time}
          <Text style={txt(u, periodU, GROTESK_700, p.text)}> {row.period}</Text>
        </Text>
        {compact ? null : <T style={txt(u, 3.0, GROTESK_500, p.muted)} lines={1}>{row.until}</T>}
      </View>
      {compact ? (
        <View
          style={{
            width: layout.chipWidth * u,
            marginRight: 2 * u,
            alignItems: 'center',
            backgroundColor: row.stageMark,
            borderRadius: 0.6 * u,
            paddingVertical: 0.5 * u,
          }}
        >
          <T style={txt(u, 2.4, GROTESK_700, row.ink, { textTransform: 'uppercase' })} lines={1}>
            {row.stageShort}
          </T>
        </View>
      ) : null}
      <View style={{ width: layout.artistWidth * u, marginRight: 'auto' }}>
        {row.artistLines.map((line, n) => (
          <Text
            key={n}
            allowFontScaling={false}
            numberOfLines={1}
            style={txt(u, artistU, must ? CLASH_700 : CLASH_600, artistColor)}
          >
            {line}
          </Text>
        ))}
        {compact ? null : (
          <T style={txt(u, 3.0, GROTESK_600, row.stageText)} lines={1}>
            {row.stage}
            {row.clash ? <Text style={{ color: p.clash }}>{`  ${row.clash.label}`}</Text> : null}
          </T>
        )}
      </View>
      {compact && row.clash ? <T style={txt(u, 2.6, GROTESK_600, p.clash)}>{row.clash.short}</T> : null}
      {row.crew ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0.6 * u }}>
          {row.crew.solo ? <T style={txt(u, 2.4, GROTESK_500, p.muted)}>solo</T> : null}
          {row.crew.initials.map((ini, k) => (
            <View
              key={`${ini}-${k}`}
              style={{
                width: 3.4 * u,
                height: 3.4 * u,
                borderRadius: 1.7 * u,
                backgroundColor: p.surface,
                borderWidth: 0.12 * u,
                borderColor: p.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <T style={txt(u, 1.6, GROTESK_700, p.text)}>{ini}</T>
            </View>
          ))}
          {row.crew.more > 0 ? <T style={txt(u, 2.4, GROTESK_600, p.muted)}>{`+${row.crew.more}`}</T> : null}
        </View>
      ) : null}
      {glyph && row.priority ? (
        <T style={txt(u, 3.6, GROTESK_700, GLYPH_COLOR(p)[row.priority])}>{glyph}</T>
      ) : null}
    </View>
  );
}

function GridBlock({ b, u, p }: { b: LockscreenGridBlock; u: number; p: LockscreenPalette }) {
  const must = b.priority === 'must';
  const corner = b.priority && !must ? GLYPH[b.priority] : null;
  const label = b.carryOver && b.carryLabel ? b.carryLabel : null;
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
        borderLeftWidth: 0.8 * u,
        borderLeftColor: b.edge,
        borderWidth: b.outline ? 0.3 * u : b.ring ? 0.4 * u : 0,
        borderColor: b.outline ?? (b.ring ? p.text : undefined),
        paddingHorizontal: 0.6 * u,
        paddingRight: 1.2 * u,
        overflow: 'hidden',
      }}
    >
      {b.textMode === 'none' ? null : label ? (
        <T style={txt(u, 2.4, GROTESK_600, b.ink)} lines={1}>
          {label}
        </T>
      ) : (
        <>
          {b.textMode === 'full' && !b.inlineTime ? (
            <T style={txt(u, 2.4, GROTESK_600, b.ink)} lines={1}>
              {must ? '★ ' : ''}
              {b.time}
            </T>
          ) : null}
          {b.artistLines.map((line, n) => (
            <Text key={n} allowFontScaling={false} numberOfLines={1} style={txt(u, b.artistSizeU, CLASH_600, b.ink)}>
              {line}
            </Text>
          ))}
        </>
      )}
      {corner && b.priority ? (
        <View style={{ position: 'absolute', top: 0, right: 0.4 * u }}>
          <T style={txt(u, 2.6, GROTESK_700, b.picked ? b.ink : GLYPH_COLOR(p)[b.priority])}>{corner}</T>
        </View>
      ) : null}
    </View>
  );
}
