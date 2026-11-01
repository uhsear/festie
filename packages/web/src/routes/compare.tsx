import React, { useCallback, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useActiveCrew, useCrewCompare, useCrewFestival, useFestival, usePicks } from '@festie/shared/hooks';
import { resolveStageColor } from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import GuestTeaser from '../components/features/GuestTeaser';
import CrewSuggestionStrip from '../components/features/CrewSuggestionStrip';
import EmptyState from '../components/ui/EmptyState';
import CompareColumn from '../components/compare/CompareColumn';
import CompareRow from '../components/compare/CompareRow';
import CompareSummary from '../components/compare/CompareSummary';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';
import { Users } from 'lucide-react';
import { cn } from '../lib/utils';

export default function CompareView() {
  return (
    <RenderErrorBoundary name="compare">
      <CompareViewInner />
    </RenderErrorBoundary>
  );
}

const SORT_BUTTON =
  'min-h-11 px-3 rounded-full border text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

function CompareViewInner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const [sort, setSort] = useState<'time' | 'mix'>('time');

  const { status, crew, retry: retryCrew } = useActiveCrew();
  const { state: festivalState, festivalName, retry: retryFestival } = useCrewFestival(crew);
  const { columns, rows, freeTogether, split, together, timeZone } = useCrewCompare(sort);
  const { savePick } = usePicks();
  const { getStageColor: getStageColorRaw, getStageName } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)');

  // N1: tween the live member count when crew membership changes in real time.
  const animatedMemberCount = useAnimatedNumber(columns.length);

  const festivalId = currentFestival?.id;
  const handleAdd = useCallback(
    (setId: string, priority: Priority) => {
      if (!festivalId) return;
      // savePick is optimistic and offline-queued; the store surfaces its own error.
      savePick(festivalId, setId, priority).catch(() => {});
    },
    [festivalId, savePick],
  );

  if (!user) return <GuestTeaser mode="crew" />;

  if (status === 'loading') {
    return (
      <div className="max-w-2xl mx-auto py-8 text-center text-sm text-text-secondary" role="status">
        Loading your crew…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load your crew"
          description="Check your connection, then try again."
          cta={{ label: 'Try again', onClick: retryCrew }}
        />
      </div>
    );
  }

  if (status === 'none' || !crew) {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title="No crew yet"
          description="Make a crew or join one with a code to plan together."
          cta={{ label: 'Create or join a crew', onClick: () => navigate({ to: '/crew' }).catch(() => {}) }}
        />
      </div>
    );
  }

  if (festivalState === 'switching') {
    return (
      <div className="max-w-2xl mx-auto py-8 text-center text-sm text-text-secondary" role="status">
        Opening {festivalName}…
      </div>
    );
  }

  if (festivalState === 'failed') {
    return (
      <div className="max-w-2xl mx-auto">
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title={`Couldn't open ${festivalName}`}
          description={`${crew.name} is planning ${festivalName}. Connect to the internet, then try again.`}
          cta={{ label: 'Try again', onClick: retryFestival }}
        />
      </div>
    );
  }

  const b2bSeparator = currentFestival?.b2bSeparator;

  return (
    <div className="compare-page pb-24">
      <header className="pb-2 max-w-6xl mx-auto">
        <h1 className="text-xl font-display font-bold text-text-primary">Compare schedules</h1>
        <p className="text-sm text-text-secondary mt-1">
          {crew.name} {'·'} {festivalName} {'·'} {animatedMemberCount} {columns.length === 1 ? 'member' : 'members'}
        </p>
      </header>

      <div className="max-w-6xl mx-auto mt-2">
        <CrewSuggestionStrip title="Your crew is seeing, you're missing" />
        <CompareSummary
          columns={columns}
          freeTogether={freeTogether}
          split={split}
          together={together}
          timeZone={timeZone}
        />
        <div role="group" aria-label="Sort by" className="mb-2 flex items-center gap-2">
          <span className="text-sm text-text-secondary" aria-hidden="true">
            Sort by
          </span>
          {(
            [
              ['time', 'Time'],
              ['mix', 'Most picked'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={sort === key}
              onClick={() => setSort(key)}
              className={cn(
                SORT_BUTTON,
                sort === key
                  ? 'border-accent-aqua bg-accent-aqua/15 text-text-primary'
                  : 'border-border-light text-text-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div id="compare-panel">
        {rows.length === 0 ? (
          <div className="max-w-2xl mx-auto mt-6">
            <EmptyState
              icon={<Users className="w-12 h-12" aria-hidden="true" />}
              title="No picks on this day yet"
              description="Once you or your crew pick a set, it'll show up here for side-by-side comparison."
            />
          </div>
        ) : (
          <div
            className="max-w-6xl mx-auto mt-2 overflow-x-auto"
            role="region"
            aria-label="Crew picks by set"
            tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- intentional: keeps this overflow-x-auto table keyboard-scrollable; rule only exempts role=tabpanel
          >
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-muted">
                  <th scope="col" className="sticky left-0 bg-bg-primary z-10 py-2 pr-3 min-w-[180px]">
                    Set
                  </th>
                  {columns.map((c) => (
                    <CompareColumn key={c.profileId} id={c.profileId} name={c.name} isMe={c.isMe} color={c.color} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ set, picks, mine, topPriority, pickers }) => (
                  <CompareRow
                    key={set.id}
                    set={set}
                    mine={mine}
                    picks={picks}
                    topPriority={topPriority}
                    columns={columns.map((c) => ({ id: c.profileId, isMe: c.isMe }))}
                    stageColor={getStageColor(set.stageId)}
                    stageName={getStageName(set.stageId) ?? ''}
                    isConsensus={pickers === columns.length && columns.length > 1}
                    b2bSeparator={b2bSeparator}
                    onAdd={handleAdd}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
