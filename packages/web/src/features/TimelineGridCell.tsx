import React from 'react';
import { FestivalSet, Priority, Festival } from '@festie/shared/types';
import { fmtShort, artistDisplayName, type ClashMark } from '@festie/shared/utils';
import { TriangleAlert, Users } from 'lucide-react';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { cn } from '../lib/utils';
import PriorityIcon from '../components/ui/PriorityIcon';

// Crew-overlap marker fill per priority; same AA-safe pairings as the pick buttons below.
const OVERLAP_STYLE: Record<string, string> = {
  must: 'bg-[var(--color-accent-coral-strong)] text-[var(--color-text-on-accent)]',
  'want-to-see': 'bg-[var(--color-priority-want)] text-[var(--text-on-light-accent)]',
  maybe: 'bg-[var(--color-priority-maybe)] text-[var(--text-on-light-accent)]',
};
const MAX_OVERLAP_MARKERS = 3;

// Pick-icon ink per priority for the compact cell (no pick buttons there).
const PICK_ICON_COLOR: Record<string, string> = {
  must: 'text-[var(--color-accent-coral)]',
  'want-to-see': 'text-[var(--color-accent-aqua)]',
  maybe: 'text-[var(--color-accent-amber)]',
};

const PICK_BUTTONS = ['must', 'want-to-see', 'maybe'] as const;

function pickLabel(p: Priority): string {
  return PRIORITY_SYMBOLS[p].label;
}

export interface TimelineGridCellProps {
  set: FestivalSet;
  stageName: string;
  stageColor: string;
  columnIndex: number;
  topSlot: number;
  spanSlots: number;
  rowHeight: number;
  myPick: Priority | null | undefined;
  others: Array<{ profileId: string; priority: Priority; name?: string }>;
  clash?: ClashMark;
  compact: boolean;
  tabbable: boolean;
  canPick: boolean;
  festival: Festival | null;
  onSetClick: (set: FestivalSet) => void;
  onSavePick: (setId: string, priority: string | null) => void;
}

function TimelineGridCell({
  set,
  stageName,
  stageColor,
  columnIndex,
  topSlot,
  spanSlots,
  rowHeight,
  myPick,
  others,
  clash,
  compact,
  tabbable,
  canPick,
  festival,
  onSetClick,
  onSavePick,
}: TimelineGridCellProps) {
  const dn = artistDisplayName(set, festival?.b2bSeparator);
  const blockPx = Math.max(1, spanSlots * rowHeight);
  const rowStart = Math.floor(topSlot);
  const rowEnd = Math.max(rowStart + 1, Math.ceil(topSlot + spanSlots));
  const isShort = blockPx < 44;
  const hasConflictActive = !!clash;
  const tabIndex = tabbable ? 0 : -1;

  return (
    <div
      key={set.id}
      className={cn(
        'relative top-px left-0.5 right-0.5 self-start',
        // Set block base
        'px-2 py-1 rounded-sm',
        'overflow-hidden',
        'flex flex-col justify-center',
        'z-[2] opacity-[0.88]',
        // Press & hover feedback
        'transition-[transform,box-shadow] duration-150',
        'ease-out',
        'active:scale-[0.97]',
        'hover:opacity-100 hover:shadow-[0_2px_10px_rgba(0,0,0,0.28)]',
        // Enter animation via data-day attribute on parent grid. No will-change:
        // it kept ~100 compositor layers alive after the 260ms animation ended.
        // content-visibility skips style/layout/paint for blocks scrolled out of
        // view; the grid area, not the content, sizes the block.
        '[content-visibility:auto]',
        'animate-[timeline-set-enter_260ms_cubic-bezier(0.16,1,0.3,1)_both]',
        '[animation-delay:var(--tl-stagger,0ms)]',
        'motion-reduce:!animate-none motion-reduce:!transition-none',
        // Priority variants
        myPick === 'must' && 'shadow-[inset_0_0_24px_rgba(var(--accent-coral-rgb),0.12)]',
        myPick === 'want-to-see' && 'shadow-[inset_0_0_24px_var(--color-aqua-a12)]',
        myPick === 'maybe' && 'shadow-[inset_0_0_24px_var(--color-amber-a12)]',
        // Conflict indicator
        hasConflictActive && 'border-2 border-[var(--color-clash)]',
      )}
      style={
        {
          gridRow: `${rowStart + 2} / ${rowEnd + 2}`,
          marginTop: `${(topSlot - rowStart) * rowHeight}px`,
          height: `${Math.max(1, blockPx - 2)}px`,
          gridColumn: columnIndex + 2,
          background: `color-mix(in srgb, ${stageColor} 12%, transparent)`,
          '--tl-stagger': `${Math.min(columnIndex, 5) * 40}ms`,
        } as React.CSSProperties
      }
      data-set-id={set.id}
      data-short={isShort ? '1' : '0'}
    >
      {/* Clash hatching over each overlapping part of this set */}
      {clash?.segments.map((seg) => (
        <span
          key={`${seg.from}-${seg.to}`}
          className="absolute left-0 w-1.5 pointer-events-none z-[1] [background:repeating-linear-gradient(135deg,var(--color-clash)_0_2px,transparent_2px_5px)]"
          style={{ top: `${seg.from * 100}%`, height: `${(seg.to - seg.from) * 100}%` }}
          aria-hidden="true"
        />
      ))}

      {/* Clash badge */}
      {clash && (
        <span
          className={cn(
            'absolute top-0.5 right-0.5',
            'w-3.5 h-3.5 rounded-full',
            'inline-flex items-center justify-center',
            'text-[length:var(--font-size-10)] leading-none',
            'text-[var(--color-text-on-dark)]',
            'bg-[var(--color-clash)]',
            'shadow-[0_0_0_1.5px_var(--color-bg-primary)]',
            'pointer-events-none z-[2]',
          )}
          aria-hidden="true"
        >
          <TriangleAlert className="w-3 h-3" aria-hidden="true" />
        </span>
      )}

      {/* Open-detail control: a real button so the pick buttons below are not
          nested inside another interactive role. Its name is its visible text. */}
      <button
        type="button"
        className={cn(
          'flex min-h-0 w-full flex-1 flex-col justify-center text-left cursor-pointer',
          'focus-visible:outline-2 focus-visible:outline-[var(--color-accent-aqua)] focus-visible:outline-offset-1',
        )}
        onClick={() => onSetClick(set)}
        tabIndex={tabIndex}
        // The badge above is pointer-events-none, so hovering it lands here and shows this tooltip.
        title={clash?.text}
        data-open
      >
        <span
          className={cn(
            'block line-clamp-2 break-words [overflow-wrap:anywhere] [hyphens:auto] min-w-0',
            'text-[length:var(--font-size-12)] font-bold leading-[1.15] tracking-[0.1px]',
            'text-[var(--color-text-primary)]',
            '[text-shadow:0_1px_2px_rgba(0,0,0,0.55),0_0_1px_rgba(0,0,0,0.7)]',
            'in-data-[theme=daylight]:[text-shadow:none]',
            // Short blocks: single line ellipsis
            isShort && 'line-clamp-1 whitespace-nowrap text-ellipsis',
          )}
          title={dn}
        >
          {dn}
        </span>
        {/* Time label: compact format so the end time fits; wraps between start and end, never clips. */}
        <span
          className={cn(
            'mt-px flex flex-wrap gap-x-0.5 tabular-nums text-[length:var(--font-size-12)] leading-[1.15]',
            'text-[var(--color-text-secondary)]',
            isShort && 'sr-only',
          )}
        >
          <span className="whitespace-nowrap">{fmtShort(set.startTime!)}&ndash;</span>
          <span className="whitespace-nowrap">{fmtShort(set.endTime!)}</span>
        </span>
        <span className="sr-only">
          {`, ${stageName}${myPick ? `, priority: ${myPick}` : ''}${
            others.length ? `, crew: ${others.map((o) => `${o.name || 'Crew member'} (${o.priority})`).join(', ')}` : ''
          }${clash ? `, ${clash.text}` : ''}`}
        </span>
      </button>

      {/* Priority pick buttons */}
      {canPick && !compact && !isShort && blockPx >= 60 && (
        <div className="flex gap-[var(--space-1)] mt-0.5">
          {PICK_BUTTONS.map((p) => {
            const active = myPick === p;
            return (
              <button
                key={p}
                className={cn(
                  'relative',
                  'bg-[var(--color-overlay-2)] border border-[var(--color-border)]',
                  'rounded-xs',
                  'text-[var(--color-text-secondary)] cursor-pointer',
                  'text-[length:var(--font-size-12)] px-1.5 py-[3px] leading-none',
                  'transition-[color,border-color,background-color] duration-[250ms] ease-[var(--ease-standard)]',
                  'hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent-aqua)] hover:bg-[var(--color-overlay-4)]',
                  'focus-visible:outline-2 focus-visible:outline-[var(--color-accent-aqua)] focus-visible:outline-offset-1',
                  // Hit-slop pseudo-element for 44x44 tap target
                  'after:content-[""] after:absolute after:inset-[-4px]',
                  'min-[380px]:min-w-10 min-[380px]:min-h-10',
                  'min-[380px]:after:inset-[-2px]',
                  // Active priority states
                  active &&
                    p === 'must' &&
                    'bg-[var(--color-accent-coral-strong)] text-[var(--color-text-on-accent)] border-[var(--color-accent-coral-strong)] opacity-100',
                  active &&
                    p === 'want-to-see' &&
                    'bg-[var(--color-priority-want)] text-[var(--text-on-light-accent)] border-[var(--color-priority-want)] opacity-100',
                  active &&
                    p === 'maybe' &&
                    'bg-[var(--color-priority-maybe)] text-[var(--text-on-light-accent)] border-[var(--color-priority-maybe)] opacity-100',
                )}
                type="button"
                tabIndex={tabIndex}
                aria-pressed={active ? 'true' : 'false'}
                aria-label={pickLabel(p)}
                title={pickLabel(p)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSavePick(set.id, active ? null : p);
                }}
              >
                <PriorityIcon priority={p} className="w-3 h-3" filled={active} />
              </button>
            );
          })}
        </div>
      )}

      {/* Compact cells have no pick buttons: show the pick as an icon (picking happens in the set sheet) */}
      {compact && myPick && (
        <span className={cn('absolute top-[3px] pointer-events-none', clash ? 'right-[20px]' : 'right-[5px]')} aria-hidden="true">
          <PriorityIcon priority={myPick} filled className={cn('w-3 h-3', PICK_ICON_COLOR[myPick])} />
        </span>
      )}

      {/* Compact crew marker: people glyph plus count (names are in the button's sr-only text) */}
      {compact && others.length > 0 && (
        <span
          className="absolute bottom-[3px] right-[5px] flex items-center gap-[2px] rounded-full bg-[color-mix(in_srgb,var(--color-accent-aqua)_18%,transparent)] px-1 py-px text-[length:var(--font-size-10)] font-bold leading-none text-accent-aqua pointer-events-none tabular-nums"
          aria-hidden="true"
        >
          <Users className="w-3 h-3" aria-hidden="true" />
          {others.length}
        </span>
      )}

      {/* Crew overlap markers: initial on a priority-coloured disc (names are in the button's sr-only text) */}
      {!compact && others.length > 0 && (
        <div className="absolute top-[3px] right-[3px] flex gap-px pointer-events-none" aria-hidden="true">
          {others.slice(0, MAX_OVERLAP_MARKERS).map((o) => (
            <span
              key={o.profileId}
              className={cn(
                'inline-flex items-center justify-center shrink-0',
                'rounded-full font-bold leading-none',
                'w-4 h-4 text-[length:var(--font-size-10)]',
                'border-[1.5px] border-[var(--color-bg-primary)]',
                OVERLAP_STYLE[o.priority] ?? OVERLAP_STYLE.maybe,
              )}
              title={`${o.name || 'Crew member'} (${o.priority})`}
            >
              {(o.name || '?').trim().charAt(0).toUpperCase()}
            </span>
          ))}
          {others.length > MAX_OVERLAP_MARKERS && (
            <span className="inline-flex items-center text-[length:var(--font-size-10)] font-bold text-[var(--color-text-secondary)] tabular-nums">
              +{others.length - MAX_OVERLAP_MARKERS}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(TimelineGridCell);
