import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared/services';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import { festivalPhase, formatDateSpan } from '@festie/shared/utils';
import { Link, useNavigate } from '@tanstack/react-router';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import { History, Trophy, CalendarDays, Clock, Music } from 'lucide-react';
import { RATING_META } from '../../lib/ratingIcon';

// Server shape from GET /ratings/lifetime:
//   { totals: { totalRated, avgRating, festivalsAttended, stagesVisited,
//               daysAttended, totalHours },
//     byFestival: [{ festivalId, festivalName, startDate, endDate, totalRated,
//                    avgRating, stagesVisited, daysAttended, totalHours }],
//     topArtists: [{ artist, timesRated, bestRating, avgRating }],
//     seenMost?: [{ artist, festivals }] }   // absent on an older server
interface LifetimeTotals {
  totalRated: number;
  avgRating: number | null;
  festivalsAttended: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}
interface FestivalRow {
  festivalId: string;
  festivalName: string | null;
  startDate: string | null;
  endDate: string | null;
  totalRated: number;
  avgRating: number | null;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}
interface TopArtist {
  artist: string;
  timesRated: number;
  bestRating: number;
  avgRating: number | null;
}
interface LifetimeResponse {
  totals: LifetimeTotals;
  byFestival: FestivalRow[];
  topArtists: TopArtist[];
  seenMost?: Array<{ artist: string; festivals: number }>;
}

/**
 * History surface for the account screen (M3 — cross-festival year-over-year
 * history). Fetches GET /ratings/lifetime and renders lifetime totals, a
 * per-festival timeline, and top artists across every festival. Reuses the
 * wrap stat-card styling (bg-bg-card + border + rounded-xl).
 */
export default function HistorySection() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const phase = festivalPhase(currentFestival, days);

  const { data, isLoading, isError, refetch } = useQuery<LifetimeResponse>({
    queryKey: ['ratings-lifetime', user?.id],
    queryFn: async () => api.get<LifetimeResponse>('/ratings/lifetime'),
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<History className="w-10 h-10" aria-hidden="true" />}
        title="Couldn't load your history"
        description="Something went wrong loading your festival history."
        cta={{ label: 'Retry', onClick: () => refetch() }}
      />
    );
  }

  const totals = data?.totals;
  const byFestival = data?.byFestival ?? [];
  const topArtists = data?.topArtists ?? [];
  const seenMost = (data?.seenMost ?? []).slice(0, 5);

  if (!totals || totals.totalRated === 0) {
    const empty = (
      <EmptyState
        icon={<History className="w-10 h-10" aria-hidden="true" />}
        title="No festival history yet"
        description="Rate sets at a festival and your year-over-year history will build here."
        cta={
          currentFestival && (phase === 'live' || phase === 'post')
            ? {
                label: `Rate sets from ${currentFestival.name}`,
                onClick: () => navigate({ to: '/rate', search: { festival: currentFestival.id } }),
              }
            : undefined
        }
      />
    );
    if (seenMost.length === 0) return empty;
    return (
      <div className="space-y-4">
        {empty}
        <SeenMost rows={seenMost} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Lifetime totals */}
      <div className="grid grid-cols-2 gap-3 max-[319px]:grid-cols-1">
        <Stat
          icon={<CalendarDays className="w-4 h-4" aria-hidden="true" />}
          label="Festivals"
          value={String(totals.festivalsAttended)}
        />
        <Stat
          icon={<Trophy className="w-4 h-4" aria-hidden="true" />}
          label="Sets rated"
          value={String(totals.totalRated)}
        />
        <Stat
          icon={<Music className="w-4 h-4" aria-hidden="true" />}
          label="Stages visited"
          value={String(totals.stagesVisited)}
        />
        <Stat
          icon={<Clock className="w-4 h-4" aria-hidden="true" />}
          label="Hours of music"
          value={(totals.totalHours ?? 0).toFixed(1)}
        />
      </div>

      {/* Per-festival timeline */}
      {byFestival.length > 0 && (
        <section>
          <h3 className="flex items-center gap-2 text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary mb-3">
            <span className="w-2 h-2 rounded-full bg-accent-aqua" aria-hidden="true" />
            Your festival timeline
          </h3>
          <div className="space-y-3">
            {byFestival.map((f) => {
              const span = formatDateSpan(f.startDate, f.endDate);
              return (
                <Link
                  key={f.festivalId}
                  to="/wrap"
                  search={{ festival: f.festivalId }}
                  aria-label={`Open your ${f.festivalName || f.festivalId} wrap`}
                  className="block p-4 rounded-xl bg-bg-card border border-border focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold text-text-primary truncate">{f.festivalName || f.festivalId}</div>
                    {span && <div className="text-xs text-text-muted flex-shrink-0">{span}</div>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                    <span>{f.totalRated} rated</span>
                    {f.avgRating != null && <span>avg rating {f.avgRating.toFixed(1)}</span>}
                    <span>{f.stagesVisited} stages</span>
                    <span>
                      {f.daysAttended} {f.daysAttended === 1 ? 'day' : 'days'}
                    </span>
                    <span>{(f.totalHours ?? 0).toFixed(1)}h</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Top artists across all festivals */}
      {topArtists.length > 0 && (
        <section>
          <h3 className="flex items-center gap-2 text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary mb-3">
            <span className="w-2 h-2 rounded-full bg-accent-aqua" aria-hidden="true" />
            Your all-time top artists
          </h3>
          <div className="rounded-xl bg-bg-card border border-border p-4">
            {topArtists.map((a) => (
              <div
                key={a.artist}
                className="flex items-center gap-3 py-2 border-b border-border last:border-b-0 first:pt-0 last:pb-0"
              >
                {(() => {
                  const Icon = RATING_META[a.bestRating]?.Icon ?? Music;
                  return <Icon className="w-4 h-4 text-text-secondary flex-shrink-0" aria-hidden="true" />;
                })()}
                <span className="flex-1 text-sm text-text-primary truncate">{a.artist}</span>
                <span className="text-xs text-text-muted">{a.timesRated > 1 ? `${a.timesRated}×` : ''}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {seenMost.length > 0 && <SeenMost rows={seenMost} />}
    </div>
  );
}

function SeenMost({ rows }: { rows: Array<{ artist: string; festivals: number }> }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary mb-3">
        <span className="w-2 h-2 rounded-full bg-accent-aqua" aria-hidden="true" />
        Artists you&apos;ve seen most
      </h3>
      <ul className="rounded-xl bg-bg-card border border-border p-4">
        {rows.map((r) => (
          <li
            key={r.artist}
            aria-label={`${r.artist}, ${r.festivals} festivals`}
            className="flex items-center gap-3 py-2 border-b border-border last:border-b-0 first:pt-0 last:pb-0"
          >
            <span className="flex-1 text-sm text-text-primary truncate">{r.artist}</span>
            <span className="text-xs text-text-muted">{r.festivals} festivals</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl bg-bg-card border border-border">
      <div className="flex items-center gap-1.5 text-xs text-text-muted uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xl font-bold text-text-primary">{value}</div>
    </div>
  );
}
