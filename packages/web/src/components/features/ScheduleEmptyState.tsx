import type { ReactNode } from 'react';
import { Filter, Music, SearchX, Star } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useViewAs } from '@festie/shared/hooks';
import {
  hasAnyPick,
  isStageFilterActive,
  scheduleEmptyCopy,
  scheduleEmptyReason,
  searchEmptyCopy,
  searchHiddenByFilters,
} from '@festie/shared/utils';
import EmptyState from '../ui/EmptyState';

interface ScheduleEmptyStateProps {
  dayLabel: string;
  otherDayMatches?: ReactNode;
  dayFallback: { title: string; description: string };
}

/** Empty list that blames the filter that caused it and offers the button that undoes it. */
export default function ScheduleEmptyState({ dayLabel, otherDayMatches, dayFallback }: ScheduleEmptyStateProps) {
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const onlyMine = useFestivalStore((s) => s.onlyMine);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const stages = useFestivalStore((s) => s.stages);
  const picks = useFestivalStore((s) => s.currentProfile?.picks);
  const sets = useFestivalStore((s) => s.sets);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const setOnlyMine = useFestivalStore((s) => s.setOnlyMine);
  const setActiveStages = useFestivalStore((s) => s.setActiveStages);
  const activeGenres = useFestivalStore((s) => s.activeGenres);
  const setActiveGenres = useFestivalStore((s) => s.setActiveGenres);

  const { target, clear } = useViewAs();

  const reason = scheduleEmptyReason({
    query: searchQuery,
    onlyMine,
    hasAnyPick: hasAnyPick(picks),
    stageFilterActive: isStageFilterActive(activeStages, stages.length),
    genreFilterActive: (activeGenres?.length ?? 0) > 0,
    viewAsName: target?.name,
  });

  if (reason === 'search') {
    const daySets = sets.filter((s) => s.dayIndex === selectedDay);
    const hidden = searchHiddenByFilters(daySets, searchQuery, stages);
    const copy = searchEmptyCopy(searchQuery, dayLabel, !!otherDayMatches, hidden);
    const clearFilters = () => {
      clear();
      setOnlyMine(false);
      setActiveStages([]);
      setActiveGenres([]);
    };
    return (
      <>
        <EmptyState
          icon={<SearchX className="w-12 h-12" aria-hidden="true" />}
          title={copy.title}
          description={copy.message}
          cta={{ label: copy.actionLabel, onClick: hidden ? clearFilters : () => setSearchQuery('') }}
        />
        {otherDayMatches}
      </>
    );
  }
  if (reason === 'day') {
    return (
      <EmptyState
        icon={<Music className="w-12 h-12" aria-hidden="true" />}
        title={dayFallback.title}
        description={dayFallback.description}
      />
    );
  }
  const copy = scheduleEmptyCopy(reason, dayLabel, target?.name);
  const picksReason = reason === 'picks' || reason === 'viewAs';
  return (
    <EmptyState
      icon={
        picksReason ? (
          <Star className="w-12 h-12" aria-hidden="true" />
        ) : (
          <Filter className="w-12 h-12" aria-hidden="true" />
        )
      }
      title={copy.title}
      description={copy.message}
      cta={{
        label: copy.actionLabel ?? '',
        onClick: () => {
          if (reason === 'viewAs') clear();
          else if (picksReason) setOnlyMine(false);
          else if (reason === 'genres') setActiveGenres([]);
          else setActiveStages([]);
        },
      }}
    />
  );
}
