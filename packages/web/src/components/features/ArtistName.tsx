import React from 'react';
// Subpath imports: route and component tests mock the @festie/shared barrels, and every artist name renders this.
import { useArtistSheetStore } from '@festie/shared/stores/artistSheetStore';
import { artistNameSegments, artistTargetFromName } from '@festie/shared/utils/artistSheet';
import type { ArtistSheetTarget } from '@festie/shared/utils/artistSheet';
import type { FestivalSet } from '@festie/shared/types';
import { cn } from '../../lib/utils';

const BUTTON_CLASS =
  'inline text-left align-baseline p-0 m-0 bg-transparent border-0 text-inherit font-[inherit] cursor-pointer ' +
  'hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua focus-visible:rounded-sm ' +
  // The 44px touch target comes from a pseudo-element, so the name keeps its text size and line layout.
  'relative pointer-events-auto';

// A name inside a small tile that is itself the open-set target must not grow a hit area that covers the tile.
const SLOP_CLASS = 'before:content-[""] before:absolute before:-inset-x-1 before:-inset-y-3';

/** One artist name as its own button. It opens the artist sheet and never triggers a clickable parent. */
export function ArtistNameButton({
  name,
  target,
  className,
  children,
  tabIndex,
  onKeyDown,
  onFocus,
  slop = true,
}: {
  name?: string;
  target?: ArtistSheetTarget;
  className?: string;
  children?: React.ReactNode;
  /** For roving-tabindex parents such as the schedule grid. */
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  /** Grow the hit area to 44px tall. Turn it off where the name shares a small tile with another target. */
  slop?: boolean;
}) {
  const open = useArtistSheetStore((s) => s.open);
  const resolved = target ?? artistTargetFromName(name ?? '');
  return (
    <button
      type="button"
      aria-label={`Open ${resolved.title}`}
      className={cn(BUTTON_CLASS, slop && SLOP_CLASS, className)}
      onClick={(e) => {
        e.stopPropagation();
        open(resolved);
      }}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        // A clickable parent (role="button" row) must not also act on this Enter or Space.
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      {children ?? resolved.title}
    </button>
  );
}

/**
 * A set's artist name where each artist opens its own sheet. A B2B set renders one button per artist with the
 * separator as plain text between them.
 */
export default function ArtistName({
  set,
  separator,
  className,
  ...buttonProps
}: {
  set: FestivalSet;
  separator?: string;
  className?: string;
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  slop?: boolean;
}) {
  const segments = artistNameSegments(set, separator);
  const sep = separator || 'b2b';
  return (
    <>
      {segments.map((seg, i) => (
        <React.Fragment key={`${seg.label}-${i}`}>
          {i > 0 && ` ${sep} `}
          <ArtistNameButton target={seg.target} className={className} {...buttonProps}>
            {seg.label}
          </ArtistNameButton>
        </React.Fragment>
      ))}
    </>
  );
}

/**
 * The open-the-row button for a row that also holds artist names. It fills a `relative` container behind the
 * content, so the name buttons are siblings of it, never nested inside another button.
 */
export function RowOpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute inset-0 w-full cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
    />
  );
}
