import { useEffect, useReducer } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, Siren } from 'lucide-react';
import { useAuthStore } from '@festie/shared/stores';
import { useActiveSos, useLiveLocationCrewSync } from '@festie/shared/hooks';
import { sosHeadline, sosWhen } from '@festie/shared/utils';

/**
 * App-wide SOS banner: filled coral (the AA-safe strong fill) under the
 * header on every screen while any crew member's SOS is active. It cannot be
 * dismissed; it clears when the SOS does. One tap opens the crew Meet tab,
 * where the SOS, live map and meeting points are.
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

  if (!active) return null;
  const headline = sosHeadline(entries, selfId);
  const when = sosWhen(entries);

  return (
    <div className="shrink-0" data-testid="sos-banner">
      {/* Announced once: the text holds no clock, so it changes only when the
          set of SOS raisers changes. */}
      <div role="alert" className="sr-only">
        {headline}
      </div>
      <button
        type="button"
        onClick={() => navigate({ to: '/crew' })}
        aria-label={`${headline}, ${when}. Open crew to find them`}
        className="flex items-center gap-3 w-full min-h-12 px-4 py-2 text-left bg-accent-coral-strong text-text-on-accent hover:bg-[var(--color-accent-coral-strong-hover)] transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-text-on-accent"
      >
        <Siren className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2">
          <span className="type-label font-bold">{headline}</span>
          <span className="type-caption tabular-nums opacity-90">{when}</span>
        </span>
        <span className="flex items-center gap-0.5 type-label font-semibold shrink-0">
          Find
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}
