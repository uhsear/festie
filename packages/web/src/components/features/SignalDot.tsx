import React from 'react';
import { signalGlows } from '@festie/shared/utils';
import type { SignalState } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

/**
 * Signal state as a shape, not a hue (colour is never alone): live is a filled dot
 * with the glow, aging a dimmed hollow ring, stale a dashed ring, offline a dashed
 * ring with no glow. Pair it with the age numeral.
 */
export default function SignalDot({ state, className }: { state: SignalState; className?: string }) {
  return (
    <span
      data-signal={state}
      className={cn(
        'w-2 h-2 rounded-full flex-shrink-0',
        state === 'live' && 'bg-confidence-live',
        state === 'aging' && 'border-2 border-confidence-aging opacity-70',
        state === 'stale' && 'border-2 border-dashed border-confidence-stale',
        state === 'offline' && 'border-2 border-dotted border-confidence-stale',
        signalGlows(state) && 'shadow-[var(--shadow-glow-green)]',
        className,
      )}
      aria-hidden="true"
    />
  );
}
