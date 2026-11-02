import { useNavigate } from '@tanstack/react-router';
import { MapPin, Sparkles, Star, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { HomeAction, HomeActionKey } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

type RoutePath = '/crew' | '/wrap';

const LINKS: Partial<Record<HomeActionKey, { Icon: LucideIcon; to: RoutePath }>> = {
  crew: { Icon: Users, to: '/crew' },
  find: { Icon: MapPin, to: '/crew' },
  wrap: { Icon: Sparkles, to: '/wrap' },
  settle: { Icon: Wallet, to: '/crew' },
};

interface PhaseHomeActionsProps {
  actions: HomeAction[];
}

/**
 * Next-step band above the schedule cards. The list comes from shared
 * `getHomeActions` (picks and crew before the festival, finding the crew during
 * it, wrap and settle-up after). A `link` is a button that navigates; a `hint`
 * is plain text. The caller renders nothing when the list is empty.
 */
export default function PhaseHomeActions({ actions }: PhaseHomeActionsProps) {
  const navigate = useNavigate();

  return (
    <section className="mb-[var(--space-4)]" aria-label="Next steps">
      <div className="flex flex-wrap gap-[var(--space-2)]">
        {actions.map((a) => {
          const link = a.kind === 'link' ? LINKS[a.key] : undefined;
          if (!link) {
            return (
              <span
                key={a.key}
                data-testid={`phase-action-${a.key}`}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-1 text-xs font-medium text-text-secondary"
              >
                <Star className="w-4 h-4" aria-hidden="true" />
                {a.label}
              </span>
            );
          }
          const { Icon } = link;
          return (
            <button
              key={a.key}
              type="button"
              data-testid={`phase-action-${a.key}`}
              onClick={() => navigate({ to: link.to })}
              aria-label={a.a11y}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold',
                'min-h-[44px] cursor-pointer border-2 transition-colors duration-200',
                'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                'border-accent-aqua bg-[var(--color-aqua-a08)] text-accent-aqua',
              )}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {a.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
