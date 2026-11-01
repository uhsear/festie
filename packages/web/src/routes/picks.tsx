import { useMemo, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { usePicks, useFestival } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import {
  formatTime,
  byStartTime,
  artistDisplayName,
  resolveStageColor,
  isSetScheduled,
} from '@festie/shared/utils';
import StageBadge from '../components/ui/StageBadge';
import PriorityIcon from '../components/ui/PriorityIcon';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';
import RefreshableView from '../components/layout/RefreshableView';
import PickBulkActions from '../components/PickBulkActions';
import OfflineReadinessCard from '../components/features/OfflineReadinessCard';
import CrewSuggestionStrip from '../components/features/CrewSuggestionStrip';
import GuestTeaser from '../components/features/GuestTeaser';
import PickConflicts from '../components/features/PickConflicts';
// Lazy-loaded: SharePicksDialog pulls in qrcode.react, which has no business in the
// picks bundle until the user actually opens the share modal.
const SharePicksDialog = lazy(() => import('../components/features/SharePicksDialog'));
const CalendarDialog = lazy(() => import('../components/features/CalendarDialog'));
import { CalendarX, UserPlus } from 'lucide-react';

// Each section carries its priority value, label, the dot accent token, and the
// matching tint-ring Badge variant — mirroring the mobile Picks tab where every
// bucket (Must/Want/Maybe) shares one accent across its dot, count pill, and the
// set card's left border.
const PRIORITY_SECTIONS: Array<{
  value: Priority;
  label: string;
  accent: string;
  badge: 'must' | 'want' | 'maybe';
}> = [
  { value: 'must', label: PRIORITY_SYMBOLS['must'].label, accent: 'var(--color-priority-must)', badge: 'must' },
  { value: 'want-to-see', label: PRIORITY_SYMBOLS['want-to-see'].label, accent: 'var(--color-priority-want)', badge: 'want' },
  { value: 'maybe', label: PRIORITY_SYMBOLS['maybe'].label, accent: 'var(--color-priority-maybe)', badge: 'maybe' },
];

// Renders the real priority glyph inline so the hint text and the icon cannot drift apart.
function PickHint({ pri, word, tail }: { pri: Priority; word: string; tail: string }) {
  return (
    <>
      Tap <PriorityIcon priority={pri} className="inline w-3 h-3 align-[-2px]" />
      <span className="sr-only"> {word}</span> {tail}
    </>
  );
}

function PicksViewInner() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const sets = useFestivalStore((state) => state.sets);
  const days = useFestivalStore((state) => state.days);
  const selectedDay = useFestivalStore((state) => state.selectedDay);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const { getMyPick } = usePicks();
  const { getStageColor: getStageColorRaw, getStageName } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = useCallback(
    (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)'),
    [getStageColorRaw],
  );

  // Sets for the selected day, PLUS any unscheduled (TBA — schedule not yet
  // announced) picks. A pick on a set with an undefined/out-of-range dayIndex
  // matches no day tab under a plain `dayIndex === selectedDay` filter, so
  // without this OR it becomes permanently invisible and unremovable (see
  // docs/audits/tech-debt-2026-07-16-deep-findings.md, "Picks grouping/sorting
  // logic re-implemented (not shared) on web").
  const daySets = useMemo(() => {
    return sets.filter((s) => s.dayIndex === selectedDay || !isSetScheduled(s, days));
  }, [sets, selectedDay, days]);

  // Group picks by priority
  const picksGrouped = useMemo(() => {
    const groups: Record<Priority, typeof sets> = {
      must: [],
      'want-to-see': [],
      maybe: [],
    };

    daySets.forEach((set) => {
      const priority = getMyPick(set.id);
      if (priority && priority in groups) {
        groups[priority].push(set);
      }
    });

    // Sort each group by time, then name
    Object.keys(groups).forEach((key) => {
      groups[key as Priority].sort((a, b) => {
        return (
          byStartTime(a, b) ||
          artistDisplayName(a, currentFestival?.b2bSeparator).localeCompare(
            artistDisplayName(b, currentFestival?.b2bSeparator),
            undefined,
            { sensitivity: 'base' },
          )
        );
      });
    });

    return groups;
  }, [daySets, getMyPick, currentFestival?.b2bSeparator]);

  // True when the profile has any pick at all (across every day), which gates
  // the calendar export independently of the day filter — you can be on a day
  // with no picks and still export the whole festival plan.
  const hasAnyPicks = useMemo(
    () => !!currentProfile && sets.some((s) => currentProfile.picks?.[s.id]),
    [sets, currentProfile],
  );

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
          title="Join this festival first"
          description="Open the Schedule tab and tap Join festival to start saving picks."
          cta={{ label: 'Browse Artists', onClick: () => navigate({ to: '/cards' }) }}
        />
      </div>
    );
  }

  const totalPicksThisDay = picksGrouped.must.length + picksGrouped['want-to-see'].length + picksGrouped.maybe.length;

  // Global empty state: zero picks on this day → single friendly CTA pointing
  // at /cards, rather than three stacked "Tap X on…" hint blocks which looked
  // like broken/stuck UI on first visit.
  if (totalPicksThisDay === 0) {
    // Was a bespoke inline-styled block referencing legacy classes
    // (.empty-state-guide / .empty-state-icon) that have no CSS rule in
    // the React package — rendered as an un-styled stack of text on this
    // route. EmptyState matches /crew + /wrap + /timeline empty surfaces.
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

  return (
    <RefreshableView queryKeys={[['picks'], ['profiles']]} className="pb-5 h-full">
      <div role="region" aria-label="My picks" className="max-w-[600px] mx-auto w-full">
        {actionButtons && <div className="flex justify-end gap-2 mb-3">{actionButtons}</div>}
        <CrewSuggestionStrip />
        <PickConflicts />
        <OfflineReadinessCard festivalId={currentFestival.id} className="mb-3" />
        <PickBulkActions />
        {/* Priority sections */}
        {PRIORITY_SECTIONS.map(({ value: pri, label, accent, badge }) => {
          const items = picksGrouped[pri];
          return (
            <div key={pri} className="mb-4">
              {/* Mobile section-header pattern: round accent dot + label role text +
                tint-ring count pill, separated from the rows by a hairline divider. */}
              <h3 className="flex items-center gap-2 mb-3 pb-2.5 border-b border-border">
                <span style={{ color: accent }} className="inline-flex">
                  <PriorityIcon priority={pri} className="w-4 h-4" filled />
                </span>
                <span className="text-sm font-medium text-text-secondary">{label}</span>
                <Badge variant={badge} className="ml-auto">
                  {items.length}
                </Badge>
              </h3>

              {items.map((set) => {
                const sc = getStageColor(set.stageId);
                const sn = getStageName(set.stageId) || '';
                const dn = artistDisplayName(set, currentFestival?.b2bSeparator);
                const dayLabel = isSetScheduled(set, days) ? days[set.dayIndex ?? 0]?.label || '' : 'Unscheduled';

                return (
                  <button
                    key={set.id}
                    className="flex items-center gap-x-3 px-4 py-3 w-full text-left bg-bg-card border border-border rounded-xl mb-2 cursor-pointer transition-[background,transform] duration-200 ease-standard hover:bg-bg-card-hover active:scale-[0.97] motion-reduce:transition-none motion-reduce:transform-none focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
                    type="button"
                    aria-label={`${dn} — ${dayLabel}${set.startTime ? ' ' + formatTime(set.startTime) : ' TBA'}`}
                    onClick={() => setDetailSet(set)}
                  >
                    <div className="text-xs text-text-muted min-w-[100px] font-semibold tabular-nums">
                      {dayLabel}
                      {set.startTime ? ' ' + formatTime(set.startTime) : ' TBA'}
                    </div>
                    <div className="flex-1 text-sm font-bold min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {dn}
                    </div>
                    <StageBadge variant="pick" stageName={sn} stageColor={sc} />
                  </button>
                );
              })}

              {items.length === 0 && (
                // Collapsed empty state: a single muted helper line rather than a
                // full EmptyState per bucket — stacking three of those read as
                // broken/stuck UI once the user already had picks in another
                // bucket. The header + 0 badge above already signals "empty".
                <p className="px-1 py-1 text-xs text-text-muted">
                  {pri === 'must' ? (
                    <PickHint pri={pri} word="the star" tail="on any set to mark it as Must See." />
                  ) : pri === 'want-to-see' ? (
                    <PickHint pri={pri} word="the heart" tail="on sets you'd like to catch." />
                  ) : (
                    <PickHint pri={pri} word="the circle" tail="on sets you're considering." />
                  )}
                </p>
              )}
            </div>
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
