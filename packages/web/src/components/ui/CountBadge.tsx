import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one count pill: a 16px-high aqua-tinted capsule for the Crew nav, the bell and the crew tabs.
 * Callers position it (absolute over a nav item, or inline after a label).
 */
export default function CountBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-accent-aqua/20 text-accent-aqua text-[length:var(--font-size-10)] font-semibold tabular-nums leading-none',
        className,
      )}
      {...props}
    />
  );
}
