import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestival } from '@festie/shared/hooks';
import {
  festivalStatus,
  festivalTimeLabel,
  logicalDayIndexAt,
  resolveFestivalTimeZone,
  resolveStageColor,
} from '@festie/shared/utils';
import { getStageBadgeStyle } from '../ui/StageBadge';
import { useSwipeDays } from '../../hooks/useSwipeDays';
import { useHaptics } from '../../hooks/useHaptics';
import { useNow } from '../../hooks/useSetStatus';
import { useScrollFade } from '../../hooks/useScrollFade';
import { useToast } from '../../lib/toastContext';
import { Filter, Search } from 'lucide-react';
import { FESTIVAL_STATUS_LABEL } from '@festie/shared/constants';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import { cn } from '../../lib/utils';
import Input from '../ui/Input';
import SaveStatusChip from '../features/SaveStatusChip';

// Routes that carry the festival/day/stage controls. Anything else (admin, 404)
// gets no schedule chrome; AppShell already hides it on account/crew/festival-mode.
const SUB_HEADER_PATHS = ['/', '/cards', '/timeline', '/grid', '/picks', '/wrap', '/compare', '/crew-plan'];

interface SubHeaderProps {
  /** Show only day tabs (no stage chips or search). Used on /timeline, /grid, /picks. */
  dayOnly: boolean;
  /** Show only festival selector (no day tabs, stage chips, or search). Used on /wrap. */
  festivalOnly: boolean;
}

const PicksIcon = CONCEPT_ICON.picks;

export default function SubHeader({ dayOnly, festivalOnly }: SubHeaderProps) {
  const theme = useUIStore((s) => s.theme);
  const festivals = useFestivalStore((s) => s.festivals);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const selectFestival = useFestivalStore((s) => s.selectFestival);
  const stages = useFestivalStore((s) => s.stages);
  const days = useFestivalStore((s) => s.days);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const activeStages = useFestivalStore((s) => s.activeStages);
  const searchQuery = useFestivalStore((s) => s.searchQuery);
  const setSelectedDay = useFestivalStore((s) => s.setSelectedDay);
  const setActiveStages = useFestivalStore((s) => s.setActiveStages);
  const setSearchQuery = useFestivalStore((s) => s.setSearchQuery);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const onlyMine = useFestivalStore((s) => s.onlyMine);
  const setOnlyMine = useFestivalStore((s) => s.setOnlyMine);
  const { getStageColor: getStageColorRaw } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = useCallback(
    (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)'),
    [getStageColorRaw],
  );
  const { select: selectHaptic } = useHaptics();
  // Below md the search box and filters fold behind two buttons; md+ ignores both.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (searchOpen) searchBoxRef.current?.querySelector('input')?.focus();
  }, [searchOpen]);
  const { toastError } = useToast();
  const { ref: stageScrollRef, canScrollLeft, canScrollRight } = useScrollFade<HTMLDivElement>();
  const {
    ref: dayScrollRef,
    canScrollLeft: dayCanScrollLeft,
    canScrollRight: dayCanScrollRight,
  } = useScrollFade<HTMLDivElement>();

  const { bind: swipeDaysBind } = useSwipeDays({
    days,
    selectedDay,
    onSelectDay: setSelectedDay,
  });

  const handleDaySelect = useCallback(
    (dayIndex: number) => {
      selectHaptic();
      setSelectedDay(dayIndex);
    },
    [selectHaptic, setSelectedDay],
  );

  const handleFestivalChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (!id) return;
      try {
        await selectFestival(id);
      } catch (err) {
        toastError(err, "Couldn't switch festival. Try again.");
      }
    },
    [selectFestival, toastError],
  );

  const handleStageToggle = useCallback(
    (stageId: string) => {
      selectHaptic();
      // Chips select what to SHOW. Empty activeStages means "all stages", so the
      // first tap narrows to just that stage; later taps add or remove stages,
      // and emptying (or filling) the selection returns to "all stages" ([]).
      const allStageIds = stages.map((s) => s.id);
      if (activeStages.length === 0) {
        setActiveStages([stageId]);
        return;
      }
      const sel = new Set(activeStages);
      if (sel.has(stageId)) sel.delete(stageId);
      else sel.add(stageId);
      const next = allStageIds.filter((id) => sel.has(id));
      setActiveStages(next.length === 0 || next.length === allStageIds.length ? [] : next);
    },
    [activeStages, stages, setActiveStages, selectHaptic],
  );

  // Same logical-day rule as selectFestival: 06:00 in the festival zone, so a 1 AM clock is still the previous night.
  const nowMs = useNow();
  const timeZone = resolveFestivalTimeZone(currentFestival);
  const todayIndex = logicalDayIndexAt(days, nowMs, timeZone);
  const timeLabel = festivalTimeLabel(timeZone, nowMs);

  const showDayTabs = !festivalOnly && currentFestival && days.length > 0;
  const showStageFilter = !dayOnly && !festivalOnly && currentFestival && stages.length > 0;
  const showSearch = !dayOnly && !festivalOnly;
  // /picks lists only your picks, so My picks and the stage filter are moot there.
  const { pathname } = useLocation();
  const showMyPicks = !festivalOnly && !!currentFestival && !!currentProfile && pathname !== '/picks';
  // Timeline and Grid honour the stage filter but show no chips; surface the
  // active filter there so sets never vanish without a visible cause.
  const showStageSummary =
    dayOnly && (pathname === '/timeline' || pathname === '/grid') && activeStages.length > 0 && stages.length > 0;
  // CLS: while currentFestival is still loading, reserve the day-tab and
  // stage-chip rows' height with skeletons instead of letting them pop in
  // once data lands (was growing the sub-header 1 -> 2-3 rows post-paint).
  const showDaySkeleton = !festivalOnly && !currentFestival;
  const showStageSkeleton = !dayOnly && !festivalOnly && !currentFestival;
  // Pass the store's days array — the currentFestival payload carries neither
  // startDate/endDate nor embedded days, so without it festivalStatus returns
  // null and the pill never renders.
  const showFold = showSearch || !!showStageFilter;
  const filterCount = Number(activeStages.length > 0) + Number(onlyMine) + Number(searchQuery !== '');
  const currentStatus = currentFestival ? festivalStatus(currentFestival, days) : null;

  if (!SUB_HEADER_PATHS.includes(pathname)) return null;

  return (
    <div>
      <nav
        className={cn(
          'sub-header',
          // Density: compact (tighter) on <640px, comfortable on desktop.
          'flex items-center px-[var(--space-3)] py-2 gap-[var(--space-3)]',
          'sm:px-6 sm:py-3 sm:gap-[var(--space-6)]',
          'bg-[var(--color-bg-chrome)] backdrop-saturate-150 backdrop-blur-sm',
          'border-b border-border flex-wrap shrink-0',
          // --space-9 never existed in the scale (invalid var -> column-gap
          // silently dropped); --space-8 (2rem) is the nearest real step.
          'sm:[column-gap:var(--space-8)]',
          '[backdrop-filter:saturate(150%)_blur(12px)]',
          '[box-shadow:0_1px_0_var(--color-overlay-1)]',
        )}
        aria-label="Festival view controls"
      >
        {/* Festival selector */}
        <label
          htmlFor="festival-select-input"
          className="mr-1.5 inline-block text-xs font-semibold text-[var(--color-text-secondary)]"
        >
          Festival:
        </label>
        <select
          id="festival-select-input"
          className={cn(
            'festival-select',
            // min-h-[44px] guarantees the WCAG 2.5.5 / iOS 44px tap target on
            // the trigger (the native option-row height stays UA-controlled).
            'min-h-[44px] py-2 pl-3.5 pr-8 bg-bg-card border border-border rounded-full',
            'text-text-primary text-sm font-semibold cursor-pointer',
            // Responsive cap: reserve room for the label + sibling controls on
            // narrow phones (down to 320px) instead of a hard 220px that could
            // clip the dropdown arrow; relax past 640px once there's space.
            'max-w-[min(220px,calc(100vw-160px))] sm:max-w-[min(340px,40vw)]',
            'max-md:min-w-0 max-md:flex-1',
            'backdrop-blur-[8px]',
            'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
          )}
          data-testid="festival-select"
          value={currentFestival?.id || ''}
          onChange={handleFestivalChange}
        >
          <option value="">Select Festival</option>
          {festivals.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        {/* Festival status pill — moved out of the (truncatable) option text
            so long festival names don't push "· Live" off the visible edge. */}
        {currentStatus && (
          <span
            className={cn(
              'type-micro inline-block shrink-0 rounded-full px-2 py-1',
              // Live = the coral live-exception; coral-strong fill clears AA behind light text.
              currentStatus === 'ongoing' && 'bg-accent-coral-strong text-text-on-accent',
              currentStatus === 'upcoming' && 'border border-[var(--color-aqua-a4)] text-accent-aqua',
              currentStatus === 'past' && 'bg-[var(--color-bg-input)] text-text-muted',
            )}
            data-testid="festival-status-pill"
          >
            {FESTIVAL_STATUS_LABEL[currentStatus]}
          </span>
        )}

        {showFold && (
          <>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold min-h-[44px] md:hidden',
                'cursor-pointer border-2 border-border text-text-secondary',
                'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
              )}
              aria-expanded={searchOpen}
              aria-controls="subheader-search"
              onClick={() => {
                selectHaptic();
                setSearchOpen((v) => !v);
              }}
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
              Search
            </button>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold min-h-[44px] md:hidden',
                'cursor-pointer border-2 border-border text-text-secondary',
                'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
              )}
              aria-expanded={filtersOpen}
              aria-controls="subheader-filters"
              onClick={() => {
                selectHaptic();
                setFiltersOpen((v) => !v);
              }}
            >
              <Filter className="w-3.5 h-3.5" aria-hidden="true" />
              {filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
            </button>
          </>
        )}

        {/* Day tabs */}
        {showDaySkeleton && (
          <div
            className="day-tabs flex gap-[var(--space-3)] overflow-x-auto scrollbar-hide min-w-0"
            aria-hidden="true"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-[44px] w-[84px] rounded-full shrink-0" />
            ))}
          </div>
        )}

        {showDayTabs && (
          <div
            className={cn(
              'day-tabs-scroll relative min-w-0',
              dayCanScrollLeft && 'fade-left',
              dayCanScrollRight && 'fade-right',
            )}
          >
            <div
              ref={dayScrollRef}
              className={cn(
                'day-tabs hover-scroll',
                'flex gap-[var(--space-3)] snap-x snap-mandatory scroll-smooth touch-pan-y overflow-x-auto scrollbar-hide min-w-0',
              )}
              role="group"
              aria-label="Festival days"
              {...swipeDaysBind()}
            >
              {days.map((day, i) => {
                const isActive = selectedDay === i;
                const isToday = i === todayIndex;
                return (
                  <button
                    key={day.id || i}
                    className={cn(
                      'day-tab-underline',
                      'py-2 px-4 rounded-full text-[length:var(--font-size-14)] font-semibold cursor-pointer',
                      'whitespace-nowrap snap-center min-h-[44px] inline-flex items-center gap-1.5',
                      'transition-[background,color,border-color,box-shadow,transform] duration-200 ease-[var(--ease-out)]',
                      'active:scale-[0.96]',
                      'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:border-accent-aqua',
                      isActive
                        ? [
                            'active',
                            // Accent rule: aqua = selection/primary, dark ink = text.onLightAccent.
                            'bg-day-tab-active text-[var(--text-on-light-accent)] border-day-tab-active font-bold',
                            'shadow-[0_0_0_1px_rgba(0,232,208,0.45),var(--shadow-glow-aqua),0_4px_12px_rgba(0,0,0,0.25)]',
                          ]
                        : 'bg-bg-card border border-border-light text-text-secondary',
                    )}
                    type="button"
                    aria-pressed={isActive}
                    aria-label={`Day: ${day.label || day.date}${isToday ? ' (today)' : ''}`}
                    onClick={() => handleDaySelect(i)}
                  >
                    {isToday && (
                      <span
                        className={cn(
                          'inline-block w-1.5 h-1.5 rounded-full',
                          isActive ? 'bg-[var(--text-on-light-accent)]' : 'bg-accent-aqua',
                        )}
                        aria-hidden="true"
                      />
                    )}
                    {day.label || day.date}
                  </button>
                );
              })}
              {timeLabel && (
                <span className="self-center shrink-0 whitespace-nowrap text-xs text-text-muted">{timeLabel}</span>
              )}
            </div>
          </div>
        )}

        {currentProfile && <SaveStatusChip />}

        {/* md:contents keeps desktop layout identical; below md the wrapper folds. */}
        <div id="subheader-filters" className={cn('md:contents', showFold && !filtersOpen && 'max-md:hidden')}>
        {/* My picks filter */}
        {showMyPicks && (
          <button
            type="button"
            onClick={() => {
              selectHaptic();
              setOnlyMine(!onlyMine);
            }}
            aria-pressed={onlyMine}
            aria-label="Show only my picks"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold min-h-[44px]',
              'cursor-pointer border-2 transition-[border-color,background-color,color] duration-200',
              'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
              onlyMine
                ? 'border-accent-aqua bg-[var(--color-aqua-a08)] text-accent-aqua'
                : 'border-border text-text-secondary hover:text-text-primary',
            )}
          >
            <PicksIcon className="w-3.5 h-3.5" aria-hidden="true" />
            My picks
          </button>
        )}

        {showStageSummary && (
          <button
            type="button"
            onClick={() => {
              selectHaptic();
              setActiveStages([]);
            }}
            data-testid="stage-filter-summary"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold min-h-[44px]',
              'cursor-pointer border-2 border-accent-aqua bg-[var(--color-aqua-a08)] text-accent-aqua',
              'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
            )}
          >
            <Filter className="w-3.5 h-3.5" aria-hidden="true" />
            {`${activeStages.length} of ${stages.length} stages · Show all`}
          </button>
        )}

        {/* Stage filter chips */}
        {showStageSkeleton && (
          <div className="stage-filter-scroll relative min-w-0 w-full" aria-hidden="true">
            <div className="filter-stage flex gap-[var(--space-3)] flex-nowrap overflow-x-auto scrollbar-hide">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton-shimmer h-[44px] w-[76px] rounded-full shrink-0" />
              ))}
            </div>
          </div>
        )}

        {showStageFilter && (
          <div
            className={cn(
              'stage-filter-scroll relative min-w-0 w-full',
              canScrollLeft && 'fade-left',
              canScrollRight && 'fade-right',
            )}
          >
            <div
              ref={stageScrollRef}
              className={cn(
                'filter-stage hover-scroll',
                'flex gap-[var(--space-3)] flex-nowrap overflow-x-auto scrollbar-hide',
              )}
              role="group"
              aria-label="Filter by stage"
            >
              <button
                type="button"
                aria-pressed={activeStages.length === 0}
                onClick={() => {
                  selectHaptic();
                  setActiveStages([]);
                }}
                className={cn(
                  'inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-semibold',
                  'min-h-[44px] min-w-[44px] cursor-pointer border-2 transition-[border-color,background-color,color] duration-200',
                  'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                  activeStages.length === 0
                    ? 'border-accent-aqua bg-[var(--color-aqua-a08)] text-accent-aqua'
                    : 'border-border text-text-secondary hover:text-text-primary',
                )}
              >
                All stages
              </button>
              {stages.map((stage) => {
                const color = getStageColor(stage.id);
                // Only explicitly chosen stages read as selected; "All stages" owns the empty state.
                const isActive = activeStages.includes(stage.id);
                const style = getStageBadgeStyle(color, 'chip', isActive, theme);
                return (
                  <button
                    key={stage.id}
                    className={cn(
                      'inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-semibold',
                      'min-h-[44px] min-w-[44px]',
                      'cursor-pointer border-2 border-transparent transition-[border-color,background-color,color] duration-200',
                      isActive && 'border-current',
                    )}
                    style={style}
                    type="button"
                    aria-pressed={isActive}
                                        onClick={() => handleStageToggle(stage.id)}
                  >
                    {stage.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        </div>

        {/* Artist search */}
        {showSearch && (
          <div
            id="subheader-search"
            ref={searchBoxRef}
            className={cn(
              'search-box ml-auto w-full min-w-0 sm:w-auto sm:flex-1 lg:flex-none lg:w-[220px]',
              !searchOpen && searchQuery === '' && 'max-md:hidden',
            )}
            role="search"
          >
            <Input
              variant="search"
              className="min-h-[44px] w-full text-[length:var(--font-size-14)] sm:max-w-[clamp(100px,30vw,180px)] lg:max-w-none"
              placeholder="Search artist…"
              value={searchQuery}
              aria-label="Search festival artists"
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </nav>
    </div>
  );
}
