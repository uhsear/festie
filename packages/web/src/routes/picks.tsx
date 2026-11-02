import { useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { usePicksPlan } from '@festie/shared/hooks';
import type { Priority } from '@festie/shared/types';
import { COPY } from '@festie/shared/constants';
import { buildPickConflicts, buildMyDay, buildPlanList, resolveFestivalTimeZone } from '@festie/shared/utils';
import type { PicksFilter, PicksGroupMode, PicksOrder } from '@festie/shared/utils';
import PriorityIcon from '../components/ui/PriorityIcon';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import RefreshableView from '../components/layout/RefreshableView';
import PickBulkActions from '../components/PickBulkActions';
import OfflineReadinessCard from '../components/features/OfflineReadinessCard';
import CrewSuggestionStrip from '../components/features/CrewSuggestionStrip';
import GuestTeaser from '../components/features/GuestTeaser';
import PickConflicts from '../components/features/PickConflicts';
import PicksPlanRow from '../components/features/PicksPlanRow';
import ListenList from '../components/features/ListenList';
import MyDayList from '../components/features/MyDayList';
import PlanNotesList from '../components/features/PlanNotesList';
// Lazy-loaded: SharePicksDialog pulls in qrcode.react, which has no business in the
// picks bundle until the user actually opens the share modal.
const SharePicksDialog = lazy(() => import('../components/features/SharePicksDialog'));
const CalendarDialog = lazy(() => import('../components/features/CalendarDialog'));
import { CalendarX, UserPlus, TriangleAlert, ChevronDown, Search, X } from 'lucide-react';
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
  `inline-flex items-center gap-1.5 rounded-full border px-3 min-h-9 text-xs font-semibold cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 ${
    active
      ? 'border-accent-aqua text-accent-aqua bg-bg-card-hover'
      : 'border-border text-text-secondary hover:bg-bg-card-hover'
  }`;

function PicksViewInner() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const days = useFestivalStore((state) => state.days);
  const stages = useFestivalStore((state) => state.stages);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);
  const [view, setView] = useState<PicksViewMode>('plan');
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

  // True when the profile has any pick at all, which gates the calendar export
  // independently of the active filters.
  const pickedSets = useMemo(() => sets.filter((s) => currentProfile?.picks?.[s.id]), [sets, currentProfile]);
  const hasAnyPicks = pickedSets.length > 0;

  const timeZone = resolveFestivalTimeZone(currentFestival);
  const myPicks = currentProfile?.picks;
  const planInput = useMemo(
    () => ({ sets, days, timeZone, notes: currentProfile?.notes, reminders: currentProfile?.reminders, myPicks }),
    [sets, days, timeZone, currentProfile?.notes, currentProfile?.reminders, myPicks],
  );
  const reminderItems = useMemo(() => buildPlanList('reminders', planInput), [planInput]);
  const noteItems = useMemo(() => buildPlanList('notes', planInput), [planInput]);

  const myDay = useMemo(() => {
    if (view !== 'myday') return null;
    const picks = myPicks ?? {};
    const dayGroups = buildPickConflicts({ sets, myPicks: picks, selectedDay, days, timeZone, stages });
    return buildMyDay({
      sets,
      myPicks: picks,
      dayIndex: selectedDay,
      days,
      timeZone,
      stages,
      meetingPoints,
      conflictGroups: dayGroups,
      b2bSeparator: currentFestival?.b2bSeparator,
    });
  }, [view, sets, myPicks, selectedDay, days, timeZone, stages, meetingPoints, currentFestival?.b2bSeparator]);

  const actionButtons = hasAnyPicks ? (
    <Suspense fallback={null}>
      <SharePicksDialog />
      <CalendarDialog />
    </Suspense>
  ) : null;

  // Guests get the in-place sign-up teaser (parity with the always-visible nav
  // tabs) instead of a redirect to /login.
  if (!user) return <GuestTeaser mode="picks" />;

  if (!currentFestival) {
    return (
      <div className="pb-5 max-w-[600px] mx-auto w-full" role="region" aria-label="My picks">
        <EmptyState
          icon={<CalendarX className="w-9 h-9" aria-hidden="true" />}
          title="No festival selected"
          description="Choose a festival from the top menu to start saving picks."
        />
      </div>
    );
  }

  if (!currentProfile) {
    return (
      <div className="pb-5 max-w-[600px] mx-auto w-full" role="region" aria-label="My picks">
        <EmptyState
          icon={<UserPlus className="w-9 h-9" aria-hidden="true" />}
          title="No picks yet"
          description="Tap Must See, Want to See or Maybe on any set to start your plan. Your first pick joins the festival."
          cta={{ label: 'Browse Artists', onClick: () => navigate({ to: '/cards' }) }}
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
      <div role="tablist" aria-label="Picks views" className="flex gap-2 mb-3 overflow-x-auto">
        {viewTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
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
      </div>
    ) : null;

  // Reminders and notes can exist without picks, so these lists skip the empty state.
  if (view === 'reminders' || view === 'notes') {
    return (
      <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
        <div role="region" aria-label="My picks" className="max-w-[600px] mx-auto w-full">
          {actionButtons && <div className="flex justify-end gap-2 mb-3">{actionButtons}</div>}
          {viewTabRow}
          <PlanNotesList
            kind={view}
            items={view === 'reminders' ? reminderItems : noteItems}
            days={days}
            onOpenSet={setDetailSet}
          />
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
          {actionButtons && <div className="flex justify-end gap-2 mb-3">{actionButtons}</div>}
          {viewTabRow}
          <OfflineReadinessCard festivalId={currentFestival.id} className="mb-3" />
          <CrewSuggestionStrip />
          <PickBulkActions />
          <ListenList
            sets={pickedSets}
            days={days}
            festivalName={currentFestival.name}
            separator={currentFestival.b2bSeparator}
          />
          <EmptyState
            illustration="noPicks"
            title="No picks yet"
            description="Browse the lineup and tap the sets you want to see."
            cta={{ label: 'Browse the lineup', onClick: () => navigate({ to: '/cards' }) }}
          />
        </div>
      </RefreshableView>
    );
  }

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

  return (
    <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
      <div role="region" aria-label="My picks" className="max-w-[600px] mx-auto w-full">
        {actionButtons && <div className="flex justify-end gap-2 mb-3">{actionButtons}</div>}
        {viewTabRow}
        <CrewSuggestionStrip />
        <OfflineReadinessCard festivalId={currentFestival.id} className="mb-3" />

        {view === 'myday' && myDay && <MyDayList myDay={myDay} onOpenSet={setDetailSet} timeZone={timeZone} />}

        {view === 'plan' && (
          <>
        <div role="group" aria-label="Filter picks" className="flex flex-wrap gap-2 mb-3">
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
                  <PriorityIcon priority={c.priority} className="w-3.5 h-3.5" filled />
                </span>
              )}
              {c.clash && <TriangleAlert className="w-3.5 h-3.5 text-accent-coral" aria-hidden="true" />}
              {c.label}
              <Badge variant={c.priority ? PRIORITY_STYLE[c.priority].badge : 'count'}>{c.count}</Badge>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div
            role="radiogroup"
            aria-label="Group picks by"
            className="inline-flex rounded-full border border-border p-0.5"
          >
            {GROUP_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={groupMode === m.value}
                onClick={() => setGroupMode(m.value)}
                className={`rounded-full px-3 min-h-8 text-xs font-semibold cursor-pointer transition-colors ${
                  groupMode === m.value ? 'bg-bg-card-hover text-accent-aqua' : 'text-text-secondary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Order sets" className="inline-flex rounded-full border border-border p-0.5">
            {ORDERS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={order === o.value}
                onClick={() => setOrder(o.value)}
                className={`rounded-full px-3 min-h-8 text-xs font-semibold cursor-pointer transition-colors ${
                  order === o.value ? 'bg-bg-card-hover text-accent-aqua' : 'text-text-secondary'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[160px]">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter picks by artist or stage"
              aria-label="Filter my picks"
              className="w-full min-h-9 rounded-full border border-border bg-bg-card pl-9 pr-9 text-sm"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex min-h-8 min-w-8 items-center justify-center text-text-muted cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <PickConflicts groups={conflictGroups} />
        <PickBulkActions />
        <ListenList
          sets={pickedSets}
          days={days}
          festivalName={currentFestival.name}
          separator={currentFestival.b2bSeparator}
        />

        {rows.length === 0 && (
          <EmptyState
            icon={<CalendarX className="w-9 h-9" aria-hidden="true" />}
            title={clashOnlyEmpty ? COPY.clash.none : 'No matching picks'}
            description={
              clashOnlyEmpty
                ? "Nothing on your plan overlaps — you're all set."
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
            return <PicksPlanRow key={row.key} set={row.set} hasClash={clashIds.has(row.set.id)} />;
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
              <h3 key={row.key} className="flex items-center gap-2 mt-1 mb-3 pb-2.5 border-b border-border">
                {dot}
                <span className="text-sm font-medium text-text-secondary">{row.label}</span>
                {badge}
              </h3>
            );
          }
          return (
            <button
              key={row.key}
              type="button"
              aria-expanded={!row.collapsed}
              aria-label={`${row.label}, ${row.count} ${row.count === 1 ? 'pick' : 'picks'}`}
              onClick={() => toggleCollapsed(row.groupId)}
              className="flex items-center gap-2 w-full min-h-11 mt-2 mb-2 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 rounded-lg"
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
          </>
        )}
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
