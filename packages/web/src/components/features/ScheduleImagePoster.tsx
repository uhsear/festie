import { SCHEDULE_IMAGE_LAYOUT, SCHEDULE_POSTER_METRICS as M } from '@festie/shared/utils';
import type { ScheduleImageFormat, ScheduleImageModel } from '@festie/shared/utils';
import { PRIORITY_LABEL } from '@festie/shared/constants';
import type { Priority } from '@festie/shared/types';

/**
 * Literal hex only: the poster is captured to a PNG by html-to-image, where CSS custom
 * properties do not resolve reliably (same reason as WrapPoster).
 */
const COLORS = { bg: '#080810', text: '#eaeaf2', muted: '#9999bb' } as const;
const PRIORITY_COLOR: Record<Priority, string> = { must: '#ff3366', 'want-to-see': '#ffaa00', maybe: '#9999bb' };
const GLOW = 0.3;
const BG_IMAGE =
  `radial-gradient(60% 45% at 50% 0%, rgba(255, 51, 102, ${GLOW}), transparent 60%), ` +
  `radial-gradient(60% 45% at 50% 100%, rgba(0, 232, 208, ${GLOW}), transparent 60%)`;
const ONE_LINE = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

/** Layout numbers come from SCHEDULE_POSTER_METRICS, shared with the mobile poster. */
export default function ScheduleImagePoster({
  model,
  format,
}: {
  model: ScheduleImageModel;
  format: ScheduleImageFormat;
}) {
  const { width, height, topReserve, bottomReserve, rowHeight } = SCHEDULE_IMAGE_LAYOUT[format];
  const k = rowHeight / M.row.base;
  const r = (n: number) => Math.round(n * k);
  return (
    <div
      style={{
        width,
        height,
        boxSizing: 'border-box',
        padding: `${topReserve || M.padY}px ${M.padX}px ${bottomReserve || M.padY}px`,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: COLORS.bg,
        backgroundImage: BG_IMAGE,
        color: COLORS.text,
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div style={{ fontSize: M.titleSize, lineHeight: `${M.titleLine}px`, fontWeight: 700, ...ONE_LINE }}>
        {model.festivalName}
      </div>
      <div
        style={{
          fontSize: M.daySize,
          lineHeight: `${M.dayLine}px`,
          color: COLORS.muted,
          marginTop: M.dayGapTop,
          marginBottom: M.dayGapBottom,
          ...ONE_LINE,
        }}
      >
        {model.dayLabel}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {model.rows.map((row) => (
          <div
            key={row.setId}
            style={{ height: rowHeight, flexShrink: 0, display: 'flex', alignItems: 'center', gap: r(M.row.gap) }}
          >
            <div
              style={{
                width: r(M.row.barWidth),
                height: r(M.row.barHeight),
                borderRadius: r(M.row.barWidth) / 2,
                backgroundColor: row.stageColor ?? COLORS.muted,
                flexShrink: 0,
              }}
            />
            <div
              style={{
                fontSize: r(M.row.timeSize),
                fontVariantNumeric: 'tabular-nums',
                width: r(M.row.timeWidth),
                flexShrink: 0,
                ...ONE_LINE,
              }}
            >
              {row.time}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: r(M.row.artistSize),
                  lineHeight: `${r(M.row.artistLine)}px`,
                  fontWeight: 700,
                  ...ONE_LINE,
                }}
              >
                {row.artist}
              </div>
              <div
                style={{
                  fontSize: r(M.row.stageSize),
                  lineHeight: `${r(M.row.stageLine)}px`,
                  color: COLORS.muted,
                  ...ONE_LINE,
                }}
              >
                {row.stage}
              </div>
            </div>
            <div
              style={{
                fontSize: r(M.row.prioritySize),
                fontWeight: 700,
                color: PRIORITY_COLOR[row.priority],
                flexShrink: 0,
              }}
            >
              {PRIORITY_LABEL[row.priority]}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          fontSize: M.footerSize,
          lineHeight: `${M.footerLine}px`,
          color: COLORS.muted,
          marginTop: M.footerGapTop,
          ...ONE_LINE,
        }}
      >
        {model.footer}
      </div>
    </div>
  );
}
