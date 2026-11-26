import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useReducedMotion } from 'motion/react';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useFestivalStore, useAuthStore, selectMyPicks } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useActiveCrew, usePicksPlan } from '@festie/shared/hooks';
import type { Priority } from '@festie/shared/types';
import { COPY } from '@festie/shared/constants';
import { festivalLoadState, buildClashMarks, buildPickConflicts, buildMyDay, buildPlanList, filterPickMap, filterPlanListItems, isSetScheduled, resolveFestivalTimeZone } from '@festie/shared/utils';
import type { MyDay, PicksFilter, PicksGroupMode, PicksOrder } from '@festie/shared/utils';
import PriorityIcon from '../components/ui/PriorityIcon';
import ClashHatch from '../components/ui/ClashHatch';
import FestivalLoadError from '../components/features/FestivalLoadError';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import RovingGroup from '../components/ui/RovingGroup';
import RefreshableView from '../components/layout/RefreshableView';
import PickBulkActions from '../components/PickBulkActions';
import OfflineReadinessCard from '../components/features/OfflineReadinessCard';
import CrewSuggestionStrip from '../components/features/CrewSuggestionStrip';
import GuestPicksBanner from '../components/features/GuestPicksBanner';
import PickConflicts from '../components/features/PickConflicts';
import RateNightBanner from '../components/features/RateNightBanner';
import PicksPlanRow from '../components/features/PicksPlanRow';
import ListenList from '../components/features/ListenList';
import MyDayList from '../components/features/MyDayList';
import PlanNotesList from '../components/features/PlanNotesList';
import MarkedNoSet from '../components/features/MarkedNoSet';
// Lazy-loaded: SharePicksDialog pulls in qrcode.react, which has no business in the
// picks bundle until the user actually opens the share modal.
const SharePicksDialog = lazy(() => import('../components/features/SharePicksDialog'));
const CalendarDialog = lazy(() => import('../components/features/CalendarDialog'));
const ScheduleImageDialog = lazy(() => import('../components/features/ScheduleImageDialog'));
import { CalendarX, UserPlus, ChevronDown, Search, X, Share2, Ellipsis, Filter } from 'lucide-react';
import Button from '../components/ui/Button';
import { useToast } from '../lib/toastContext';
import { cn } from '@/lib/utils';

type PicksViewMode = 'plan' | 'myday' | 'reminders' | 'notes';

// Dot accent token and the matching tint-ring Badge variant per priority —
// mirroring the mobile Picks tab where every tier shares one accent across its
// dot, count pill and the set card's left border.
const PRIORITY_STYLE: Record<Priority, { accent: string; badge: 'must' | 'want' | 'maybe' }> = {
  must: { accent: 'var(--color-priority-must)', badge: 'must' },
  'want-to-see': { accent: 'var(--color-priority-want)', badge: 'want' },
  maybe: { accent: 'var(--color-priority-maybe)', badge: 'maybe' },
};

const GROUP_MODES: Array<{ value: PicksGroupMode; label: string }> = [
  { value: 'day', label: 'By day' },
  { value: 'priority', label: 'By priority' },
];

const ORDERS: Array<{ value: PicksOrder; label: string }> = [
  { value: 'openers', label: 'Openers first' },
  { value: 'headliners', label: 'Headliners first' },
];

const chipClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 min-h-11 text-xs font-semibold cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 ${
    active
      ? 'border-accent-aqua text-accent-aqua bg-bg-card-hover'
      : 'border-border text-text-secondary hover:bg-bg-card-hover'
  }`;

// 44px touch targets, matching the filter chips beside them.
const SEGMENT_CLASS =
  'rounded-full px-3 min-h-11 text-xs font-semibold cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2';

function PicksViewInner() {
  const navigate = useNavigate();
  const hash = useLocation().hash;
  const reducedMotion = useReducedMotion();
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const myPicks = useFestivalStore(selectMyPicks);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const days = useFestivalStore((state) => state.days);
  const stages = useFestivalStore((state) => state.stages);
  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  // A direct load never opens a crew screen, so nothing selects a crew and the crew suggestion strip stays empty.
  // The shared hook selects the first crew once and does not retry a failed select.
  useActiveCrew();
  const [view, setView] = useState<PicksViewMode>('plan');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const {
    groupMode,
    setGroupMode,
    order,
    setOrder,
    effectiveFilter,
    toggleFilter,
    search,
    setSearch,
    toggleCollapsed,
    clearFilters,
    filtersActive,
    stats,
    conflictGroups,
    clashIds,
    rows,
  } = usePicksPlan();

  // The clash chip on the schedule links here with #clashes. Show the clash cards, scroll to them, then drop the hash.
  useEffect(() => {
    if (hash.replace(/^#/, '') !== 'clashes') return;
    setView('plan');
    const id = window.requestAnimationFrame(() => {
      const el = document.getElementById('clashes');
      el?.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
      el?.focus({ preventScroll: true });
      void navigate({ to: '/picks', hash: undefined, replace: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [hash, reducedMotion, navigate]);

  // True when the profile has any pick at all, which gates the calendar export
  // independently of the active filters.
  const clashMarks = useMemo(() => buildClashMarks(conflictGroups, () => ''), [conflictGroups]);
  const pickedSets = useMemo(() => sets.filter((s) => myPicks?.[s.id]), [sets, myPicks]);
  const hasAnyPicks = pickedSets.length > 0;

  const timeZone = resolveFestivalTimeZone(currentFestival);
  const planInput = useMemo(
    () => ({ sets, days, timeZone, notes: currentProfile?.notes, reminders: currentProfile?.reminders, myPicks: myPicks ?? undefined }),
    [sets, days, timeZone, currentProfile?.notes, currentProfile?.reminders, myPicks],
  );
  const reminderItems = useMemo(() => buildPlanList('reminders', planInput), [planInput]);
  const noteItems = useMemo(() => buildPlanList('notes', planInput), [planInput]);

  // One MyDay per festival day, like mobile: buildMyDay lists picks with no known day as
  // unscheduled on every day, so keep each day's own and list the dayless picks once.
  const myDayGroups = useMemo(() => {
    if (view !== 'myday') return null;
    // The focus filter and search narrow My day the same way they narrow All picks.
    const picks = filterPickMap({ sets, picks: myPicks ?? undefined, stages, filter: effectiveFilter, search, clashIds });
    const groups: Array<{ key: string; label: string | null; myDay: MyDay }> = [];
    days.forEach((day, dayIndex) => {
      const dayGroups = buildPickConflicts({ sets, myPicks: picks, selectedDay: dayIndex, days, timeZone, stages });
      const myDay = buildMyDay({
        sets,
        myPicks: picks,
        dayIndex,
        days,
        timeZone,
        stages,
        meetingPoints,
        conflictGroups: dayGroups,
        b2bSeparator: currentFestival?.b2bSeparator,
      });
      const unscheduled = myDay.unscheduled.filter((s) => s.dayIndex === dayIndex);
      if (myDay.sections.length === 0 && unscheduled.length === 0) return;
      groups.push({ key: `day-${dayIndex}`, label: day.label || day.date, myDay: { ...myDay, unscheduled } });
    });
    const noDay = sets.filter((s) => picks[s.id] && !isSetScheduled(s, days));
    if (noDay.length > 0) {
      groups.push({ key: 'no-day', label: null, myDay: { sections: [], unscheduled: noDay, pickCount: noDay.length } });
    }
    return groups;
  }, [view, sets, myPicks, days, timeZone, stages, meetingPoints, currentFestival?.b2bSeparator, effectiveFilter, search, clashIds]);

  // Share needs an account (the link is a server page). The calendar file and the image draw from the
  // picks on this device, so a guest gets those and a Share button that asks them to sign in.
  const actionButtons = hasAnyPicks ? (
    <Suspense fallback={null}>
      {currentProfile ? (
        <SharePicksDialog />
      ) : (
        <Button
          variant="secondary"
          size="sm"
          type="button"
          aria-label="Share my picks"
          onClick={() => {
            toast('Sign in to share your picks.', 'info');
            void navigate({ to: '/login' });
          }}
        >
          <Share2 className="w-4 h-4" aria-hidden="true" />
          {COPY.picks.share}
        </Button>
      )}
      <CalendarDialog />
      <ScheduleImageDialog />
    </Suspense>
  ) : null;

  // Share, Calendar and Save image fold behind one overflow button. The panel stays mounted (hidden) so each
  // dialog keeps its state and its focus-return target while it is open.
  const actionsPanel = actionButtons ? (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape bubbles up from the child buttons
    <div
      id="picks-actions"
      hidden={!actionsOpen}
      className="flex flex-wrap justify-end gap-2 mb-3 [&[hidden]]:hidden [&_button]:whitespace-nowrap"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && actionsOpen) setActionsOpen(false);
      }}
    >
      {actionButtons}
    </div>
  ) : null;

  const guestBanner = user ? null : <GuestPicksBanner />;

  const loadState = useFestivalStore((s) => festivalLoadState(s));
  if (!currentFestival) {
    return (
      <div className="pb-5 max-w-[600px] mx-auto w-full" role="region" aria-label="My picks">
        {loadState === 'error' ? <FestivalLoadError /> : <EmptyState
          icon={<CalendarX className="w-9 h-9" aria-hidden="true" />}
          title="No festival selected"
          description="Choose a festival from the top menu to start saving picks."
        />}
      </div>
    );
  }

  if (user && !currentProfile) {
    return (
      <div className="pb-5 max-w-[600px] mx-auto w-full" role="region" aria-label="My picks">
        <OfflineReadinessCard festivalId={currentFestival.id} className="mb-3" />
        <EmptyState
          icon={<UserPlus className="w-9 h-9" aria-hidden="true" />}
          title="No picks yet"
          description="Tap Must See, Want to See or Maybe on any set to start your plan. Your first pick joins the festival."
          cta={{ label: 'Browse the lineup', onClick: () => navigate({ to: '/cards' }) }}
        />
      </div>
    );
  }

  const viewTabs: Array<{ id: PicksViewMode; label: string }> = [
    { id: 'plan', label: COPY.myDay.allPicks },
    { id: 'myday', label: COPY.myDay.name },
    { id: 'reminders', label: `${COPY.planLists.reminders} · ${reminderItems.length}` },
    { id: 'notes', label: `${COPY.planLists.notes} · ${noteItems.length}` },
  ];
  const viewTabRow =
    hasAnyPicks || reminderItems.length > 0 || noteItems.length > 0 ? (
      <RovingGroup itemRole="tab" role="tablist" aria-label="Picks views" className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
        {viewTabs.map((tab) => (
          <button
            key={tab.id}
            id={`picks-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            aria-controls="picks-view-panel"
            className={cn(
              'min-h-[44px] px-4 rounded-full border text-sm font-medium whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
              view === tab.id
                ? 'bg-accent-aqua/20 border-accent-aqua text-text-primary'
                : 'bg-bg-card border-border text-text-secondary hover:bg-bg-card-hover',
            )}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </RovingGroup>
    ) : null;

  // The key stays on this row, a direct child of the page, so arrowing between tabs keeps focus across branches.
  const filterCount = Number(effectiveFilter !== 'all') + Number(search.trim() !== '');
  const viewToolbar = viewTabRow && (
        <div key="picks-view-toolbar" className="flex items-start gap-2 mb-3">
          {viewTabRow}
          {(view === 'plan' || view === 'myday') && (
            <button
              type="button"
              aria-label={filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
              aria-expanded={filtersOpen}
              aria-controls="picks-filters"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cn(
                'relative inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border cursor-pointer',
                'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                filtersOpen ? 'border-accent-aqua text-accent-aqua' : 'border-border text-text-secondary hover:bg-bg-card-hover',
              )}
            >
              <Filter className="w-4 h-4" aria-hidden="true" />
              {filterCount > 0 && (
                <span
                  className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-accent-aqua px-1 text-[length:var(--font-size-12)] font-bold text-[var(--text-on-light-accent)]"
                  aria-hidden="true"
                >
                  {filterCount}
                </span>
              )}
            </button>
          )}
          {actionButtons && (
            <button
              type="button"
              aria-label="Share and export"
              aria-expanded={actionsOpen}
              aria-controls="picks-actions"
              onClick={() => setActionsOpen((v) => !v)}
              className={cn(
                'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border cursor-pointer',
                'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                actionsOpen ? 'border-accent-aqua text-accent-aqua' : 'border-border text-text-secondary hover:bg-bg-card-hover',
              )}
            >
              <Ellipsis className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
  );

  const chips: Array<{ value: PicksFilter; label: string; count: number; priority?: Priority; clash?: boolean }> = [
    { value: 'all', label: 'All', count: stats.total },
    ...(stats.must > 0 ? [{ value: 'must' as const, label: 'Must', count: stats.must, priority: 'must' as const }] : []),
    ...(stats.want > 0
      ? [{ value: 'want-to-see' as const, label: 'Want', count: stats.want, priority: 'want-to-see' as const }]
      : []),
    ...(stats.maybe > 0
      ? [{ value: 'maybe' as const, label: 'Maybe', count: stats.maybe, priority: 'maybe' as const }]
      : []),
    ...(stats.clashes > 0
      ? [{ value: 'clashes' as const, label: COPY.clash.filter, count: stats.clashes, clash: true }]
      : []),
  ];

  const trimmedSearch = search.trim();
  const clashOnlyEmpty = effectiveFilter === 'clashes' && !trimmedSearch;

  const filterChips = (
    <div role="group" aria-label="Filter picks" className="flex shrink-0 gap-2">
      {chips.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={effectiveFilter === c.value}
          className={chipClass(effectiveFilter === c.value)}
          onClick={() => toggleFilter(c.value)}
        >
          {c.priority && (
            <span style={{ color: PRIORITY_STYLE[c.priority].accent }} className="inline-flex">
              <PriorityIcon priority={c.priority} className="w-4 h-4" filled />
            </span>
          )}
          {c.clash && <ClashHatch className="h-4 w-1.5" />}
          {c.label}
          <Badge variant={c.priority ? PRIORITY_STYLE[c.priority].badge : 'count'}>{c.count}</Badge>
        </button>
      ))}
    </div>
  );
  const searchBox = (
    <div className="relative flex-1 min-w-[160px]">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
        aria-hidden="true"
      />
      <input
        type="text"
        inputMode="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter picks"
        aria-label="Filter my picks"
        className="w-full min-h-11 rounded-full border border-border-input bg-bg-card pl-9 pr-11 text-sm"
      />
      {search && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setSearch('')}
          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-text-muted cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
  // Notes and Reminders list every set with one, picked or not, so only the text search narrows them.
  const searchRow = <div className="flex flex-wrap items-center gap-2 mb-3">{searchBox}</div>;

  // Reminders and notes can exist without picks, so these lists skip the empty state.
  if (view === 'reminders' || view === 'notes') {
    const listItems = view === 'reminders' ? reminderItems : noteItems;
    const shownItems = filterPlanListItems(listItems, search, stages);
    return (
      <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
        <div role="region" aria-label="My picks" className="max-w-[600px] mx-auto w-full">
          {viewToolbar}
        {actionsPanel}
          <div role="tabpanel" id="picks-view-panel" aria-labelledby={`picks-tab-${view}`}>
            {listItems.length > 0 && searchRow}
            {shownItems.length === 0 && listItems.length > 0 ? (
              <EmptyState
                icon={<CalendarX className="w-9 h-9" aria-hidden="true" />}
                title="No matching picks"
                description={`Nothing matches “${trimmedSearch}”.`}
                cta={{ label: 'Clear filters', onClick: clearFilters }}
              />
            ) : (
              <PlanNotesList kind={view} items={shownItems} days={days} onOpenSet={setDetailSet} />
            )}
          </div>
        </div>
      </RefreshableView>
    );
  }

  // Global empty state: zero picks → single friendly CTA pointing at /cards,
  // rather than stacked hint blocks which looked like broken/stuck UI on first visit.
  if (stats.total === 0) {
    return (
      <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
        <div role="region" aria-label="My picks" className="max-w-[600px] mx-auto w-full">
          {guestBanner}
          {viewToolbar}
        {actionsPanel}
          <OfflineReadinessCard festivalId={currentFestival.id} className="mb-3" />
          <CrewSuggestionStrip />
          <div {...(viewTabRow ? { role: 'tabpanel', id: 'picks-view-panel', 'aria-labelledby': `picks-tab-${view}` } : {})}>
          <PickBulkActions />
          <ListenList
            sets={pickedSets}
            days={days}
            festivalName={currentFestival.name}
            separator={currentFestival.b2bSeparator}
          />
          <MarkedNoSet />
          <EmptyState
            illustration="noPicks"
            title="No picks yet"
            description="Browse the lineup and tap the sets you want to see."
            cta={{ label: 'Browse the lineup', onClick: () => navigate({ to: '/cards' }) }}
          />
          </div>
        </div>
      </RefreshableView>
    );
  }

  return (
    <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
      <div role="region" aria-label="My picks" className="flex flex-col max-w-[600px] mx-auto w-full">
        {guestBanner}
        {viewToolbar}
        {actionsPanel}
        <CrewSuggestionStrip />

        <div role="tabpanel" id="picks-view-panel" aria-labelledby={`picks-tab-${view}`}>
        {view === 'myday' && (
          <div id="picks-filters" hidden={!filtersOpen} className="[&[hidden]]:hidden">
            <div className="flex flex-nowrap gap-2 mb-3 overflow-x-auto scrollbar-hide">{filterChips}</div>
            {searchRow}
          </div>
        )}
        {view === 'myday' && myDayGroups && myDayGroups.length === 0 && (
          <EmptyState
            icon={<CalendarX className="w-9 h-9" aria-hidden="true" />}
            title={clashOnlyEmpty ? COPY.clash.none : 'No matching picks'}
            description={
              clashOnlyEmpty ? COPY.clash.noneBody : trimmedSearch ? `Nothing matches “${trimmedSearch}”.` : 'No picks in this view.'
            }
            cta={filtersActive ? { label: 'Clear filters', onClick: clearFilters } : undefined}
          />
        )}
        {view === 'myday' &&
          myDayGroups?.map((group) => (
            <div key={group.key} data-testid="my-day-group">
              {group.label && <h2 className="mt-2 mb-2 text-sm font-bold text-text-primary">{group.label}</h2>}
              <MyDayList myDay={group.myDay} onOpenSet={setDetailSet} timeZone={timeZone} underDayHeading={!!group.label} />
            </div>
          ))}

        {view === 'plan' && (
          <>
        {/* One chip row: priority filters, then Group by and Order, scrolling sideways instead of wrapping.
            It folds with the search behind the Filters button, so the first pick starts near the top. */}
        <div id="picks-filters" hidden={!filtersOpen} className="[&[hidden]]:hidden">
        <div className="flex flex-nowrap items-center gap-2 mb-3 overflow-x-auto scrollbar-hide">
          {filterChips}
          <RovingGroup
            itemRole="radio"
            role="radiogroup"
            aria-label="Group picks by"
            className="inline-flex shrink-0 rounded-full border border-border p-0.5"
          >
            {GROUP_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={groupMode === m.value}
                onClick={() => setGroupMode(m.value)}
                className={`${SEGMENT_CLASS} ${
                  groupMode === m.value ? 'bg-bg-card-hover text-accent-aqua' : 'text-text-secondary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </RovingGroup>
          <RovingGroup itemRole="radio" role="radiogroup" aria-label="Order sets" className="inline-flex shrink-0 rounded-full border border-border p-0.5">
            {ORDERS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={order === o.value}
                onClick={() => setOrder(o.value)}
                className={`${SEGMENT_CLASS} ${
                  order === o.value ? 'bg-bg-card-hover text-accent-aqua' : 'text-text-secondary'
                }`}
              >
                {o.label}
              </button>
            ))}
          </RovingGroup>
        </div>
        {searchRow}
        </div>

        <MarkedNoSet />
        {!(trimmedSearch && rows.length === 0) && <PickConflicts groups={conflictGroups} />}
        <RateNightBanner />

        {rows.length === 0 && (
          <EmptyState
            icon={<CalendarX className="w-9 h-9" aria-hidden="true" />}
            title={clashOnlyEmpty ? COPY.clash.none : 'No matching picks'}
            description={
              clashOnlyEmpty
                ? COPY.clash.noneBody
                : trimmedSearch
                  ? `Nothing matches “${trimmedSearch}”.`
                  : 'No picks in this view.'
            }
            cta={
              clashOnlyEmpty
                ? { label: 'Show all picks', onClick: clearFilters }
                : filtersActive
                  ? { label: 'Clear filters', onClick: clearFilters }
                  : undefined
            }
          />
        )}

        {rows.map((row) => {
          if (row.kind === 'set') {
            return <PicksPlanRow key={row.key} set={row.set} hasClash={clashIds.has(row.set.id)} clashMin={clashMarks.get(row.set.id)?.overlapMin} />;
          }
          const dot = row.priority && (
            <span style={{ color: PRIORITY_STYLE[row.priority].accent }} className="inline-flex">
              <PriorityIcon priority={row.priority} className="w-4 h-4" filled />
            </span>
          );
          const badge = (
            <Badge variant={row.priority ? PRIORITY_STYLE[row.priority].badge : 'count'} className="ml-auto">
              {row.count}
            </Badge>
          );
          if (row.kind === 'subgroup') {
            return (
              <h2 key={row.key} className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                {dot}
                <span className="text-sm font-medium text-text-secondary">{row.label}</span>
                {badge}
              </h2>
            );
          }
          return (
            <button
              key={row.key}
              type="button"
              aria-expanded={!row.collapsed}
              aria-label={`${row.label}, ${row.count} ${row.count === 1 ? 'pick' : 'picks'}`}
              onClick={() => toggleCollapsed(row.groupId)}
              className="flex items-center gap-2 w-full min-h-11 mb-1 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 rounded-xl"
            >
              {dot}
              <span className="text-sm font-bold text-text-primary">{row.label}</span>
              {badge}
              <ChevronDown
                className={`w-4 h-4 text-text-muted transition-transform ${row.collapsed ? '-rotate-90' : ''}`}
                aria-hidden="true"
              />
            </button>
          );
        })}
        <PickBulkActions />
        <ListenList
          sets={pickedSets}
          days={days}
          festivalName={currentFestival.name}
          separator={currentFestival.b2bSeparator}
        />
          </>
        )}
        </div>
        <OfflineReadinessCard festivalId={currentFestival.id} className="mt-3" />
      </div>
    </RefreshableView>
  );
}

export default function PicksView() {
  return (
    <>
      <h1 className="sr-only">My picks</h1>
      <RenderErrorBoundary name="picks">
        <PicksViewInner />
      </RenderErrorBoundary>
    </>
  );
}
