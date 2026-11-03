import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { api, markCaught } from '@festie/shared/services';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import type { FestivalDay, FestivalSet, Stage } from '@festie/shared/types';
import type { WrapResponse } from '@festie/shared/types';
import {
  applyCaughtMark,
  buildCaughtChecklist,
  caughtSetFromLineup,
  checklistCountLine,
  findSetsToAdd,
  formatTime,
  isWrapUnlocked,
  lineupFromDays,
  resolveFestivalTimeZone,
} from '@festie/shared/utils';
import { Music } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import RatingButtons from '../components/features/RatingButtons';
import { cn } from '../lib/utils';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useToast } from '../lib/toastContext';

const chipClass =
  'min-h-11 px-4 rounded-full border border-border text-sm font-semibold text-text-secondary cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';
const pressedClass = 'border-accent-aqua text-accent-aqua';

interface FestivalDetail {
  b2bSeparator?: string;
  stages?: Stage[];
  days: Array<FestivalDay & { sets?: FestivalSet[] }>;
}

export default function CaughtPage() {
  return (
    <RenderErrorBoundary name="caught">
      <CaughtPageInner />
    </RenderErrorBoundary>
  );
}

function CaughtPageInner() {
  const search = useSearch({ from: '/caught' });
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalId = search.festival ?? currentFestival?.id;
  if (!festivalId) {
    return (
      <EmptyState
        icon={<Music className="w-9 h-9" aria-hidden="true" />}
        title="Nothing to check off yet"
        description="Choose a festival first."
      />
    );
  }
  return <CaughtList key={festivalId} festivalId={festivalId} />;
}

function CaughtList({ festivalId }: { festivalId: string }) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const { toastError } = useToast();
  const [announcement, setAnnouncement] = useState('');

  const { data, isLoading, isError, refetch } = useQuery<WrapResponse>({
    queryKey: ['wrap', festivalId],
    queryFn: () => api.get<WrapResponse>(`/ratings/wrap/${festivalId}`),
  });

  useEffect(
    () => () => {
      void qc.invalidateQueries({ queryKey: ['wrap', festivalId] });
      void qc.invalidateQueries({ queryKey: ['ratings', festivalId] });
    },
    [qc, festivalId],
  );

  const apply = useCallback(
    (setId: string, next: boolean | null, message: string, added?: ReturnType<typeof caughtSetFromLineup>) => {
      if (!userId) return;
      qc.setQueryData<WrapResponse>(['wrap', festivalId], (w) => w && applyCaughtMark(w, setId, next, added));
      setAnnouncement(message);
      markCaught(setId, next, userId).catch((e) => {
        void qc.invalidateQueries({ queryKey: ['wrap', festivalId] });
        toastError(e, "Couldn't save that. Try again.");
      });
    },
    [qc, festivalId, userId, toastError],
  );

  const checklist = useMemo(() => (data ? buildCaughtChecklist(data) : null), [data]);

  if (isError) {
    return (
      <EmptyState
        icon={<Music className="w-9 h-9" aria-hidden="true" />}
        title="Couldn't load your sets"
        cta={{ label: 'Try again', onClick: () => refetch() }}
      />
    );
  }
  if (isLoading || !data || !checklist) {
    return (
      <div className="max-w-[560px] mx-auto w-full space-y-3 py-4">
        <Skeleton variant="card" />
      </div>
    );
  }

  const countLine = checklistCountLine(checklist.counts);
  const isEmpty = checklist.days.length === 0;

  return (
    <div className="max-w-[560px] mx-auto w-full py-4">
      <h1 className="text-lg font-bold text-text-primary">What you caught</h1>
      <p className="text-sm text-text-secondary mt-1">{data.festival.name}</p>
      <p className="text-xs text-text-secondary mt-1" aria-live="polite">
        {countLine}
      </p>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      {isEmpty && (
        <EmptyState
          icon={<Music className="w-9 h-9" aria-hidden="true" />}
          title="Nothing to check off yet"
          description="Pick sets from the lineup, or add a set you caught."
        />
      )}

      {checklist.days.map((day) => (
        <section key={day.dayIndex ?? 'tba'} className="mt-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">{day.label}</h2>
          <ul className="rounded-xl border border-border bg-bg-card divide-y divide-border">
            {day.rows.map((row) => {
              const name = row.artist || 'Unknown artist';
              const meta = [row.stageName, row.startTime ? formatTime(row.startTime) : null]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={row.setId} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-text-primary">
                        {name}
                        {row.added && (
                          <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-text-secondary">
                            Added
                          </span>
                        )}
                      </div>
                      {meta && <div className="text-xs text-text-secondary">{meta}</div>}
                    </div>
                    {!row.started && <span className="text-xs text-text-secondary">Not played yet</span>}
                    {row.started && row.added && (
                      <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        onClick={() => apply(row.setId, null, 'Mark removed')}
                        className={chipClass}
                      >
                        Remove
                      </button>
                    )}
                    {row.started && !row.added && (
                      <div role="group" aria-label={name} className="flex gap-2">
                        <button
                          type="button"
                          aria-label={`Saw ${name}`}
                          aria-pressed={row.caught === true}
                          onClick={() =>
                            row.caught === true
                              ? apply(row.setId, null, 'Mark removed')
                              : apply(row.setId, true, 'Marked as seen')
                          }
                          className={cn(chipClass, row.caught === true && pressedClass)}
                        >
                          Saw it
                        </button>
                        <button
                          type="button"
                          aria-label={`Skipped ${name}`}
                          aria-pressed={row.caught === false}
                          onClick={() =>
                            row.caught === false
                              ? apply(row.setId, null, 'Mark removed')
                              : apply(row.setId, false, 'Marked as skipped')
                          }
                          className={cn(chipClass, row.caught === false && pressedClass)}
                        >
                          Skipped
                        </button>
                      </div>
                    )}
                  </div>
                  {row.started && (
                    <div className="mt-2">
                      <RatingButtons
                        setId={row.setId}
                        festivalId={festivalId}
                        compact
                        showMemory={false}
                        onRated={() => {
                          if (row.caught !== true) apply(row.setId, true, 'Marked as seen');
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <AddSet festivalId={festivalId} data={data} onAdd={apply} />
    </div>
  );
}

function AddSet({
  festivalId,
  data,
  onAdd,
}: {
  festivalId: string;
  data: WrapResponse;
  onAdd: (
    setId: string,
    next: boolean | null,
    message: string,
    added: ReturnType<typeof caughtSetFromLineup>,
  ) => void;
}) {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const storeSets = useFestivalStore((s) => s.sets);
  const storeDays = useFestivalStore((s) => s.days);
  const storeStages = useFestivalStore((s) => s.stages);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isCurrent = festivalId === currentFestival?.id;

  const detail = useQuery<FestivalDetail>({
    queryKey: ['festival-detail', festivalId],
    queryFn: () => api.get<FestivalDetail>(`/festivals/${festivalId}`),
    enabled: open && !isCurrent,
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const source = useMemo(() => {
    if (isCurrent) {
      return { lineup: storeSets, days: storeDays, stages: storeStages, b2b: currentFestival?.b2bSeparator };
    }
    if (!detail.data) return null;
    return {
      lineup: lineupFromDays(detail.data.days),
      days: detail.data.days as FestivalDay[],
      stages: detail.data.stages ?? [],
      b2b: detail.data.b2bSeparator,
    };
  }, [isCurrent, storeSets, storeDays, storeStages, currentFestival?.b2bSeparator, detail.data]);

  const results = useMemo(() => {
    if (!source) return [];
    const excludeIds = new Set([...data.planned, ...(data.caughtExtra ?? [])].map((s) => s.setId));
    return findSetsToAdd({
      lineup: source.lineup,
      days: source.days,
      excludeIds,
      query,
      stages: source.stages,
      nowMs: Date.now(),
      timeZone: resolveFestivalTimeZone(data.festival),
      festivalOver: isWrapUnlocked(data.festival),
    });
  }, [source, data, query]);

  const stageName = (set: FestivalSet) => source?.stages.find((s) => s.id === set.stageId)?.name ?? null;
  const dayLabel = (set: FestivalSet) =>
    set.dayIndex == null ? 'TBA' : data.festival.days[set.dayIndex]?.label || `Day ${set.dayIndex + 1}`;

  return (
    <section className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="caught-add-panel"
        onClick={() => setOpen((o) => !o)}
        className={chipClass}
      >
        Add a set I caught
      </button>
      {open && (
        <div id="caught-add-panel" className="mt-3">
          <label htmlFor="caught-search" className="sr-only">
            Search the lineup
          </label>
          <input
            id="caught-search"
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search the lineup"
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-border bg-bg-card px-3 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
          />
          <p className="mt-1 text-xs text-text-secondary">Your picks are already in the list.</p>
          {detail.isError && (
            <div className="mt-3 text-sm text-text-secondary">
              <p>Couldn&apos;t load the lineup.</p>
              <button type="button" onClick={() => detail.refetch()} className={cn(chipClass, 'mt-2')}>
                Try again
              </button>
            </div>
          )}
          {query.trim() && source && results.length === 0 && (
            <p className="mt-3 text-sm text-text-secondary">No sets match &quot;{query.trim()}&quot;.</p>
          )}
          {results.length > 0 && (
            <ul className="mt-3 rounded-xl border border-border bg-bg-card divide-y divide-border">
              {results.map((set) => {
                const label = caughtSetFromLineup(set, stageName(set), source?.b2b);
                const name = label.artist || 'Unknown artist';
                const meta = [label.stageName, dayLabel(set), set.startTime ? formatTime(set.startTime) : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={set.id} className="flex flex-wrap items-center gap-2 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-text-primary">{name}</div>
                      <div className="text-xs text-text-secondary">{meta}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Add ${name}`}
                      onClick={() => {
                        onAdd(set.id, true, `Added ${name}`, label);
                        setQuery('');
                        inputRef.current?.focus();
                      }}
                      className={chipClass}
                    >
                      Add
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
