import type { CSSProperties } from 'react';
import { LOCKSCREEN_TAG_SCALE } from '@festie/shared/utils';
import type {
  LockscreenGridPage,
  LockscreenListPage,
  LockscreenModel,
  LockscreenPageModel,
} from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';

const CLASH = "'Clash Display', system-ui, sans-serif";
const GROTESK = "'Space Grotesk', system-ui, sans-serif";
const GLYPH: Record<Priority, string> = { must: '★', 'want-to-see': '●', maybe: '○' };

type Px = (n: number) => string;
type Abs = (x: number, y: number, w?: number, h?: number) => CSSProperties;
interface BodyProps<T> {
  body: T;
  model: LockscreenModel;
  px: Px;
  abs: Abs;
}

const hexAlpha = (a: number) =>
  Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * One lock-screen image. Every box is absolutely positioned in `u` (1% of the image width) from the
 * shared model. Literal hex only: html-to-image does not resolve CSS custom properties reliably.
 */
export default function LockscreenPoster({ model, page }: { model: LockscreenModel; page: LockscreenPageModel }) {
  const U = model.width / 100;
  const px: Px = (n) => `${n * U}px`;
  const { palette: c, background: bg } = model;
  const abs: Abs = (x, y, w, h) => ({
    position: 'absolute',
    left: px(x),
    top: px(y),
    ...(w !== undefined && { width: px(w) }),
    ...(h !== undefined && { height: px(h) }),
  });
  const { header, footer } = page;
  const art = model.poster;
  const rule = page.poster?.rule;

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: model.width,
        height: model.height,
        backgroundColor: bg.color,
        color: c.text,
        fontFamily: GROTESK,
      }}
    >
      {bg.glow && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `radial-gradient(120% 40% at 50% ${bg.glow.cyU * U}px, ${bg.glow.color}${hexAlpha(bg.glow.alpha)}, transparent 70%)`,
          }}
        />
      )}
      {bg.sheet && (
        <div
          style={{
            ...abs(0, bg.sheet.topU, 100, model.heightU - bg.sheet.topU),
            backgroundColor: bg.sheet.color,
            borderRadius: `${px(bg.sheet.radiusU)} ${px(bg.sheet.radiusU)} 0 0`,
          }}
        />
      )}

      {art?.beams.map((b) => (
        <div
          key={b.x}
          style={{
            ...abs(b.x, b.y, b.width, b.height),
            backgroundImage: `linear-gradient(to bottom, ${b.color}00, ${b.color}${hexAlpha(0.55)})`,
            filter: `blur(${px(1.2)})`,
          }}
        />
      ))}
      {art && (
        <div
          style={{
            ...abs(art.panel.x, art.panel.y, art.panel.width, art.panel.height),
            boxSizing: 'border-box',
            backgroundColor: art.panel.fill,
            border: `${px(0.15)} solid ${art.panel.border}`,
            borderRadius: px(art.panel.radiusU),
          }}
        />
      )}

      <div
        style={{
          ...abs(model.sideU, header.y, 100 - 2 * model.sideU, header.height),
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          paddingBottom: px(1.6),
          boxSizing: 'border-box',
          borderBottom: rule ? undefined : `${px(0.15)} solid ${c.border}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: px(2.2),
            fontFamily: CLASH,
            fontWeight: 700,
            fontSize: px(header.daySizeU),
            lineHeight: 0.9,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {page.poster ? <span>{[...header.day].map((ch, n) => <span key={n} style={{ color: page.poster!.dayColors[n] }}>{ch}</span>)}</span> : header.day}
          {header.pageChip && (
            <span
              style={{
                fontFamily: GROTESK,
                fontSize: px(3.2),
                lineHeight: 1,
                padding: `${px(0.6)} ${px(1.6)}`,
                borderRadius: 999,
                backgroundColor: c.text,
                color: bg.sheet?.color ?? bg.color,
              }}
            >
              {header.pageChip}
            </span>
          )}
        </div>
        <div style={{ textAlign: 'right', fontSize: px(header.metaSizeU), lineHeight: 1.1, minWidth: 0, whiteSpace: 'nowrap' }}>
          {header.metaTop && <span style={{ color: c.text2, fontWeight: 500 }}>{header.metaTop} · </span>}
          <span style={{ color: c.text, fontWeight: 700 }}>{header.metaBottom}</span>
        </div>
      </div>

      {rule?.map((r) => (
        <div key={r.x} style={{ ...abs(r.x, r.y - r.height, r.width, r.height), backgroundColor: r.color }} />
      ))}

      {page.body.kind === 'list' ? (
        <ListBody body={page.body} model={model} px={px} abs={abs} />
      ) : (
        <GridBody body={page.body} model={model} px={px} abs={abs} />
      )}

      <div
        style={{
          ...abs(footer.x, footer.y, footer.width),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: px(1.2),
          fontSize: px(footer.sizeU),
          lineHeight: 1,
          whiteSpace: 'nowrap',
          color: c.muted,
          fontWeight: 500,
        }}
      >
        {footer.showMark && (
          <span
            aria-hidden="true"
            style={{ width: px(1.8), height: px(1.8), borderRadius: '50%', backgroundColor: c.want, flex: 'none' }}
          />
        )}
        {footer.text}
      </div>
    </div>
  );
}

function ListBody({ body, model, px, abs }: BodyProps<LockscreenListPage>) {
  const { palette: c, sideU } = model;
  const inner = 100 - 2 * sideU;
  const compact = body.tier === 'M' || body.tier === 'S';
  const { layout } = body;
  return (
    <>
      {body.rows.map((r) => (
        <div
          key={r.setId}
          style={{
            ...abs(sideU, r.y, inner, r.height),
            display: 'flex',
            alignItems: compact ? 'center' : 'flex-start',
            boxSizing: 'border-box',
            borderBottom: `${px(0.12)} solid ${c.border}`,
            paddingTop: compact ? 0 : px(1),
          }}
        >
          <div
            style={{
              width: px(layout.timeWidth),
              marginRight: px(compact ? 1.5 : 2),
              flex: 'none',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ visibility: r.timeRepeat ? 'hidden' : undefined }}>
              <span style={{ fontWeight: 700, fontSize: px(body.timeSizeU), lineHeight: 1, letterSpacing: '-0.02em' }}>
                {r.time}
              </span>
              <span style={{ fontWeight: 600, fontSize: px(body.periodSizeU), color: c.text2, marginLeft: '0.2em' }}>
                {r.period}
              </span>
            </span>
            {!compact && (
              <div style={{ fontSize: px(3), color: c.text2, fontWeight: 500, marginTop: px(0.9) }}>{r.until}</div>
            )}
          </div>
          {compact ? (
            <span
              style={{
                flex: 'none',
                width: px(layout.chipWidth),
                marginRight: px(2),
                textAlign: 'center',
                fontSize: px(body.chipSizeU),
                fontWeight: 700,
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
                textTransform: 'uppercase',
                padding: `${px(0.5)} 0`,
                borderRadius: px(1),
                backgroundColor: r.stageMark,
                color: r.ink,
              }}
            >
              {r.stageShort}
            </span>
          ) : (
            <span
              style={{
                flex: 'none',
                alignSelf: 'stretch',
                width: px(0.8),
                marginRight: px(1.6),
                borderRadius: 999,
                backgroundColor: r.stageMark,
              }}
            />
          )}
          <div style={{ flex: 'none', width: px(layout.artistWidth) }}>
            <div
              style={{
                fontFamily: CLASH,
                fontWeight: r.priority === 'must' ? 700 : r.priority === 'maybe' ? 500 : 600,
                fontSize: px(r.artistSizeU),
                lineHeight: 1.1,
                color: r.artistColor,
                whiteSpace: 'nowrap',
              }}
            >
              {r.artistLines.map((line, n) => (
                <div key={n}>
                  {line}
                  {compact && r.tag && n === r.artistLines.length - 1 && (
                    <span style={{ fontFamily: GROTESK, fontWeight: 500, fontSize: px(r.artistSizeU * LOCKSCREEN_TAG_SCALE), color: c.text2 }}>
                      {' '}
                      {r.tag}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {!compact && (
              <div
                style={{
                  fontSize: px(3),
                  fontWeight: 600,
                  color: r.stageText,
                  marginTop: px(0.7),
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {r.stage}
                {r.tag && ` · ${r.tag}`}
                {r.clash && <span style={{ color: c.clash }}> · {r.clash.label}</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: px(1.6), flex: 'none', marginLeft: 'auto' }}>
            {r.crew && (
              <span style={{ display: 'flex', alignItems: 'center', gap: px(0.4), fontSize: px(2.4), color: c.text2 }}>
                {r.crew.initials.map((ini) => (
                  <span
                    key={ini}
                    style={{
                      width: px(3.4),
                      height: px(3.4),
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: px(1.6),
                      fontWeight: 700,
                      backgroundColor: c.border,
                      color: c.text,
                    }}
                  >
                    {ini}
                  </span>
                ))}
                {r.crew.more > 0 && `+${r.crew.more}`}
                {r.crew.solo && 'solo'}
              </span>
            )}
            {r.priority && (
              <span style={{ fontSize: px(3.6), lineHeight: 1, color: r.glyphColor ?? c.text }}>
                {GLYPH[r.priority]}
              </span>
            )}
          </div>
        </div>
      ))}
      {body.clashSpans.map((s) => (
        <div key={s.y} style={{ ...abs(s.x, s.y, s.width, s.height), borderRadius: 999, backgroundColor: c.clash }} />
      ))}
      {body.divider && (
        <div
          style={{
            ...abs(sideU, body.divider.y, inner),
            borderTop: `${px(0.15)} dashed ${c.border}`,
            paddingTop: px(0.4),
            fontSize: px(2.2),
            fontWeight: 600,
            letterSpacing: '0.1em',
            color: c.muted,
          }}
        >
          {body.divider.label}
        </div>
      )}
    </>
  );
}

function GridBody({ body, model, px, abs }: BodyProps<LockscreenGridPage>) {
  const { palette: c, sideU } = model;
  return (
    <>
      {body.columns.map((col) => (
        <div
          key={col.stageId}
          style={{
            ...abs(col.x, body.headerY, col.width),
            display: 'flex',
            alignItems: 'center',
            gap: px(0.9),
            fontSize: px(body.labelSizeU),
            fontWeight: 700,
            color: col.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <i style={{ flex: 'none', width: px(1.4), height: px(1.4), borderRadius: '50%', backgroundColor: col.mark }} />
          {col.short}
        </div>
      ))}
      {body.hours.map((h) => (
        <div key={h.y}>
          <div
            style={{
              ...abs(sideU, h.y, 100 - 2 * sideU),
              borderTop: `${px(0.1)} ${h.dashed ? 'dashed' : 'solid'} ${c.border}`,
            }}
          />
          <div style={{ ...abs(sideU, h.y + 0.3), fontSize: px(body.labelSizeU), lineHeight: 1.1, fontWeight: 600, color: c.muted }}>
            {h.label}
          </div>
        </div>
      ))}
      {body.blocks.map((b) => {
        const shadow = [b.ring && `inset 0 0 0 ${px(0.4)} ${c.text}`, b.outline && `inset 0 0 0 ${px(0.3)} ${b.outline}`]
          .filter(Boolean)
          .join(', ');
        const borderL = b.picked ? 0 : 0.8;
        return (
          <div
            key={`${b.setId}-${b.carryOver ? 'c' : 'n'}`}
            style={{
              ...abs(b.x, b.y, b.width, b.height),
              boxSizing: 'border-box',
              overflow: 'hidden',
              padding: `${px(b.textPadU)} ${px(b.width - (b.textX - b.x) - b.textWidth)} ${px(b.textPadU)} ${px(b.textX - b.x - borderL)}`,
              borderRadius: px(0.8),
              ...(b.carryOver && { borderTopLeftRadius: 0, borderTopRightRadius: 0 }),
              backgroundColor: b.fill,
              borderLeft: b.picked ? undefined : `${px(0.8)} solid ${b.edge}`,
              color: b.ink,
              boxShadow: shadow || undefined,
            }}
          >
            {b.timeShown && (
              <div style={{ fontSize: px(body.labelSizeU), fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.1 }}>
                {b.priority === 'must' && '★ '}
                {b.time}
              </div>
            )}
            <div
              style={{
                fontFamily: CLASH,
                fontWeight: b.picked ? 700 : 600,
                fontSize: px(b.artistSizeU),
                lineHeight: 1.1,
                whiteSpace: 'nowrap',
              }}
            >
              {b.artistLines.map((line, n) => (
                <div key={n}>{line}</div>
              ))}
            </div>
            {b.picked && b.priority && b.priority !== 'must' && (
              <span
                style={{ position: 'absolute', top: px(0.4), right: px(0.6), fontSize: px(body.labelSizeU), lineHeight: 1, color: b.ink }}
              >
                {GLYPH[b.priority]}
              </span>
            )}
          </div>
        );
      })}
      {body.notes.length > 0 ? (
        <>
          {body.notes.map((n) => (
            <div key={n.n} style={{ ...abs(n.x, n.y, n.width), color: c.text2, fontWeight: 500, whiteSpace: 'nowrap' }}>
              {n.lines.map((line, i) => (
                <div key={i} style={{ height: px(body.noteRowU), fontSize: px(body.noteSizeU), lineHeight: 1.1 }}>
                  {line}
                </div>
              ))}
            </div>
          ))}
        </>
      ) : (
        <div
          style={{
            ...abs(body.legendX, body.legendY, body.legendWidth),
            textAlign: 'center',
            fontSize: px(body.labelSizeU),
            lineHeight: 1.1,
            color: c.text2,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {body.legend}
        </div>
      )}
    </>
  );
}
