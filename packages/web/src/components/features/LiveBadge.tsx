import { m, useReducedMotion } from 'motion/react';
import { COPY } from '@festie/shared/constants';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { SetStatus } from '@/hooks/useSetStatus';
import { cn } from '@/lib/utils';

// R6: shared pill geometry — 9999px radius, 3px/10px padding, 11px Space Grotesk
// 500, 0.04em uppercase tracking. `rounded-full` = Tailwind's 9999px.
const PILL_BASE =
  'inline-flex items-center rounded-full py-[3px] px-[10px] text-[length:var(--font-size-12)] font-medium uppercase tracking-[0.04em]';

interface LiveBadgeProps {
  status: SetStatus;
  label: string;
  className?: string;
}

export default function LiveBadge({ status, label, className }: LiveBadgeProps) {
  // Reduced motion and festival low-power mode both park the pulsing dot.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const prefersReducedMotion = useReducedMotion() || lowPowerMode;

  // Live reads the `live` token group (OD-3: green, never coral). The fill and
  // the on-accent ink come from the same theme, so contrast holds in Daylight.
  // The pulsing dot is the shape cue; the label is the word.
  if (status === 'live') {
    return (
      <div
        className={cn(
          PILL_BASE,
          'gap-1.5 bg-live-fill text-[var(--text-on-light-accent)] ring-1 ring-live-ring',
          className,
        )}
        aria-label={COPY.status.playingA11y}
      >
        {prefersReducedMotion ? (
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-on-light-accent)]" aria-hidden="true" />
        ) : (
          <m.div
            className="w-1.5 h-1.5 rounded-full bg-[var(--text-on-light-accent)]"
            aria-hidden="true"
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
        <span>{label}</span>
      </div>
    );
  }

  // R6 NOW PLAYING (soon): aqua fill + dark ink. Highest contrast (AA).
  if (status === 'soon') {
    return (
      <div className={cn(PILL_BASE, 'gap-1.5 bg-accent-aqua text-[var(--text-on-light-accent)]', className)} aria-label="Starting soon">
        {prefersReducedMotion ? (
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-on-light-accent)]" aria-hidden="true" />
        ) : (
          <m.div
            className="w-1.5 h-1.5 rounded-full bg-[var(--text-on-light-accent)]"
            aria-hidden="true"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
        <span>{label}</span>
      </div>
    );
  }

  // R6 UP NEXT (upcoming): transparent bg, 1px aqua outline at 40% opacity, aqua text.
  if (status === 'upcoming') {
    return (
      <div className={cn(PILL_BASE, 'border border-[var(--color-aqua-a4)] text-accent-aqua', className)}>{label}</div>
    );
  }

  // R6 PAST / TBA / Later: neutral surface and muted text tokens.
  return <div className={cn(PILL_BASE, 'bg-bg-secondary text-text-muted', className)}>{label}</div>;
}
