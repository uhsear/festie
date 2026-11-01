import React, { Fragment, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import {
  getConflictingSetIds,
  festivalPhase,
  groupScheduleSets,
  resolveStageColor,
  searchOtherDays,
  SCHEDULE_GROUP_BYS,
} from '@festie/shared/utils';
import SetCard from '../components/features/SetCard';
import PhaseHomeActions from '../components/features/PhaseHomeActions';
import OtherDayMatches from '../components/features/OtherDayMatches';
import ScheduleEmptyState from '../components/features/ScheduleEmptyState';
import CardsSkeleton from '../components/ui/skeletons/CardsSkeleton';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

export default function CardsView() {
  return (
    <RenderErrorBoundary name="cards">
      <CardsViewInner />
    </RenderErrorBoundary>
  );
}

/**
 * Reduce-motion guard. Tracks `prefers-reduced-motion: reduce` so the card
 * stagger entrance can be skipped entirely (matching the global a11y media
 * query in animations.css) rather than just shortened.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () =>
      typeof window !== 'undefined' && !!window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false,
    () => false,
  );
}

function CardsViewInner() {
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const days = useFestivalStore((state) => state.days);
  const user = useAuthStore((state) => state.user);
  const sets = useFestivalStore((state) => state.sets);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const stages = useFestivalStore((state) => state.stages);
  const setSelectedDay = useFestivalStore((state) => state.setSelectedDay);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const dismissedPhase = useFestivalStore((state) => state.dismissedPhase);
  const dismissPhaseBand = useFestivalStore((state) => state.dismissPhaseBand);
  const groupBy = useFestivalStore((state) => state.scheduleGroupBy) ?? 'time';
  const setGroupBy = useFestivalStore((state) => state.setScheduleGroupBy);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const setDetailAutoSpotify = useUIStore((state) => state.setDetailAutoSpotify);
  const { getMyPick, getOtherPicks } = usePicks();
  const { getStageColor: getStageColorRaw, getStageName, getDays, getFilteredSets } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = useCallback(
    (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)'),
    [getStageColorRaw],
  );
  const prefersReducedMotion = usePrefersReducedMotion();

  const handlePreview = useCallback(
    (set: Parameters<typeof setDetailSet>[0]) => {
      setDetailAutoSpotify(true);
      setDetailSet(set);
    },
    [setDetailAutoSpotify, setDetailSet],
  );

  // Day, stage chips, My picks and search all come from the shared filter.
  const filteredSets = useMemo(() => getFilteredSets(), [getFilteredSets]);
  // Sections for the remembered "Group by" (Time, Stage or A-Z).
  const groups = useMemo(
    () => groupScheduleSets(filteredSets, groupBy, stages, currentFestival?.b2bSeparator),
    [filteredSets, groupBy, stages, currentFestival?.b2bSeparator],
  );
  // Position in render order, for the stagger entrance.
  const renderIndex = useMemo(() => new Map(groups.flatMap((g) => g.sets).map((set, i) => [set.id, i])), [groups]);

  // Matches on the other days, so a search never dead-ends on the selected day.
  const otherDayGroups = useMemo(
    () => (searchQuery.trim() ? searchOtherDays(sets, searchQuery, selectedDay, stages) : []),
    [sets, searchQuery, selectedDay, stages],
  );
  const dayLabels = useMemo(() => {
    const map: Record<number, string> = {};
    for (const d of getDays()) map[d.index] = d.label || d.date;
    return map;
  }, [getDays]);
  const q = searchQuery.trim();

  // Compute conflict set IDs
  const conflictIds = useMemo(() => {
    return getConflictingSetIds(filteredSets, getMyPick);
  }, [filteredSets, getMyPick]);

  const conflictsBySetId = useMemo(() => {
    const conflictSets = filteredSets.filter((s) => conflictIds.has(s.id));
    const map = new Map<string, typeof conflictSets>();
    for (const s of conflictSets) {
      map.set(
        s.id,
        conflictSets.filter((c) => c.id !== s.id),
      );
    }
    return map;
  }, [filteredSets, conflictIds]);

  // P1-5 — festival lifecycle phase (pre / live / post), derived from the
  // festival's date range vs now (shared `festivalPhase`). Drives the
  // phase-aware home action band; null when the festival has no usable dates.
  const phase = useMemo(() => festivalPhase(currentFestival, days), [currentFestival, days]);

  // Show layout-matched skeleton while festivals are being fetched on boot
  // — same component the router uses for the chunk-load fallback so the
  // visual is continuous across route-transition → data-fetch.
  if (!currentFestival) {
    return <CardsSkeleton />;
  }

  return (
    <>
      {/* P1-5 — phase-aware home actions (authed only; matches BottomNav hiding
          crew/picks/wrap from guests). Re-prioritizes destinations by phase. */}
      {user && phase && dismissedPhase !== phase ? (
        <div className={phase === 'post' ? undefined : 'max-md:hidden'}>
          <PhaseHomeActions phase={phase} onDismiss={() => dismissPhaseBand(phase)} />
        </div>
      ) : null}

      {filteredSets.length > 0 && (
        <div className="flex items-center gap-2 w-full mx-auto max-w-[1440px] mb-[var(--space-3)]">
          <span id="cards-group-by" className="text-[length:var(--font-size-14)] text-text-secondary">
            Group by
          </span>
          <div className="flex gap-1 p-1 rounded-full bg-bg-secondary" role="group" aria-labelledby="cards-group-by">
            {SCHEDULE_GROUP_BYS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={groupBy === key}
                onClick={() => setGroupBy(key)}
                className={
                  'rounded-full px-3 min-h-11 text-[length:var(--font-size-14)] font-semibold cursor-pointer ' +
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua ' +
                  (groupBy === key
                    ? 'bg-accent-aqua text-[var(--text-on-light-accent)]'
                    : 'bg-transparent text-text-secondary hover:text-text-primary')
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Card grid */}
      {filteredSets.length === 0 ? (
        <ScheduleEmptyState
          dayLabel={dayLabels[selectedDay] ?? 'this day'}
          dayFallback={{
            title: 'No sets for this day',
            description: 'Pick another day from the day selector to browse the schedule.',
          }}
          otherDayMatches={
            q && otherDayGroups.length > 0 ? (
              <OtherDayMatches
                groups={otherDayGroups}
                dayLabels={dayLabels}
                stages={stages}
                b2bSeparator={currentFestival?.b2bSeparator}
                onSelectDay={setSelectedDay}
              />
            ) : undefined
          }
        />
      ) : (
        <div
          // `card-grid` is kept for its behavioral hooks (scroll-container
          // detection, focus-visible, priority-button styling) — layout below
          // is driven by tokens to match the mobile FlatList rhythm.
          className="card-grid grid w-full mx-auto max-w-[1440px] md:[--cards-gap:var(--space-4)]"
          // Auto-fill grid + token gap set inline so the mobile single-column →
          // calm multi-col rhythm wins over the legacy (unlayered) `.card-grid`
          // desktop overrides in pages.css. Gap steps from spacing[3] (12px,
          // tight mobile-list rhythm) to spacing[4] (16px) past the md
          // breakpoint. Top/side padding is intentionally NOT set here — the
          // shell `#main-content` (`px-6 py-4`) owns the single top/side inset
          // for every route, so the grid (and the empty-state branch above)
          // share one origin instead of stacking an extra grid pad on top.
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
            gap: 'var(--cards-gap, var(--space-3))',
          }}
          role="region"
          aria-label="Card view"
        >
          {groups.map((group) => (
            <Fragment key={group.key || 'other'}>
              <h3 className="col-span-full mt-[var(--space-2)] text-[length:var(--font-size-14)] font-semibold text-text-secondary">
                {group.label}
              </h3>
              {group.sets.map((set) => {
                const idx = renderIndex.get(set.id) ?? 0;
                const sc = getStageColor(set.stageId);
                const sn = getStageName(set.stageId) || 'Unknown';
                const others = getOtherPicks(set.id);
                const setConflicts = conflictsBySetId.get(set.id) || [];

                return (
                  <div
                    key={set.id}
                    // No windowing lib is a dependency, so the interim quick win:
                    // content-visibility:auto lets the browser skip layout/paint for
                    // off-screen cards, with contain-intrinsic-size reserving an
                    // approximate box so the scrollbar stays stable. Cuts render cost
                    // on long single-day lineups without virtualization machinery.
                    className="[content-visibility:auto] [contain-intrinsic-size:auto_240px]"
                    // Softened stagger entrance on the motion tokens
                    // (duration.med + easing.out). Skipped entirely when the user
                    // prefers reduced motion.
                    style={
                      prefersReducedMotion
                        ? undefined
                        : ({
                            animation: 'stagger-fade-in var(--duration-med) var(--ease-out) both',
                            animationDelay: `calc(${Math.min(idx, 20)} * 24ms)`,
                          } as React.CSSProperties)
                    }
                  >
                    <SetCard
                      set={set}
                      onTap={() => setDetailSet(set)}
                      onPreview={() => handlePreview(set)}
                      showPicks={!!currentProfile}
                      stageName={sn}
                      stageColor={sc}
                      friendProfiles={others}
                      conflicts={setConflicts}
                      b2bSeparator={currentFestival?.b2bSeparator}
                    />
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
      {q && filteredSets.length > 0 && (
        <OtherDayMatches
          groups={otherDayGroups}
          dayLabels={dayLabels}
          stages={stages}
          b2bSeparator={currentFestival?.b2bSeparator}
          onSelectDay={setSelectedDay}
        />
      )}
    </>
  );
}
