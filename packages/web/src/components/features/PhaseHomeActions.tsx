import { useNavigate } from '@tanstack/react-router';
import { Star, Users, Zap, Sparkles, Map as MapIcon, X, type LucideIcon } from 'lucide-react';
import {
  PHASE_ACTION_LABELS,
  PHASE_ACTION_ORDER,
  type FestivalPhase,
  type PhaseActionKey,
} from '@festie/shared/utils';
import { cn } from '../../lib/utils';

type RoutePath = '/picks' | '/crew' | '/map' | '/festival-mode' | '/wrap';

interface ActionDef {
  Icon: LucideIcon;
  to: RoutePath;
  a11y: string;
}

// Fixed destination set — phase only reorders + re-emphasizes, never hides.
// Labels and per-phase order come from @festie/shared so mobile matches.
const ACTIONS: Record<PhaseActionKey, ActionDef> = {
  myPlan: { Icon: Star, to: '/picks', a11y: 'Go to my plan' },
  crew: { Icon: Users, to: '/crew', a11y: 'Go to crew' },
  map: { Icon: MapIcon, to: '/map', a11y: 'Open map' },
  nownext: { Icon: Zap, to: '/festival-mode', a11y: 'Open Now and Next' },
  wrap: { Icon: Sparkles, to: '/wrap', a11y: 'Open festival wrap-up' },
};

const PHASE_HEADING: Record<FestivalPhase, { label: string; hint: string }> = {
  pre: { label: 'Before the festival', hint: 'Lock in your picks and rally your crew.' },
  live: { label: 'Happening now', hint: 'Find your crew, check Now & Next, stay safe.' },
  post: { label: 'Festival wrap', hint: 'Relive it and settle up with your crew.' },
};

interface PhaseHomeActionsProps {
  phase: FestivalPhase;
  onDismiss?: () => void;
}

/**
 * P1-5 — phase-aware home actions for the web landing (`/`). Mirrors the mobile
 * PhaseHomeActions band: re-prioritizes the crew's destinations by festival
 * PHASE (derived from the date range vs now via shared `festivalPhase`) — pre
 * leads with picks/crew, live leads with Now & Next + crew (live map / SOS live
 * inside /crew), post leads with wrap + settle-up. The destination set is fixed;
 * phase only reorders and emphasizes the lead, so nothing is ever hidden.
 */
export default function PhaseHomeActions({ phase, onDismiss }: PhaseHomeActionsProps) {
  const navigate = useNavigate();
  const order = PHASE_ACTION_ORDER[phase];
  const heading = PHASE_HEADING[phase];

  return (
    <section
      className="mb-[var(--space-4)] flex flex-col gap-[var(--space-2)]"
      aria-label={`${heading.label} — quick actions`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[length:var(--font-size-12)] font-bold uppercase tracking-wide text-text-muted">{heading.label}</span>
          <span className="text-xs text-text-secondary">{heading.hint}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Hide these shortcuts"
            className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center -mt-2 -mr-2 cursor-pointer text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-[var(--space-2)]" role="group" aria-label="Phase actions">
        {order.map((key, i) => {
          const a = ACTIONS[key];
          const primary = i === 0;
          const { Icon } = a;
          return (
            <button
              key={key}
              type="button"
              data-testid={`phase-action-${key}`}
              onClick={() => navigate({ to: a.to })}
              aria-label={a.a11y}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold',
                'min-h-[44px] cursor-pointer border-2 transition-colors duration-200',
                'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                primary
                  ? 'border-accent-aqua bg-[var(--color-aqua-a08)] text-accent-aqua'
                  : 'border-border text-text-secondary hover:text-text-primary',
              )}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {PHASE_ACTION_LABELS[key]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
