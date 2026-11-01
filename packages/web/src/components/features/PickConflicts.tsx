import { useMemo, useState } from 'react';
import { CalendarClock, TriangleAlert } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestival, useClashResolver } from '@festie/shared/hooks';
import { COPY } from '@festie/shared/constants';
import { Priority } from '@festie/shared/types';
import {
  buildPickConflicts,
  artistDisplayName,
  formatTime,
  fmtDurationMinutes,
  resolveStageColor,
} from '@festie/shared/utils';
import type { ConflictGroup, ConflictPick } from '@festie/shared/utils';
import StageBadge from '../ui/StageBadge';
import PriorityIcon from '../ui/PriorityIcon';
import Button from '../ui/Button';
import { useToast } from '../../lib/toastContext';
import { cn } from '@/lib/utils';

// Priority chip styling mirrors the Badge tint-ring roles (must=coral, want=aqua,
// maybe=amber) but inline here so the chip can sit tight against the time row.
const PRIORITY_CHIP: Record<Priority, { label: string; className: string }> = {
  must: { label: 'Must', className: 'bg-accent-coral/20 text-accent-coral' },
  'want-to-see': { label: 'Want', className: 'bg-accent-aqua/20 text-accent-aqua' },
  maybe: { label: 'Maybe', className: 'bg-accent-amber/20 text-accent-amber' },
};

/**
 * Schedule-clash advisory for the /picks view. Pulls the user's own picks for the
 * selected day from the festival store, runs the shared `buildPickConflicts` (the
 * single source of truth for overlap detection + keep-recommendation), and renders
 * one compact card per clash group. Each card offers Keep (drops the other picks),
 * Split (saves a plan line in the note of the set you leave) and Clear plan, all
 * through `useClashResolver`, with Undo in a toast. The artist name opens the
 * set's detail panel.
 *
 * Crew context (which crew members are on each side) is wired the same way
 * `useCrewNudges` gets it — `allProfiles` from the festival store + the active
 * crew's member ids — but only when there's an active crew; otherwise the shared
 * util leaves `crewCount` undefined and the card simply omits it.
 *
 * Renders nothing when there are no clashes.
 */
export default function PickConflicts() {
  const sets = useFestivalStore((state) => state.sets);
  const days = useFestivalStore((state) => state.days);
  const selectedDay = useFestivalStore((state) => state.selectedDay);
  const currentProfile = useFestivalStore((state) => state.currentProfile);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const allProfiles = useFestivalStore((state) => state.allProfiles);
  const stages = useFestivalStore((state) => state.stages);

  const activeCrew = useCrewStore((state) => state.activeCrew);
  const crewMembers = useCrewStore((state) => state.crewMembers);

  const setDetailSet = useUIStore((state) => state.setDetailSet);
  const { splitPlan, plannedSplit, keep, split, clearSplit } = useClashResolver();
  const { toast, toastUndo, toastError } = useToast();
  const [busy, setBusy] = useState(false);
  const { getStageName, getStageColor: getStageColorRaw } = useFestival();
  // Map shared's platform-neutral fallback sentinel to the web muted CSS var.
  const getStageColor = (stageId: string) => resolveStageColor(getStageColorRaw(stageId), 'var(--text-muted)');

  const b2bSeparator = currentFestival?.b2bSeparator;
  const myUserId = currentProfile?.userId;
  const myPicks = currentProfile?.picks;
  const timeZone = currentFestival?.timeZone;

  const groups = useMemo<ConflictGroup[]>(() => {
    if (!myPicks) return [];
    // Crew context only when there's an active crew (mirrors useCrewNudges); the
    // shared util gates on all three being present before populating crewCount.
    const wantCrew = !!activeCrew && !!myUserId;
    return buildPickConflicts({
      sets,
      myPicks,
      selectedDay,
      days,
      timeZone,
      stages,
      ...(wantCrew
        ? {
            allProfiles,
            crewMemberUserIds: new Set(crewMembers.map((m) => m.userId)),
            myUserId,
          }
        : {}),
    });
  }, [sets, myPicks, selectedDay, days, timeZone, stages, activeCrew, myUserId, allProfiles, crewMembers]);

  if (groups.length === 0) return null;

  // Find the set object behind a clashing pick so we can open its detail panel.
  const openSet = (pick: ConflictPick) => {
    const full = sets.find((s) => s.id === pick.set.id) ?? pick.set;
    setDetailSet(full);
  };

  const run = async (action: () => Promise<{ message: string; undo: () => Promise<void> }>) => {
    setBusy(true);
    try {
      const result = await action();
      toastUndo(result.message, () => {
        result.undo().catch(() => toast(COPY.clash.failed, 'error'));
      });
    } catch (err) {
      toastError(err, COPY.clash.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-3 flex flex-col gap-3" aria-label="Schedule clashes">
      {groups.map((group, gi) => {
        const plan = splitPlan(group);
        const planned = plannedSplit(group);
        const first = group.pairs[0];
        const walk = group.picks.length === 2 ? first?.walkMinutes : null;
        const walkText = walk && walk > 0 ? `${walk} min walk` : null;
        const meta = group.tight
          ? [first?.gapMinutes ? `${first.gapMinutes} min gap` : 'Back to back', walkText].filter(Boolean).join(' · ')
          : [group.overlapMin > 0 ? `${fmtDurationMinutes(group.overlapMin)} overlap` : null, walkText]
              .filter(Boolean)
              .join(' · ');

        return (
          <article
            key={`${group.recommendedKeepId}-${gi}`}
            className="rounded-xl border border-priority-must/40 bg-bg-card p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 shrink-0 text-priority-must" aria-hidden="true" />
              <h3 className="text-sm font-bold text-text-primary">
                {group.tight ? COPY.clash.tight : COPY.clash.one}
              </h3>
              {planned && (
                <span className="shrink-0 rounded-full bg-accent-aqua/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-accent-aqua">
                  {COPY.clash.splitPlanned}
                </span>
              )}
              {meta && (
                <span className="ml-auto text-xs font-semibold text-text-muted tabular-nums">{meta}</span>
              )}
            </div>

            <ul className="flex flex-col gap-2">
              {group.picks.map((pick) => {
                const isKeep = pick.set.id === group.recommendedKeepId;
                const dn = artistDisplayName(pick.set, b2bSeparator);
                const stageName = getStageName(pick.set.stageId) || pick.set.stageName || 'Stage';
                const stageColor = getStageColor(pick.set.stageId);
                const chip = PRIORITY_CHIP[pick.priority];
                const startLabel = pick.set.startTime ? formatTime(pick.set.startTime) : 'TBA';
                const endLabel = pick.set.endTime ? formatTime(pick.set.endTime) : '';
                const timeRange = endLabel ? `${startLabel} – ${endLabel}` : startLabel;

                return (
                  <li
                    key={pick.set.id}
                    className={cn(
                      'rounded-lg border px-3 py-2',
                      // Recommended keep uses the aqua accent (NOT coral — coral is
                      // danger/SOS only). A faint aqua wash + ring marks it.
                      isKeep ? 'border-accent-aqua/60 bg-accent-aqua/5' : 'border-border bg-bg-card',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={cn(
                          'min-h-[44px] truncate text-left text-sm font-bold text-text-primary hover:text-accent-aqua',
                          'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                        )}
                        aria-label={`Open details for ${dn}`}
                        onClick={() => openSet(pick)}
                      >
                        {dn}
                      </button>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]',
                          chip.className,
                        )}
                      >
                        <PriorityIcon priority={pick.priority} className="h-3 w-3" filled />
                        {chip.label}
                      </span>
                      {isKeep && (
                        <span className="shrink-0 rounded-full bg-accent-aqua/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-accent-aqua">
                          {COPY.clash.suggested}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="tabular-nums">{timeRange}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{fmtDurationMinutes(pick.durationMin)}</span>
                      <StageBadge variant="pick" stageName={stageName} stageColor={stageColor} />
                    </div>

                    {typeof pick.crewCount === 'number' && pick.crewCount > 0 && (
                      <div className="mt-1 text-xs text-text-secondary">
                        {pick.crewCount} crew going{pick.crewBreakdown ? ` — ${pick.crewBreakdown}` : ''}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {(planned || plan) && (
              <p className="mt-2 text-xs text-text-secondary">{planned ?? plan?.sentence}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {group.picks.map((pick) => {
                const dn = artistDisplayName(pick.set, b2bSeparator);
                const others = group.picks.length - 1;
                return (
                  <Button
                    key={pick.set.id}
                    variant="secondary"
                    size="sm"
                    className="min-h-[44px]"
                    disabled={busy}
                    aria-label={`Keep ${dn} and remove the other ${others === 1 ? 'pick' : `${others} picks`}`}
                    onClick={() => run(() => keep(group, pick.set.id))}
                  >
                    Keep {dn}
                  </Button>
                );
              })}
              {planned ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-[44px]"
                  disabled={busy}
                  onClick={() => run(() => clearSplit(group))}
                >
                  {COPY.clash.clearPlan}
                </Button>
              ) : (
                plan && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-[44px]"
                    disabled={busy}
                    aria-label={`Split: ${plan.sentence}`}
                    onClick={() => run(() => split(group))}
                  >
                    {COPY.clash.split}
                  </Button>
                )
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
