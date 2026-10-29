import React from 'react';
import { artistDisplayName } from '@festie/shared/utils';
import { PICK_COLOR, toMin, fmtShort } from './gridUtils';
import type { GridBounds, HourMark } from './gridUtils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import PriorityIcon from '../ui/PriorityIcon';

interface GridStageColumnProps {
  stageId: string;
  stageSets: FestivalSet[];
  stageColor: string | undefined;
  stageName: string | undefined;
  hours: HourMark[];
  bounds: GridBounds;
  totalH: number;
  pxPerMin: number;
  b2bSeparator?: string;
  minColWidth?: string;
  getMyPick: (setId: string) => Priority | null | undefined;
  /**
   * How many OTHER crew members picked a set (M1 crew-overlap). Optional so the
   * column degrades gracefully when overlap data isn't wired (e.g. exports).
   */
  getOverlapCount?: (setId: string) => number;
  onSetClick: (set: FestivalSet | null) => void;
}

function GridStageColumn({
  stageId,
  stageSets,
  stageColor,
  stageName,
  hours,
  bounds,
  totalH,
  pxPerMin,
  minColWidth = '110px',
  b2bSeparator,
  getMyPick,
  getOverlapCount,
  onSetClick,
}: GridStageColumnProps) {
  return (
    <div
      className="fk-grid__col relative flex-1 border-l border-border"
      role="row"
      aria-label={stageName}
      style={{ height: totalH, minWidth: minColWidth, '--stage-c': stageColor } as React.CSSProperties}
      data-grid-col
    >
      {hours.map(({ m, px }) => (
        <div key={m} className="absolute left-0 right-0 h-px bg-border-light pointer-events-none" style={{ top: px }} />
      ))}
      {hours.slice(0, -1).map(({ m, px }) => (
        <div
          key={`h-${m}`}
          className="absolute left-0 right-0 h-px bg-border pointer-events-none"
          style={{ top: px + 30 * pxPerMin }}
        />
      ))}

      {stageSets.map((set) => {
        const a = toMin(set.startTime!);
        let b = toMin(set.endTime!);
        if (b <= a) b += 1440;
        const top = (a - bounds.lo) * pxPerMin;
        // WCAG 2.5.5 -- tap targets should be >= 44px. A 15-min set at
        // PX_PER_MIN=1.6 is only 24px, so bump to 44.
        const height = Math.max((b - a) * pxPerMin, 44);
        const pick = getMyPick(set.id);
        const pc = pick ? PICK_COLOR[pick] : stageColor;
        const dn = artistDisplayName(set, b2bSeparator);
        const overlap = getOverlapCount?.(set.id) ?? 0;
        const overlapLabel = overlap > 0 ? `, ${overlap} crew ${overlap === 1 ? 'member' : 'members'} going` : '';

        return (
          <button
            key={set.id}
            role="gridcell"
            className={cn(
              'fk-grid__set absolute left-1 right-1 rounded-md border py-[5px] px-[7px] pb-1',
              'cursor-pointer overflow-hidden flex flex-col gap-0.5 text-left',
              'transition-[filter,transform] duration-[120ms] ease-[ease]',
              'hover:[@media(hover:hover)]:brightness-[1.3] hover:[@media(hover:hover)]:scale-x-[1.02] hover:[@media(hover:hover)]:z-[4]',
              'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-1 focus-visible:z-5',
              pick && 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--set-c)_40%,transparent)]',
            )}
            style={
              {
                top,
                height,
                '--set-c': pc,
                // Stage identity = a full subtle stage-colour border + tint (the
                // old left-stripe was an AI tell); picked sets read brighter.
                background: pick ? `color-mix(in srgb, ${pc} 28%, var(--color-bg-primary))` : `color-mix(in srgb, ${pc} 14%, var(--color-bg-primary))`,
                borderColor: `color-mix(in srgb, ${pc} ${pick ? '55' : '38'}%, transparent)`,
              } as React.CSSProperties
            }
            onClick={() => onSetClick(set)}
            aria-label={`${dn} at ${stageName || stageId}, ${fmtShort(set.startTime!)} to ${fmtShort(set.endTime!)}${pick ? ', ' + pick : ''}${overlapLabel}`}
            data-grid-set
          >
            {pick && (
              <span
                className="absolute top-[3px] right-[5px] text-[length:var(--font-size-12)] leading-none pointer-events-none drop-shadow-[0_0_2px_rgba(0,0,0,0.45)]"
                style={{ color: pc }}
                aria-hidden="true"
              >
                <PriorityIcon priority={pick as Priority} filled className="w-3 h-3" />
              </span>
            )}
            {/* Two-line name when the block is tall enough to also keep the time row. */}
            <span
              className={cn(
                'text-[length:var(--font-size-12)] font-semibold text-text-primary leading-[1.25] overflow-hidden break-words [overflow-wrap:anywhere] [-webkit-box-orient:vertical] [display:-webkit-box]',
                height >= 64 ? '[-webkit-line-clamp:2]' : '[-webkit-line-clamp:1]',
              )}
              title={dn}
            >
              {dn}
            </span>
            {/* Time always shows (blocks are >= 44px); wraps between start and end, never clips the end time. */}
            <span className="flex flex-wrap gap-x-0.5 text-[length:var(--font-size-12)] text-text-secondary shrink-0 leading-[var(--line-height-tight)] tabular-nums">
              <span className="whitespace-nowrap">{fmtShort(set.startTime!)}–</span>
              <span className="whitespace-nowrap">{fmtShort(set.endTime!)}</span>
            </span>
            {overlap > 0 && (
              // Compact crew-overlap indicator: a people glyph + count pinned to
              // the cell's bottom-right. aria-hidden — the count is already in
              // the gridcell's aria-label above.
              <span
                className="fk-grid__overlap absolute bottom-[3px] right-[5px] flex items-center gap-[2px] rounded-full bg-[color-mix(in_srgb,var(--color-accent-aqua)_18%,transparent)] px-1 py-px text-[length:var(--font-size-10)] font-bold leading-none text-accent-aqua pointer-events-none tabular-nums"
                aria-hidden="true"
                data-grid-overlap
              >
                <Users className="w-3 h-3" aria-hidden="true" />
                {overlap}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default React.memo(GridStageColumn);
