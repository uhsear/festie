import { useLocation } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import { hasAnyPick, isStageFilterActive, scheduleResultsSummary } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

/** One line under the filter bar: how many sets the filters leave, with a way to undo them. */
export default function ScheduleResultsRow() {
  const { pathname } = useLocation();
  const stages = useFestivalStore((s) => s.stages);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const onlyMine = useFestivalStore((s) => s.onlyMine);
  const picks = useFestivalStore((s) => s.currentProfile?.picks);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const setOnlyMine = useFestivalStore((s) => s.setOnlyMine);
  const setActiveStages = useFestivalStore((s) => s.setActiveStages);
  const { getFilteredSets } = useFestival();

  const mineActive = onlyMine && hasAnyPick(picks);
  const stageActive = isStageFilterActive(activeStages, stages.length);
  if (searchQuery.trim() === '' && !mineActive && !stageActive) return null;

  const sets = getFilteredSets();
  const timedView = pathname === '/timeline' || pathname === '/grid';
  const tbaCount = timedView ? sets.filter((s) => !s.startTime || !s.endTime).length : undefined;
  const summary = scheduleResultsSummary({
    count: sets.length,
    onlyMine: mineActive,
    activeStageCount: stageActive ? activeStages.length : 0,
    tbaCount,
  });

  return (
    <div className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] sm:px-6 type-micro text-text-muted">
      <span aria-live="polite">{summary}</span>
      <button
        type="button"
        aria-label="Clear all filters"
        onClick={() => {
          setSearchQuery('');
          setOnlyMine(false);
          setActiveStages([]);
        }}
        className={cn(
          'min-h-[44px] px-2 cursor-pointer font-semibold text-accent-aqua',
          'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
        )}
      >
        Clear all
      </button>
    </div>
  );
}
