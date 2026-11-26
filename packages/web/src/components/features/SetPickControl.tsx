import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import type { Priority } from '@festie/shared/types';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import PriorityIcon from '../ui/PriorityIcon';

const PRIORITIES = ['must', 'want-to-see', 'maybe'] as const;
const PRI_KEY: Record<Priority, 'must' | 'want' | 'maybe'> = { must: 'must', 'want-to-see': 'want', maybe: 'maybe' };
// Literal class strings: Tailwind finds classes by scanning source, so they cannot be built from a key.
const ICON_TEXT = { must: 'text-priority-must', want: 'text-priority-want', maybe: 'text-priority-maybe' } as const;
const ACTIVE_CLASS = {
  // Filled coral is reserved for SOS: a must pick is a coral outline with a filled glyph.
  must: ['active-must text-text-primary border-priority-must', 'shadow-[0_0_0_1px_var(--color-coral-a3)]'],
  want: [
    'active-want bg-priority-want text-[var(--text-on-light-accent)] border-priority-want',
    'shadow-[var(--shadow-glow-aqua),0_0_0_1px_var(--color-aqua-a3)]',
  ],
  maybe: [
    'active-maybe bg-priority-maybe text-[var(--text-on-light-accent)] border-priority-maybe',
    'shadow-[var(--shadow-glow-amber),0_0_0_1px_var(--color-amber-a3)]',
  ],
} as const;
// A touch-first device cannot hover, so it expands the trio with a tap. A fine pointer reveals it in CSS.
const TOUCH_FIRST = '(hover: none), (pointer: coarse)';

interface SetPickControlProps {
  artistName: string;
  myPick: Priority | null | undefined;
  /** The pick is not yet on the server: the active button shows a clock. */
  syncState?: 'saving' | 'queued' | null;
  disabled?: boolean;
  onSelect: (priority: Priority, currentlyActive: boolean) => void;
}

/**
 * One compact pick control. It shows the chosen state with icon and label, and the full trio of
 * Must, Want and Maybe appears on hover or focus (fine pointer) or after one tap (touch).
 * The trio stays in the DOM for a fine pointer, so a keyboard reaches each priority in one Tab step.
 */
export default function SetPickControl({ artistName, myPick, syncState = null, disabled, onSelect }: SetPickControlProps) {
  const touchFirst = useMediaQuery(TOUCH_FIRST);
  const [open, setOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusToggle = useRef(false);
  const expanded = !touchFirst || open;

  useEffect(() => {
    if (open) groupRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"], button')?.focus();
    else if (focusToggle.current) toggleRef.current?.focus();
    focusToggle.current = false;
  }, [open]);

  const select = (priority: Priority, active: boolean) => {
    onSelect(priority, active);
    if (touchFirst) {
      focusToggle.current = true;
      setOpen(false);
    }
  };

  if (!expanded) {
    const chosen = myPick ? PRIORITY_SYMBOLS[myPick] : null;
    const pendingNote = syncState === 'queued' ? ' (saved on this device, will sync)' : syncState === 'saving' ? ' (saving)' : '';
    return (
      <button
        ref={toggleRef}
        type="button"
        className={cn(
          'card-priority-toggle',
          'h-11 min-w-11 min-h-11 px-3 gap-1.5 rounded-full flex items-center justify-center',
          'bg-[var(--color-overlay-3)] border border-border-light text-sm text-text-secondary cursor-pointer press-scale',
          'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-[-2px]',
          myPick && ACTIVE_CLASS[PRI_KEY[myPick]],
        )}
        aria-expanded="false"
        aria-label={chosen ? `${chosen.label}: ${artistName}${pendingNote}. Change priority` : `Set priority for ${artistName}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <span className={myPick === 'must' ? ICON_TEXT.must : undefined}>
          <PriorityIcon priority={myPick ?? 'must'} filled={!!myPick} />
        </span>
        <span className="text-xs font-semibold">{chosen ? chosen.short : 'Pick'}</span>
        {syncState && <Clock className="w-4 h-4 ml-0.5" aria-hidden="true" data-testid="pick-pending-clock" />}
      </button>
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles up from the child buttons
    <div
      ref={groupRef}
      className="card-priority flex gap-2"
      role="group"
      aria-label={`Priority for ${artistName}`}
      data-has-pick={myPick ? 'true' : 'false'}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && touchFirst) {
          focusToggle.current = true;
          setOpen(false);
        }
      }}
    >
      {PRIORITIES.map((p) => {
        const active = myPick === p;
        const priKey = PRI_KEY[p];
        const pending = active && !!syncState;
        const pendingSuffix = pending ? (syncState === 'queued' ? ' (saved on this device, will sync)' : ' (saving)') : '';
        return (
          <button
            key={p}
            className={cn(
              'card-priority-btn',
              // Below 360px the single-column card is too narrow for px-3 on all three.
              'h-11 min-w-11 min-h-11 px-3 max-[359px]:px-2 gap-1.5 rounded-full',
              'flex items-center justify-center',
              'bg-[var(--color-overlay-3)] border border-border-light',
              'text-sm text-text-muted cursor-pointer',
              'transition-[scale,box-shadow,background,border-color,color] duration-(--duration-fast) ease-[var(--ease-out)]',
              'hover:border-text-secondary hover:bg-[var(--color-overlay-5)]',
              'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-[-2px]',
              'press-scale',
              // Active priority states: static glow, no infinite pulse, for list-scroll perf.
              active && ACTIVE_CLASS[priKey],
            )}
            type="button"
            aria-pressed={active ? 'true' : 'false'}
            aria-label={`${PRIORITY_SYMBOLS[p].label}: ${artistName}${pendingSuffix}`}
            // aria-disabled, not disabled: a disabled button drops keyboard focus, which would collapse the trio mid-pick.
            aria-disabled={disabled || undefined}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (disabled) return;
              select(p, active);
            }}
          >
            <span className={active && p !== 'must' ? undefined : ICON_TEXT[priKey]}>
              <PriorityIcon priority={p} filled={active} />
            </span>
            <span className={cn('text-xs font-semibold', !active && 'text-text-secondary')}>{PRIORITY_SYMBOLS[p].short}</span>
            {pending && <Clock className="w-4 h-4 ml-0.5" aria-hidden="true" data-testid="pick-pending-clock" />}
          </button>
        );
      })}
      {!myPick && !touchFirst && (
        <span className="card-pick-hint" aria-hidden="true">
          <PriorityIcon priority="must" filled={false} />
          Pick
        </span>
      )}
    </div>
  );
}
