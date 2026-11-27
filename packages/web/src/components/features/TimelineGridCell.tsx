import React from 'react';
import { FestivalSet, Priority, Festival } from '@festie/shared/types';
import { fmtShort, artistDisplayName, type ClashMark, type GridCrewAvatars } from '@festie/shared/utils';
import { clashMinutes } from '@festie/shared/constants';
import { staggerDelay } from '@festie/shared/tokens';
import { Users } from 'lucide-react';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { cn } from '../../lib/utils';
import PriorityIcon from '../ui/PriorityIcon';
import ClashHatch from '../ui/ClashHatch';
import Avatar from '../ui/Avatar';
import ArtistName from './ArtistName';

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
  /** Crew-scoped members who picked this set (undefined when none). */
  crew: GridCrewAvatars | undefined;
  clash?: ClashMark;
  compact: boolean;
  tabbable: boolean;
  /** Arrow/Home/End key pressed on one of this cell's buttons. */
  onNavKey: (e: React.KeyboardEvent<HTMLElement>, setId: string) => void;
  /** The cell took focus or a click: it becomes the roving tab stop. */
  onActivate: (setId: string) => void;
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
  crew,
  clash,
  compact,
  tabbable,
  onNavKey,
  onActivate,
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
  const tabIndex = tabbable ? 0 : -1;

  return (
    <div
      key={set.id}
      className={cn(
        // Margins inset the block 2px per side; relative left + right only shifted it 2px past its column.
        'relative top-px mx-0.5 self-start',
        // Set block base
        'px-2 py-1 rounded-sm',
        'overflow-hidden',
        'flex flex-col justify-center',
        'z-[2] opacity-[0.88]',
        // Press & hover feedback
        'transition-[scale,box-shadow] duration-(--duration-med)',
        'ease-out',
        'press-scale',
        'hover:opacity-100 hover:shadow-[0_2px_10px_rgba(0,0,0,0.28)]',
        // Enter animation via data-day attribute on parent grid. No will-change:
        // it kept ~100 compositor layers alive after the 260ms animation ended.
        // content-visibility skips style/layout/paint for blocks scrolled out of
        // view; the grid area, not the content, sizes the block.
        '[content-visibility:auto]',
        'animate-[timeline-set-enter_var(--duration-slow)_var(--ease-out)_both]',
        '[animation-delay:var(--tl-stagger,0ms)]',
        'motion-reduce:!animate-none motion-reduce:!transition-none',
        // Priority variants
        myPick === 'must' && 'shadow-[inset_0_0_24px_rgba(var(--accent-coral-rgb),0.12)]',
        myPick === 'want-to-see' && 'shadow-[inset_0_0_24px_var(--color-aqua-a12)]',
        myPick === 'maybe' && 'shadow-[inset_0_0_24px_var(--color-amber-a12)]',
      )}
      style={
        {
          gridRow: `${rowStart + 2} / ${rowEnd + 2}`,
          marginTop: `${(topSlot - rowStart) * rowHeight}px`,
          height: `${Math.max(1, blockPx - 2)}px`,
          gridColumn: columnIndex + 2,
          background: `color-mix(in srgb, ${stageColor} 12%, transparent)`,
          '--tl-stagger': `${staggerDelay(columnIndex)}ms`,
        } as React.CSSProperties
      }
      data-set-id={set.id}
      onFocus={() => onActivate(set.id)}
      data-short={isShort ? '1' : '0'}
    >
      {/* One clash shape: a hatch bar over each overlapping part, plus one minutes numeral */}
      {clash?.segments.map((seg) => (
        <ClashHatch
          key={`${seg.from}-${seg.to}`}
          className="absolute left-0 w-1.5 z-[1]"
          style={{ top: `${seg.from * 100}%`, height: `${(seg.to - seg.from) * 100}%` }}
        />
      ))}
      {clash && (
        <span
          data-clash-minutes
          className="absolute top-0.5 right-1 z-[2] pointer-events-none text-[length:var(--font-size-10)] font-bold leading-none tabular-nums text-[var(--color-clash)]"
          aria-hidden="true"
        >
          {clashMinutes(clash.overlapMin)}
        </span>
      )}

      {/* Open-detail control: a real button that fills the cell, so the artist name and the pick buttons
          are siblings of it, not nested inside it. Its name is the sr-only text. */}
      <button
        type="button"
        className={cn(
          'absolute inset-0 cursor-pointer border-0 bg-transparent p-0 m-0 text-left',
          'focus-visible:outline-2 focus-visible:outline-[var(--color-accent-aqua)] focus-visible:outline-offset-1',
        )}
        onClick={() => {
          // Safari and Firefox on macOS do not focus a button on click, so onFocus alone misses it.
          onActivate(set.id);
          onSetClick(set);
        }}
        onKeyDown={(e) => onNavKey(e, set.id)}
        tabIndex={tabIndex}
        // The numeral above is pointer-events-none, so hovering it lands here and shows this tooltip.
        title={clash?.text}
        data-open
      >
        <span className="sr-only">
          {`${dn}, ${fmtShort(set.startTime!)} to ${fmtShort(set.endTime!)}, ${stageName}${myPick ? `, priority: ${myPick}` : ''}${
            crew
              ? `, ${crew.label}${crew.shown.length ? `: ${crew.shown.map((o) => `${o.name} (${o.priority})`).join(', ')}` : ''}${crew.overflow ? `, and ${crew.overflow} more` : ''}`
              : ''
          }${clash ? `, ${clash.text}` : ''}`}
        </span>
      </button>
      <div className="relative flex min-h-0 w-full flex-1 flex-col justify-center pointer-events-none">
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
          {compact || isShort ? (
            // A short or compact tile is mostly name. The cell button is its only target; the name opens from the set sheet.
            dn
          ) : (
            <ArtistName
              set={set}
              separator={festival?.b2bSeparator}
              slop={false}
              tabIndex={tabIndex}
              onKeyDown={(e) => onNavKey(e, set.id)}
              onFocus={() => onActivate(set.id)}
            />
          )}
        </span>
        {/* Time label: compact format so the end time fits; wraps between start and end, never clips. */}
        <span
          className={cn(
            'mt-px flex flex-wrap gap-x-0.5 tabular-nums text-[length:var(--font-size-12)] leading-[1.15]',
            'text-[var(--color-text-secondary)]',
            isShort && 'sr-only',
          )}
          aria-hidden="true"
        >
          <span className="whitespace-nowrap">{fmtShort(set.startTime!)}&ndash;</span>
          <span className="whitespace-nowrap">{fmtShort(set.endTime!)}</span>
        </span>
      </div>

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
                  'transition-[color,border-color,background-color] duration-(--duration-slow) ease-(--ease-standard)',
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
                onKeyDown={(e) => onNavKey(e, set.id)}
                tabIndex={tabIndex}
                aria-pressed={active ? 'true' : 'false'}
                aria-label={`${pickLabel(p)}: ${dn}`}
                title={pickLabel(p)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onActivate(set.id);
                  onSavePick(set.id, active ? null : p);
                }}
              >
                <PriorityIcon priority={p} className="w-4 h-4" filled={active} />
              </button>
            );
          })}
        </div>
      )}

      {/* Compact cells have no pick buttons: show the pick as an icon (picking happens in the set sheet) */}
      {compact && myPick && (
        <span className={cn('absolute top-[3px] pointer-events-none', clash ? 'right-[30px]' : 'right-[5px]')} aria-hidden="true">
          <PriorityIcon priority={myPick} filled className={cn('w-4 h-4', PICK_ICON_COLOR[myPick])} />
        </span>
      )}

      {/* Count marker: people glyph plus count, on compact cells and when there is no active crew (no avatars to draw) */}
      {crew && (compact || crew.shown.length === 0) && (
        <span
          className="absolute bottom-[3px] right-[5px] flex items-center gap-[2px] rounded-full bg-[color-mix(in_srgb,var(--color-accent-aqua)_18%,transparent)] px-1 py-px text-[length:var(--font-size-10)] font-bold leading-none text-accent-aqua pointer-events-none tabular-nums"
          aria-hidden="true"
        >
          <Users className="w-4 h-4" aria-hidden="true" />
          {crew.total}
        </span>
      )}

      {/* Crew avatars (the shared Avatar, up to 3, then +N). Pointer-transparent, so a tap opens the set like the rest of the tile; names are in the button's sr-only text */}
      {!compact && crew && crew.shown.length > 0 && (
        <div className="absolute top-[3px] right-[3px] flex items-center pointer-events-none" aria-hidden="true">
          {crew.shown.map((o, i) => (
            <Avatar
              key={o.key}
              name={o.name}
              image={o.avatarUrl ?? undefined}
              size="xxs"
              className={cn('ring-[1.5px] ring-[var(--color-bg-primary)] rounded-full', i > 0 && '-ml-1')}
            />
          ))}
          {crew.overflow > 0 && (
            <span className="ml-0.5 text-[length:var(--font-size-10)] font-bold text-[var(--color-text-secondary)] tabular-nums">
              +{crew.overflow}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(TimelineGridCell);
