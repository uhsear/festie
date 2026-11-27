import React, { useCallback, useMemo, useState } from 'react';
import { useFestivalStore, useAuthStore, useCrewStore, selectMyPicks } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { staggerDelay } from '@festie/shared/tokens';
import { usePicks, useFestival, useCanPick, useFestivalReady } from '@festie/shared/hooks';
import {
  getHomeActions,
  festivalLoadState,
  resolveFestivalTimeZone,
  splitCardsByNow,
  detectConflicts,
  clashBadgeBySetId,
  festivalPhase,
  groupScheduleSets,
  resolveStageColor,
  searchOtherDays,
  lineupReplacesEmptyState,
  lineupFlyerModel,
} from '@festie/shared/utils';
import { useNow } from '../hooks/useSetStatus';
import { useAnnouncedLineup } from '@festie/shared/hooks/useAnnouncedLineup';
import { useMediaQuery } from '../hooks/useMediaQuery';
import SetCard from '../components/features/SetCard';
import PhaseHomeActions from '../components/features/PhaseHomeActions';
import OfflineStatusChip from '../components/features/OfflineStatusChip';
import FestivalReadyCard from '../components/features/FestivalReadyCard';
import OtherDayMatches from '../components/features/OtherDayMatches';
import ScheduleEmptyState from '../components/features/ScheduleEmptyState';
import SetTimesBanner from '../components/features/SetTimesBanner';
import AnnouncedLineup from '../components/features/AnnouncedLineup';
import LineupFlyer from '../components/features/LineupFlyer';
import DiscoverRow from '../components/features/DiscoverRow';
import FestivalLoadError from '../components/features/FestivalLoadError';
import { useOfflineDownload } from '../hooks/useOfflineDownload';
import CardsSkeleton from '../components/ui/skeletons/CardsSkeleton';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';

export default function CardsView() {
  return (
    <>
      <h1 className="sr-only">Schedule</h1>
      <RenderErrorBoundary name="cards">
        <CardsViewInner />
      </RenderErrorBoundary>
    </>
  );
}

/**
 * Reduce-motion guard. Tracks `prefers-reduced-motion: reduce` so the card
 * stagger entrance can be skipped entirely (matching the global a11y media
 * query in animations.css) rather than just shortened.
 */
function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

function CardsViewInner() {
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const days = useFestivalStore((state) => state.days);
  const myPicks = useFestivalStore(selectMyPicks);
  const user = useAuthStore((state) => state.user);
  const crews = useCrewStore((state) => state.crews);
  const sets = useFestivalStore((state) => state.sets);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const stages = useFestivalStore((state) => state.stages);
  const setSelectedDay = useFestivalStore((state) => state.setSelectedDay);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const dismissedPhase = useFestivalStore((state) => state.dismissedPhase);
  const dismissPhaseBand = useFestivalStore((state) => state.dismissPhaseBand);
  const groupBy = useFestivalStore((state) => state.scheduleGroupBy) ?? 'time';
  const stageColumns = groupBy === 'stage';

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const setDetailAutoSpotify = useUIStore((state) => state.setDetailAutoSpotify);
  const { getMyPick, getOtherPicks } = usePicks();
  const canPick = useCanPick();
  const { getStageColor: getStageColorRaw, getStageName, getDays, getFilteredSets } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web stage-fallback CSS var.
  const getStageColor = useCallback(
    (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--color-stage-fallback)'),
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

  const nowMs = useNow();
  const [showEarlier, setShowEarlier] = useState(false);

  // Day, stage chips, My picks and search all come from the shared filter.
  // Time order; sets already over today fold into one "Earlier today" row.
  const { earlier, rest } = useMemo(
    () =>
      splitCardsByNow(getFilteredSets(), {
        days,
        nowMs,
        timeZone: resolveFestivalTimeZone(currentFestival),
        separator: currentFestival?.b2bSeparator,
      }),
    [getFilteredSets, days, nowMs, currentFestival],
  );
  const filteredSets = useMemo(() => [...earlier, ...rest], [earlier, rest]);
  // Don't fold a search, or the only sets left (late night), behind the collapsed row.
  const earlierForced = rest.length === 0 || searchQuery.trim() !== '';
  const visibleSets = showEarlier || earlierForced ? filteredSets : rest;
  // Sections for the remembered "Group by" (Time, Stage or A-Z).
  const groups = useMemo(
    () => groupScheduleSets(visibleSets, groupBy, stages, currentFestival?.b2bSeparator),
    [visibleSets, groupBy, stages, currentFestival?.b2bSeparator],
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
  const announced = useAnnouncedLineup(nowMs);
  // While no set has a time the lineup shows as a flyer, with no pick controls; the cards return when times publish.
  const flyer = useMemo(() => lineupFlyerModel(currentFestival, days, sets, nowMs), [currentFestival, days, sets, nowMs]);

  // Per-set badge naming the other set it clashes with and the overlap.
  const clashBadges = useMemo(
    () => clashBadgeBySetId(detectConflicts(filteredSets, getMyPick), currentFestival?.b2bSeparator),
    [filteredSets, getMyPick, currentFestival?.b2bSeparator],
  );

  // P1-5 — festival lifecycle phase (pre / live / post), derived from the
  // festival's date range vs now (shared `festivalPhase`). Drives the
  // phase-aware home action band; null when the festival has no usable dates.
  const phase = useMemo(() => festivalPhase(currentFestival, days), [currentFestival, days]);

  // AppShell already runs usePushNotifications; read the permission directly instead of a second instance.
  const notificationsAllowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const { mapStatus } = useOfflineDownload(currentFestival?.id ?? '');
  const ready = useFestivalReady(notificationsAllowed, undefined, mapStatus);

  // Show layout-matched skeleton while festivals are being fetched on boot
  // — same component the router uses for the chunk-load fallback so the
  // visual is continuous across route-transition → data-fetch.
  const loadState = useFestivalStore((s) => festivalLoadState(s));
  if (!currentFestival) {
    if (loadState === 'error') return <FestivalLoadError />;
    return <CardsSkeleton />;
  }

  const hasCrew = crews.some((c) => !c.festivalId || c.festivalId === currentFestival.id);
  // The announced lineup stands in for "No sets for this day" only when the day has no sets at all.
  const lineupStandsIn = lineupReplacesEmptyState(announced, q);
  const actions = getHomeActions({
    phase,
    signedIn: !!user,
    pickCount: Object.keys(myPicks ?? {}).length,
    hasCrew,
  });

  return (
    <>
      {/* A flyer says why there are no sets (times are not out) and offers Follow, so it leads the checklist. */}
      {flyer ? <LineupFlyer model={flyer} /> : null}

      {/* Before the festival the Festival ready checklist takes the band's place until it is done or hidden. */}
      {/* Next useful steps for this phase; empty (hidden) when there is nothing to do or dismissed. */}
      {ready.visible ? (
        <FestivalReadyCard ready={ready} />
      ) : actions.length > 0 && phase && dismissedPhase !== phase ? (
        <PhaseHomeActions actions={actions} onDismiss={() => dismissPhaseBand(phase)} />
      ) : null}

      {flyer ? null : <SetTimesBanner />}
      <DiscoverRow />
      {/* A search lists the matching announced acts under the set results instead (below). */}
      {q || flyer ? null : <AnnouncedLineup model={announced} />}

      {user ? <OfflineStatusChip className="mb-[var(--space-4)]" remind /> : null}

      {/* Card grid */}
      {flyer ? null : filteredSets.length === 0 ? (
        lineupStandsIn ? null : (
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
        )
      ) : (
        <div
          // `card-grid` is kept for its behavioral hooks (scroll-container
          // detection, focus-visible, priority-button styling).
          // Layout: one column on a phone. From md up, stage groups are side-by-side columns (one column of
          // cards per stage), and time or A-Z groups flow down balanced columns, so a group of one to three
          // cards no longer leaves most of a 1440px page blank. Top/side padding is intentionally NOT set
          // here: the shell `#main-content` (`px-6 py-4`) owns the single inset for every route.
          className={cn(
            'card-grid w-full mx-auto max-w-[1440px] md:[--cards-gap:var(--space-4)]',
            stageColumns
              ? 'grid items-start'
              : 'flex flex-col gap-[var(--cards-gap,var(--space-3))] md:block md:[column-width:300px] md:[column-gap:var(--space-4)]',
          )}
          style={
            stageColumns
              ? {
                  // 300px keeps the Must/Want/Maybe row inside the card; 260px clipped Maybe.
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
                  gap: 'var(--cards-gap, var(--space-3))',
                }
              : undefined
          }
          role="region"
          aria-label="Card view"
        >
          {earlier.length > 0 && !earlierForced && (
            <button
              type="button"
              className="col-span-full [column-span:all] mb-3 inline-flex w-full items-center justify-center gap-1.5 min-h-11 rounded-lg border border-glass-border bg-bg-card text-sm font-medium text-text-secondary cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
              aria-expanded={showEarlier}
              aria-label={showEarlier ? undefined : `Earlier today (${earlier.length}), show sets that ended earlier`}
              onClick={() => setShowEarlier((v) => !v)}
            >
              {/* One label in both states: the count stays and the chevron says which way it goes. */}
              {`Earlier today (${earlier.length})`}
              {showEarlier ? (
                <ChevronUp className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          )}
          {groups.map((group) => (
            <section
              key={group.key || 'other'}
              className={cn('min-w-0 flex flex-col gap-[var(--cards-gap,var(--space-3))]', !stageColumns && 'md:mb-4 md:break-inside-avoid')}
            >
              <h2 className="mt-[var(--space-2)] text-[length:var(--font-size-14)] font-semibold text-text-secondary">
                {group.label}
              </h2>
              {group.sets.map((set) => {
                const idx = renderIndex.get(set.id) ?? 0;
                const sc = getStageColor(set.stageId);
                const sn = getStageName(set.stageId) || 'Unknown';
                const others = getOtherPicks(set.id);

                return (
                  <div
                    key={set.id}
                    // No windowing lib is a dependency, so the interim quick win:
                    // content-visibility:auto lets the browser skip layout/paint for
                    // off-screen cards, with contain-intrinsic-size reserving an
                    // approximate box so the scrollbar stays stable. Cuts render cost
                    // on long single-day lineups without virtualization machinery.
                    className={cn(
                      '[content-visibility:auto] [contain-intrinsic-size:auto_240px]',
                      // Stage columns do not share time slots, so cards get one height instead: tall enough for
                      // time, title, status chip, clash chip and pick row, with the card filling it.
                      stageColumns && 'md:flex md:min-h-[12.5rem] md:[&>*]:min-w-0 md:[&>*]:flex-1',
                    )}
                    // Softened stagger entrance on the motion tokens
                    // (duration.med + easing.out). Skipped entirely when the user
                    // prefers reduced motion.
                    style={
                      prefersReducedMotion
                        ? undefined
                        : ({
                            animation: 'stagger-fade-in var(--duration-med) var(--ease-out) both',
                            animationDelay: `${staggerDelay(idx)}ms`,
                          } as React.CSSProperties)
                    }
                  >
                    <SetCard
                      set={set}
                      onTap={() => setDetailSet(set)}
                      onPreview={() => handlePreview(set)}
                      showPicks={canPick}
                      stageName={sn}
                      stageColor={sc}
                      friendProfiles={others}
                      clashLabel={clashBadges.get(set.id)?.base}
                      clashMore={clashBadges.get(set.id)?.more}
                      b2bSeparator={currentFestival?.b2bSeparator}
                    />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
      {q && !flyer && filteredSets.length > 0 && (
        <OtherDayMatches
          groups={otherDayGroups}
          dayLabels={dayLabels}
          stages={stages}
          b2bSeparator={currentFestival?.b2bSeparator}
          onSelectDay={setSelectedDay}
        />
      )}
      {q && !flyer ? <AnnouncedLineup model={announced} /> : null}
    </>
  );
}
