import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '@festie/shared/services';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import type { WrapResponse } from '@festie/shared/types';
import { festivalPhase, selectSetsToRate } from '@festie/shared/utils';

/** Picks-tab prompt: shown while the festival is live or over and picked sets are still unrated. */
export default function RateNightBanner() {
  const user = useAuthStore((s) => s.user);
  const festival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const phase = festivalPhase(festival, days);
  const festivalId = festival?.id;

  const { data } = useQuery<WrapResponse>({
    queryKey: ['wrap', festivalId],
    queryFn: () => api.get<WrapResponse>(`/ratings/wrap/${festivalId}`),
    enabled: !!festivalId && !!user && (phase === 'live' || phase === 'post'),
  });

  if (!festivalId || !data || (phase !== 'live' && phase !== 'post')) return null;
  const count = selectSetsToRate(data.planned, data.festival).length;
  if (count === 0) return null;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-card p-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-text-primary">
          {count} {count === 1 ? 'set' : 'sets'} to rate
        </div>
        <div className="text-xs text-text-secondary">Rate them while you still remember.</div>
      </div>
      <Link
        to="/rate"
        search={{ festival: festivalId }}
        className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-accent-aqua px-4 text-sm font-semibold text-bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
      >
        Rate now
      </Link>
    </div>
  );
}
