import { useMemo, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { usePicksPlan } from '@festie/shared/hooks';
import type { Priority } from '@festie/shared/types';
import { COPY } from '@festie/shared/constants';
import type { PicksFilter, PicksGroupMode, PicksOrder } from '@festie/shared/utils';
import { buildPicksIcs, buildPicksShareUrl } from '@festie/shared/utils';
import PriorityIcon from '../components/ui/PriorityIcon';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import RefreshableView from '../components/layout/RefreshableView';
import PickBulkActions from '../components/PickBulkActions';
import OfflineReadinessCard from '../components/features/OfflineReadinessCard';
import CrewSuggestionStrip from '../components/features/CrewSuggestionStrip';
import GuestTeaser from '../components/features/GuestTeaser';
import PickConflicts from '../components/features/PickConflicts';
import PicksPlanRow from '../components/features/PicksPlanRow';
// Lazy-loaded: PlanQRShare pulls in qrcode.react, which has no business in the
// picks bundle until the user actually opens the share modal.
const PlanQRShare = lazy(() => import('../components/features/PlanQRShare'));
import { useToast } from '../lib/toastContext';
import { CalendarX, UserPlus, CalendarPlus, Share2, TriangleAlert, ChevronDown, Search, X } from 'lucide-react';

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
  const stages = useFestivalStore((state) => state.stages);
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
  const { toast } = useToast();

  // True when the profile has any pick at all, which gates the calendar export
  // independently of the active filters.
  const hasAnyPicks = useMemo(
    () => !!currentProfile && sets.some((s) => currentProfile.picks?.[s.id]),
    [sets, currentProfile],
  );

  // Build the user's picks into an RFC-5545 .ics and trigger a browser
  // download. Mirrors the mobile Picks export (same shared buildPicksIcs over
  // the already-loaded store data — fully client-side, no server round-trip);
  // mobile hands the file to the OS share sheet, the web equivalent is a Blob
  // download. Exports ALL picks, regardless of the active filters.
  const handleExportCalendar = useCallback(() => {
    if (!currentFestival || !currentProfile) return;
    const ics = buildPicksIcs({
      festival: {
        id: currentFestival.id,
        name: currentFestival.name,
        location: currentFestival.location,
      },
      sets,
      stages,
      picks: currentProfile.picks,
      notes: currentProfile.notes,
    });
    const safeName = (currentFestival.name || 'festival').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_picks.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [currentFestival, currentProfile, sets, stages]);

  // Share a public, read-only link to my picks (server route GET /s/:profileId).
  // Mirrors the mobile Picks share: native share sheet where available,
  // clipboard copy as the desktop fallback.
  const handleSharePicks = useCallback(async () => {
    if (!currentProfile || !currentFestival) return;
    const url = buildPicksShareUrl(currentProfile.id);
    const text = `My ${currentFestival.name} picks on Festie`;
    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
      canShare?: (data: ShareData) => boolean;
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: text, text, url });
        return;
      } catch (err) {
        // AbortError = user dismissed the sheet; don't fall through to clipboard.
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied to clipboard', 'success');
    } catch {
      toast("Couldn't share link. Try again.", 'error');
    }
  }, [currentProfile, currentFestival, toast]);

  const actionButtons = hasAnyPicks ? (
    <>
      <Button variant="secondary" size="sm" type="button" onClick={handleSharePicks} aria-label="Share my picks">
        <Share2 className="w-4 h-4" aria-hidden="true" />
        Share picks
      </Button>
      {/* Offline-native QR handoff (mirrors mobile PlanQRShare). Suspense fallback
          is the share-picks button row above, so nothing flashes while it loads. */}
      <Suspense fallback={null}>
        <PlanQRShare />
      </Suspense>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={handleExportCalendar}
        aria-label="Add picks to calendar"
      >
        <CalendarPlus className="w-4 h-4" aria-hidden="true" />
        Add to calendar
      </Button>
    </>
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
          title="Join this festival first"
          description="Open the Schedule tab and tap Join festival to start saving picks."
          cta={{ label: 'Browse Artists', onClick: () => navigate({ to: '/cards' }) }}
        />
      </div>
    );
  }

  // Global empty state: zero picks → single friendly CTA pointing at /cards,
  // rather than stacked hint blocks which looked like broken/stuck UI on first visit.
  if (stats.total === 0) {
    return (
      <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
        <div role="region" aria-label="My picks" className="max-w-[600px] mx-auto w-full">
          {actionButtons && <div className="flex justify-end gap-2 mb-3">{actionButtons}</div>}
          <OfflineReadinessCard festivalId={currentFestival.id} className="mb-3" />
          <CrewSuggestionStrip />
          <PickBulkActions />
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
        <CrewSuggestionStrip />
        <OfflineReadinessCard festivalId={currentFestival.id} className="mb-3" />

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
      </div>
    </RefreshableView>
  );
}

export default function PicksView() {
  return (
    <RenderErrorBoundary name="picks">
      <PicksViewInner />
    </RenderErrorBoundary>
  );
}
