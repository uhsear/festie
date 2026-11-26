import { useEffect, useReducer, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertCircle, ChevronRight } from 'lucide-react';
import { useAuthStore } from '@festie/shared/stores';
import { useActiveSos, useLiveLocationCrewSync } from '@festie/shared/hooks';
import { sosHeadline, sosSeenLabel, sosWhen } from '@festie/shared/utils';
import { duration } from '@festie/shared/tokens';
import { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * App-wide SOS banner: filled coral (the AA-safe strong fill) under the
 * header on every screen while any crew member's SOS is active. It cannot be
 * dismissed; it clears when the SOS does. One tap opens the crew Meet tab
 * in Map view, aimed at the newest raiser. It floats over the top of the page
 * from a zero-height slot, so its arrival never moves the content below it.
 * A new raiser flashes it twice (never under reduced motion).
 */
export default function SosBanner() {
  useLiveLocationCrewSync();
  const entries = useActiveSos();
  const selfId = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();
  // Re-render each minute so "SOS 4m ago" stays true.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const active = entries.length > 0;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [active]);

  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const flashRef = useRef<HTMLSpanElement>(null);
  const newest = entries[0];
  const arrivalKey = newest ? `${newest.userId}|${newest.raisedAt}` : null;
  useEffect(() => {
    if (!arrivalKey || reducedMotion) return;
    flashRef.current?.animate?.([{ opacity: 0 }, { opacity: 0.6 }, { opacity: 0 }], {
      duration: duration.slow,
      iterations: 2,
    });
  }, [arrivalKey, reducedMotion]);

  if (!active) return null;
  const headline = sosHeadline(entries, selfId);
  const when = sosWhen(entries);
  const seen = entries[0]!.userId === selfId ? sosSeenLabel(entries[0]!) : null;

  return (
    <div className="relative h-0 shrink-0 z-[var(--z-sticky)]" data-testid="sos-banner">
      {/* Announced once: the text holds no clock, so it changes only when the
          set of SOS raisers changes. */}
      <div role="alert" className="sr-only">
        {headline}
      </div>
      <div className="absolute inset-x-0 top-0 shadow-lg">
        <button
          type="button"
          onClick={() => navigate({ to: '/crew', search: { sos: entries[0]!.userId } })}
          aria-label={`${headline}, ${when}${seen ? `, ${seen}` : ''}. Open the map to find them`}
          className="relative flex items-center gap-3 w-full min-h-12 px-4 py-2 text-left bg-accent-coral-strong text-text-on-accent hover:bg-[var(--color-accent-coral-strong-hover)] transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-text-on-accent"
        >
          <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2">
            <span className="type-label font-bold">{headline}</span>
            <span className="type-caption tabular-nums opacity-90">{seen ? `${when} · ${seen}` : when}</span>
          </span>
          <span className="flex items-center gap-0.5 type-label font-semibold shrink-0">
            Find
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </span>
          <span
            ref={flashRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-accent-coral opacity-0"
          />
        </button>
      </div>
    </div>
  );
}
