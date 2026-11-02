import React, { Fragment, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useFestivalStore, useAuthStore, useCrewStore, selectMyPicks } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
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
  SCHEDULE_GROUP_BYS,
} from '@festie/shared/utils';
import { useNow } from '../hooks/useSetStatus';
import SetCard from '../components/features/SetCard';
import PhaseHomeActions from '../components/features/PhaseHomeActions';
import OfflineStatusChip from '../components/features/OfflineStatusChip';
import FestivalReadyCard from '../components/features/FestivalReadyCard';
import OtherDayMatches from '../components/features/OtherDayMatches';
import ScheduleEmptyState from '../components/features/ScheduleEmptyState';
import SetTimesBanner from '../components/features/SetTimesBanner';
import DiscoverRow from '../components/features/DiscoverRow';
import FestivalLoadError from '../components/features/FestivalLoadError';
import CardsSkeleton from '../components/ui/skeletons/CardsSkeleton';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { ChevronDown, ChevronUp } from 'lucide-react';

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
  const setGroupBy = useFestivalStore((state) => state.setScheduleGroupBy);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const setDetailAutoSpotify = useUIStore((state) => state.setDetailAutoSpotify);
  const { getMyPick, getOtherPicks } = usePicks();
  const canPick = useCanPick();
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
  const visibleSets = showEarlier ? filteredSets : rest;
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
  const ready = useFestivalReady(notificationsAllowed);

  // Show layout-matched skeleton while festivals are being fetched on boot
  // — same component the router uses for the chunk-load fallback so the
  // visual is continuous across route-transition → data-fetch.
  const loadState = useFestivalStore((s) => festivalLoadState(s));
  if (!currentFestival) {
    if (loadState === 'error') return <FestivalLoadError />;
    return <CardsSkeleton />;
  }

  const hasCrew = crews.some((c) => !c.festivalId || c.festivalId === currentFestival.id);
  const actions = getHomeActions({
    phase,
    signedIn: !!user,
    pickCount: Object.keys(myPicks ?? {}).length,
    hasCrew,
  });

  return (
    <>
      {/* Before the festival the Festival ready checklist takes the band's place until it is done or hidden. */}
      {/* Next useful steps for this phase; empty (hidden) when there is nothing to do or dismissed. */}
      {ready.visible ? (
        <FestivalReadyCard ready={ready} />
      ) : actions.length > 0 && phase && dismissedPhase !== phase ? (
        <PhaseHomeActions actions={actions} onDismiss={() => dismissPhaseBand(phase)} />
      ) : null}

      <SetTimesBanner />
      <DiscoverRow />

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

      {user ? <OfflineStatusChip className="mb-[var(--space-4)]" remind /> : null}

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
          {earlier.length > 0 && (
            <button
              type="button"
              className="col-span-full inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl border border-glass-border bg-bg-card text-sm font-medium text-text-secondary cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
              aria-expanded={showEarlier}
              aria-label={
                showEarlier
                  ? 'Hide sets that ended earlier today'
                  : `Show ${earlier.length} sets that ended earlier today`
              }
              onClick={() => setShowEarlier((v) => !v)}
            >
              {showEarlier ? 'Hide earlier sets' : `Earlier today (${earlier.length})`}
              {showEarlier ? (
                <ChevronUp className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          )}
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
                      showPicks={canPick}
                      stageName={sn}
                      stageColor={sc}
                      friendProfiles={others}
                      clashLabel={clashBadges.get(set.id)?.label}
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
