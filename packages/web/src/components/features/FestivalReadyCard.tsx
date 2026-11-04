import { Check, ChevronRight, Circle } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import type { useFestivalReady } from '@festie/shared/hooks';
import { FESTIVAL_READY_COPY } from '@festie/shared/constants';
import type { FestivalReadyKey } from '@festie/shared/utils';

interface Props {
  ready: ReturnType<typeof useFestivalReady>;
}

// 'picks' has no destination: the schedule below is already the place to pick.
const DESTINATIONS: Partial<Record<FestivalReadyKey, '/crew' | '/account' | '/picks'>> = {
  crew: '/crew',
  reminders: '/account',
  offline: '/picks',
};

/** Pre-festival checklist. The parent calls useFestivalReady once and passes the result in. */
export default function FestivalReadyCard({ ready }: Props) {
  const navigate = useNavigate();
  if (!ready.visible) return null;

  return (
    <section
      aria-label="Festival ready checklist"
      className="mb-3 w-full mx-auto max-w-[1440px] rounded-xl border border-border bg-bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-text-primary">{FESTIVAL_READY_COPY.title}</h2>
          <p className="mt-0.5 text-xs text-text-secondary">{ready.progressLabel}</p>
        </div>
        <button
          type="button"
          onClick={ready.hide}
          aria-label={FESTIVAL_READY_COPY.hideA11y}
          className="min-h-11 px-3 text-sm font-semibold text-text-secondary hover:text-text-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
        >
          {FESTIVAL_READY_COPY.hide}
        </button>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={ready.total}
        aria-valuenow={ready.doneCount}
        aria-label={ready.progressLabel}
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-overlay-4)]"
      >
        <div
          className="h-full bg-accent-aqua"
          style={{ width: `${ready.total > 0 ? (ready.doneCount / ready.total) * 100 : 0}%` }}
        />
      </div>
      <ul className="mt-2 divide-y divide-[var(--color-overlay-4)]">
        {ready.items.map((item) => {
          const to = item.done ? undefined : DESTINATIONS[item.key];
          const body = (
            <>
              <span className="flex-shrink-0 flex items-center justify-center w-5 h-5">
                {item.done ? (
                  <Check className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
                ) : (
                  <Circle className="w-4 h-4 text-text-muted" aria-hidden="true" />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className={item.done ? 'block text-sm font-medium text-text-primary' : 'block text-sm font-medium'}>
                  {item.label}
                </span>
                {!item.done && <span className="block text-xs text-text-muted">{item.hint}</span>}
              </span>
              {to && <ChevronRight className="w-4 h-4 flex-shrink-0 text-text-muted" aria-hidden="true" />}
            </>
          );
          return (
            <li key={item.key}>
              {to ? (
                <button
                  type="button"
                  aria-label={item.a11y}
                  onClick={() => navigate({ to })}
                  className="flex w-full items-center gap-3 py-2 min-h-11 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-center gap-3 py-2 min-h-11">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
