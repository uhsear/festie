import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { usePicks, useFestival, useDayClashes, usePickClear, useViewAs } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import {
  resolveStageColor,
  artistDisplayName,
  festivalLoadState,
  searchOtherDays,
  GRID_ZOOM_LEVELS,
  defaultZoomIndex,
} from '@festie/shared/utils';
import RefreshableView from '../components/layout/RefreshableView';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import TimelineGrid from '../features/TimelineGrid';
import FestivalLoadError from '../components/features/FestivalLoadError';
import EmptyState from '../components/ui/EmptyState';
import ScheduleEmptyState from '../components/features/ScheduleEmptyState';
import OtherDayMatches from '../components/features/OtherDayMatches';
import TBASection from '../components/timeline/TBASection';
import TimelineLegend from '../components/timeline/TimelineLegend';
import LastSyncedBadge from '../components/features/LastSyncedBadge';
import LowPowerIndicator from '../components/features/LowPowerIndicator';
import GridToolbar from '../components/grid/GridToolbar';
import ScheduleImageDialog from '../components/features/ScheduleImageDialog';
import { useGridExport } from '../components/grid/useGridExport';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { useTimelineViewport } from '../hooks/useTimelineViewport';
import { useNowIndicator } from '../hooks/useNowIndicator';
import { useScrollProgress } from '../hooks/useScrollProgress';
import { useNow } from '../hooks/useSetStatus';
import { CalendarX, Music, Filter } from 'lucide-react';
import { COPY } from '@festie/shared/constants';
import { CONCEPT_ICON } from '../lib/conceptIcons';
import { cn } from '../lib/utils';
import { useUndoNotifier } from '../lib/useUndoNotifier';
import { useToast } from '../lib/toastContext';

const JumpToNowIcon = CONCEPT_ICON.jumpToNow;

// A reader who scrolled away is left alone this long before the clock pulls back to now.
const USER_SCROLL_HOLD_MS = 120_000;

export default function GridView() {
  return (
    <>
      <h1 className="sr-only">Grid</h1>
      <RenderErrorBoundary name="grid">
        <GridViewInner />
      </RenderErrorBoundary>
    </>
  );
}

function GridViewInner() {
  const user = useAuthStore((state) => state.user);
  const days = useFestivalStore((state) => state.days);
  const sets = useFestivalStore((state) => state.sets);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const setSelectedDay = useFestivalStore((state) => state.setSelectedDay);
  const setDetailSet = useUIStore((state) => state.setDetailSet);
  // Low-power mode backs off the per-tick auto-scroll-to-now (an aggressive,
  // battery-costing reflow loop). The manual "Now" button stays available.
  const lowPowerMode = useFestivalModeStore((state) => state.lowPowerMode);
  const { getMyPick, getOtherPicks, savePick } = usePicks();
  const clearPick = usePickClear(useUndoNotifier());
  const { toast } = useToast();
  const { getStageColor: getStageColorRaw } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = useCallback(
    (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)'),
    [getStageColorRaw],
  );

  const {
    currentFestival,
    stages,
    selectedDay,
    visibleStages,
    allDaySets,
    timedSets,
    timelessSets,
    conflictIds,
    timeBounds,
  } = useTimelineFilters();

  // Matches on the other days, so a search that finds nothing here says where the artist plays.
  const otherDayGroups = useMemo(
    () => (searchQuery.trim() ? searchOtherDays(sets, searchQuery, selectedDay, stages) : []),
    [sets, searchQuery, selectedDay, stages],
  );
  const dayLabels = useMemo(
    () => Object.fromEntries((days ?? []).map((d) => [d.dayIndex, d.label || d.date])) as Record<number, string>,
    [days],
  );

  const { vpW } = useTimelineViewport();
  const { nowIndicator, gridRef, scrollToNow } = useNowIndicator(timeBounds, selectedDay);
  const { count: clashCount, marks: clashMarks, picked } = useDayClashes();
  const { target: viewAsTarget } = useViewAs();
  const navigate = useNavigate();
  const { exporting, exportGrid } = useGridExport(
    gridRef,
    selectedDay,
    days?.[selectedDay]?.label ?? `day-${selectedDay + 1}`,
  );

  // Same gutter rule as TimelineGrid, so snapped columns land beside the time labels.
  const gutterW = vpW <= 430 ? 52 : 70;
  const [zoom, setZoom] = useState(() => defaultZoomIndex(window.innerWidth));
  const rowHeight = Math.round((GRID_ZOOM_LEVELS[zoom] ?? GRID_ZOOM_LEVELS[0]) * 15);

  // R11: scroll-driven aqua beam in the left gutter. The hook updates a
  // --scroll-progress custom property on the scroll container (fallback path);
  // modern engines fill the beam natively via animation-timeline: scroll().
  const { ref: scrollRef, handleScroll: handleBeamScroll } = useScrollProgress<HTMLDivElement>();

  // --- Live mode -----------------------------------------------------------
  // A 60s shared-clock tick drives the auto-scroll.
  // Fully offline-native: reads only cached sets + the local clock, never the
  // network. Set-time math comes from the SHARED getSetTimeBounds (TZ-safe,
  // post-midnight rollover) — never a local parseSetMs. Shares the single
  // module-level clock (useNow) with every SetCard instead of a second interval.
  const nowMs = useNow();

  // Track active user scrolling so the tick-driven auto-scroll never fights a
  // user who is reading another part of the timeline. Any scroll on the
  // container arms the flag for 2 min; while armed, the tick won't yank the view.
  const recentlyScrolledRef = useRef(false);
  const scrollArmTimerRef = useRef<number | null>(null);

  const handleUserScroll = useCallback(() => {
    recentlyScrolledRef.current = true;
    if (scrollArmTimerRef.current !== null) window.clearTimeout(scrollArmTimerRef.current);
    scrollArmTimerRef.current = window.setTimeout(() => {
      recentlyScrolledRef.current = false;
    }, USER_SCROLL_HOLD_MS);
  }, []);

  useEffect(
    () => () => {
      if (scrollArmTimerRef.current !== null) window.clearTimeout(scrollArmTimerRef.current);
    },
    [],
  );

  // Keep the time in the middle of the view in place across a zoom change.
  const zoomAnchorRef = useRef<number | null>(null);
  const handleZoom = useCallback(
    (next: number) => {
      const el = scrollRef.current;
      if (el && el.scrollHeight > 0) zoomAnchorRef.current = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
      setZoom(Math.max(0, Math.min(GRID_ZOOM_LEVELS.length - 1, next)));
    },
    [scrollRef],
  );
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const frac = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    if (!el || frac === null) return;
    el.scrollTop = frac * el.scrollHeight - el.clientHeight / 2;
    handleUserScroll();
  }, [rowHeight, scrollRef, handleUserScroll]);

  const openClashes = useCallback(() => navigate({ to: '/picks', hash: 'clashes' }), [navigate]);

  // Auto-scroll to now on each tick — but only when the user isn't actively
  // scrolling and a now-line exists for the current day.
  useEffect(() => {
    if (lowPowerMode) return; // back off the auto-scroll loop to save battery
    if (nowIndicator === null) return;
    if (recentlyScrolledRef.current) return;
    const id = window.requestAnimationFrame(() => {
      if (!recentlyScrolledRef.current) scrollToNow();
    });
    return () => window.cancelAnimationFrame(id);
  }, [nowMs, nowIndicator, scrollToNow, lowPowerMode]);

  const handleSavePick = useCallback(
    async (setId: string, priority: string | null) => {
      if (!currentFestival) return;
      if (priority === null) {
        const found = allDaySets.find((s) => s.id === setId);
        clearPick(setId, found ? artistDisplayName(found, currentFestival.b2bSeparator) : 'pick');
        return;
      }
      try {
        await savePick(currentFestival.id, setId, priority as Priority);
      } catch (err) {
        // Grid and TBA cells show no failed chip, so a failed save (first-pick join included) toasts.
        toast(mapErrorToUserMessage(err, "Couldn't save your pick. Try again."), 'error');
      }
    },
    [currentFestival, savePick, clearPick, allDaySets, toast],
  );

  const loadState = useFestivalStore((s) => festivalLoadState(s));
  if (!currentFestival) {
    if (loadState === 'error') return <FestivalLoadError />;
    return (
      <EmptyState
        icon={<CalendarX className="w-12 h-12" aria-hidden="true" />}
        title={COPY.festivalLoad.noneTitle}
        description="Choose a festival on the Lineup tab to see the schedule grid."
      />
    );
  }

  // TBA-only fallback (no timed sets but there are timeless sets)
  if (timedSets.length === 0 && timelessSets.length > 0) {
    return (
      <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
        <div
          className="relative overflow-auto h-full [-webkit-overflow-scrolling:touch] overscroll-contain"
          role="region"
          aria-label={COPY.grid.regionLabel}
          data-scroll-sentinel
        >
          <TBASection
            allTba
            sets={timelessSets}
            stages={stages}
            getMyPick={getMyPick}
            getOtherPicks={getOtherPicks}
            conflictIds={conflictIds}
            canPick={!!user}
            currentFestival={currentFestival}
            getStageColor={getStageColor}
            onSavePick={handleSavePick}
            onOpenDetail={setDetailSet}
          />
        </div>
      </RefreshableView>
    );
  }

  if (!allDaySets.length || !timeBounds || timeBounds.totalSlots <= 0 || timeBounds.totalSlots > 200) {
    return (
      <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
        {allDaySets.length ? (
          <EmptyState
            icon={<Music className="w-9 h-9" aria-hidden="true" />}
            title="No sets scheduled for this day"
            description="Try switching days above to find scheduled sets."
          />
        ) : (
          <ScheduleEmptyState
            dayLabel={days?.[selectedDay]?.label ?? 'this day'}
            dayFallback={{
              title: 'No sets scheduled for this day',
              description: 'Try switching days above to find scheduled sets.',
            }}
            otherDayMatches={
              otherDayGroups.length > 0 ? (
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
        )}
      </RefreshableView>
    );
  }

  if (!visibleStages.length) {
    return (
      <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
        <EmptyState
          icon={<Filter className="w-9 h-9" aria-hidden="true" />}
          title="All stages are filtered out"
          description="Tap a stage above to show it on the grid."
        />
      </RefreshableView>
    );
  }

  return (
    <RefreshableView queryKeys={[['sets'], ['festival']]} className="timeline-view">
      <div
        ref={scrollRef}
        onScroll={() => {
          handleUserScroll();
          handleBeamScroll();
        }}
        className="timeline-scroll relative overflow-auto h-full [-webkit-overflow-scrolling:touch] overscroll-contain [scroll-snap-type:both_proximity]"
        // shortcut: 40px approximates the two-line sticky stage header; measure it if snapped hours land under it
        style={{ scrollPaddingLeft: gutterW, scrollPaddingTop: 40 }}
        role="region"
        aria-label={COPY.grid.regionLabel}
        data-scroll-sentinel
      >
        {/* R11 — full-height content wrapper so the beam's % height resolves
            against scroll content, not the viewport. The beam fills top→current
            scroll position in the left gutter. */}
        <div className="timeline-content relative min-h-full max-w-[1440px] mx-auto">
          <div className="timeline-beam" aria-hidden="true" />
          {/* Not sticky: it scrolls away so the stage header row owns the top edge (stage names stay visible). */}
          <div className="bg-bg-sticky">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TimelineLegend />
              <div className="flex items-center gap-1.5 flex-wrap pr-3 py-0.5">
                <GridToolbar
                  clashCount={clashCount}
                  pickedCount={picked}
                  viewAsOn={viewAsTarget !== null}
                  onShowClash={openClashes}
                  zoom={zoom}
                  onZoom={handleZoom}
                  exporting={exporting}
                  onExport={exportGrid}
                />
                <ScheduleImageDialog initialMode="full" />
                <LowPowerIndicator />
                <LastSyncedBadge surface="schedule" />
              </div>
            </div>
          </div>
          <TimelineGrid
            visibleStages={visibleStages}
            timedSets={timedSets}
            timeBounds={timeBounds}
            selectedDay={selectedDay}
            rowHeight={rowHeight}
            vpW={vpW}
            nowIndicator={nowIndicator}
            clashMarks={clashMarks}
            canPick={!!user}
            currentFestival={currentFestival}
            gridRef={gridRef}
            getMyPick={getMyPick}
            getOtherPicks={getOtherPicks}
            getStageColor={getStageColor}
            onSetClick={setDetailSet}
            onSavePick={handleSavePick}
          />

          {nowIndicator !== null && (
            <button
              type="button"
              className={cn(
                'fixed right-4',
                'bottom-[calc(var(--bottom-nav-h,88px)+8px+env(safe-area-inset-bottom,0px))]',
                'lg:bottom-6',
                'inline-flex items-center gap-1.5',
                'px-3.5 py-2.5 rounded-full',
                'bg-accent-aqua',
                'text-[var(--text-on-light-accent)]',
                'border-none text-[length:var(--font-size-14)] font-bold tracking-[var(--letter-spacing-caps)]',
                'cursor-pointer z-30 min-h-11',
                'shadow-[var(--shadow-glow-aqua),0_1px_3px_rgba(0,0,0,0.25)]',
                'transition-[transform,box-shadow] duration-150',
                'ease-out',
                'hover:shadow-[0_8px_24px_var(--color-aqua-a4),0_1px_4px_rgba(0,0,0,0.3)]',
                'active:scale-[0.96]',
              )}
              aria-label={COPY.jumpToNow.a11y}
              onClick={scrollToNow}
            >
              <JumpToNowIcon aria-hidden="true" className="w-4 h-4" />
              <span>{COPY.jumpToNow.label}</span>
            </button>
          )}

          {timelessSets.length > 0 && (
            <TBASection
              sets={timelessSets}
              stages={stages}
              getMyPick={getMyPick}
              getOtherPicks={getOtherPicks}
              conflictIds={conflictIds}
              canPick={!!user}
              currentFestival={currentFestival}
              getStageColor={getStageColor}
              onSavePick={handleSavePick}
              onOpenDetail={setDetailSet}
            />
          )}
        </div>
      </div>
    </RefreshableView>
  );
}
