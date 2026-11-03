import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { api, markCaught } from '@festie/shared/services';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import type { WrapPlannedSet, WrapResponse } from '@festie/shared/types';
import { formatTime, isWrapUnlocked, selectSetsToRate } from '@festie/shared/utils';
import { CheckCircle2, Music } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import RatingButtons from '../components/features/RatingButtons';
import { cn } from '../lib/utils';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useToast } from '../lib/toastContext';

const ADVANCE_DELAY_MS = 300;

const chipClass =
  'min-h-11 px-4 rounded-full border border-border text-sm font-semibold text-text-secondary cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

const listLinkClass =
  'inline-flex min-h-11 items-center text-sm font-semibold text-accent-aqua underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

const linkClass =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-accent-aqua px-5 text-sm font-semibold text-bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

export default function RatePage() {
  return (
    <RenderErrorBoundary name="rate">
      <RatePageInner />
    </RenderErrorBoundary>
  );
}

function RatePageInner() {
  const search = useSearch({ from: '/rate' });
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalId = search.festival ?? currentFestival?.id;
  if (!festivalId) {
    return (
      <EmptyState
        icon={<Music className="w-9 h-9" aria-hidden="true" />}
        title="Nothing to rate right now"
        description="Sets you picked show up here after they end."
      />
    );
  }
  return <RateFlow key={festivalId} festivalId={festivalId} />;
}

function RateFlow({ festivalId }: { festivalId: string }) {
  const qc = useQueryClient();
  const reduceMotion = useReducedMotion();
  const [queue, setQueue] = useState<WrapPlannedSet[] | null>(null);
  const [index, setIndex] = useState(0);
  const [seenId, setSeenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = useAuthStore((s) => s.user?.id);
  const { toastError } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<WrapResponse>({
    queryKey: ['wrap', festivalId],
    queryFn: () => api.get<WrapResponse>(`/ratings/wrap/${festivalId}`),
  });

  // Freeze the list on first load so a rated set does not vanish from under the user mid-flow.
  useEffect(() => {
    if (data && queue === null) setQueue(selectSetsToRate(data.planned, data.festival));
  }, [data, queue]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void qc.invalidateQueries({ queryKey: ['wrap', festivalId] });
      void qc.invalidateQueries({ queryKey: ['ratings', festivalId] });
    },
    [qc, festivalId],
  );

  const next = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIndex((i) => i + 1), reduceMotion ? 0 : ADVANCE_DELAY_MS);
  }, [reduceMotion]);

  const mark = useCallback(
    (setId: string, caught: boolean) => {
      if (!userId) return;
      markCaught(setId, caught, userId).catch((e) => toastError(e, "Couldn't save that. Try again."));
    },
    [userId, toastError],
  );

  if (isError) {
    return (
      <EmptyState
        icon={<Music className="w-9 h-9" aria-hidden="true" />}
        title="Couldn't load your sets"
        cta={{ label: 'Try again', onClick: () => refetch() }}
      />
    );
  }
  if (isLoading || !data || queue === null) {
    return (
      <div className="max-w-[480px] mx-auto w-full space-y-3">
        <Skeleton variant="card" />
      </div>
    );
  }
  if (queue.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Music className="w-9 h-9" aria-hidden="true" />}
          title="Nothing to rate right now"
          description="Sets you picked show up here after they end."
        />
        <div className="flex justify-center">
          <Link to="/caught" search={{ festival: festivalId }} className={listLinkClass}>
            See the full list
          </Link>
        </div>
      </>
    );
  }

  if (index >= queue.length) {
    const unlocked = isWrapUnlocked(data.festival);
    return (
      <div className="max-w-[480px] mx-auto w-full flex flex-col items-center gap-4 py-10 text-center">
        <CheckCircle2 className="w-10 h-10 text-accent-aqua" aria-hidden="true" />
        <h1 className="text-xl font-bold text-text-primary">All rated</h1>
        <p className="text-sm text-text-secondary">Thanks. Your ratings go into your wrap.</p>
        <Link to="/caught" search={{ festival: festivalId }} className={listLinkClass}>
          See the full list
        </Link>
        {unlocked ? (
          <Link to="/wrap" search={{ festival: festivalId }} className={linkClass}>
            See your wrap
          </Link>
        ) : (
          <Link to="/picks" className={linkClass}>
            Back to picks
          </Link>
        )}
      </div>
    );
  }

  const set = queue[index]!;
  const day = set.dayIndex === null ? undefined : data.festival.days[set.dayIndex];
  const dayLabel = set.dayIndex === null ? null : day?.label || `Day ${set.dayIndex + 1}`;
  const meta = [set.stageName, dayLabel, set.startTime ? formatTime(set.startTime) : null].filter(Boolean).join(' · ');

  return (
    <div className="max-w-[480px] mx-auto w-full py-4">
      <h1 className="text-lg font-bold text-text-primary">Rate your night</h1>
      <Link to="/caught" search={{ festival: festivalId }} className={listLinkClass}>
        See the full list
      </Link>
      <p className="text-xs text-text-secondary mt-1" aria-live="polite">
        {index + 1} of {queue.length}
      </p>
      <div className="mt-4 rounded-xl border border-border bg-bg-card p-5 text-center">
        <div className="text-2xl font-bold text-text-primary">{set.artist || 'Unknown artist'}</div>
        {meta && <div className="mt-1 text-sm text-text-secondary">{meta}</div>}
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            aria-pressed={seenId === set.setId}
            onClick={() => {
              mark(set.setId, true);
              setSeenId(set.setId);
            }}
            className={cn(chipClass, seenId === set.setId && 'border-accent-aqua text-accent-aqua')}
          >
            Saw it
          </button>
          <button
            type="button"
            onClick={() => {
              mark(set.setId, false);
              setIndex((i) => i + 1);
            }}
            className={chipClass}
          >
            Skipped
          </button>
        </div>
        <div className="mt-4">
          <RatingButtons
            key={set.setId}
            setId={set.setId}
            festivalId={festivalId}
            showMemory={false}
            onRated={() => {
              mark(set.setId, true);
              next();
            }}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          className="min-h-11 px-5 rounded-full border border-border text-sm font-semibold text-text-secondary cursor-pointer"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
