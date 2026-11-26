import React, { memo, useEffect, useRef, useState, useMemo } from 'react';
import { Play, AlertTriangle, StickyNote, ArrowRightLeft } from 'lucide-react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { useMyPick, useMyNote, usePickActions, usePickSync, usePickClear, useSetMove } from '@festie/shared/hooks';
import { formatTime, formatSetTimeRange, artistDisplayName, artistSubtitle, festivalPhase, isAfterMidnight, primarySpotifyArtist, PRIORITY_RANK } from '@festie/shared/utils';
import { useFestivalStore, useCrewStore } from '@festie/shared/stores';
import { useSetStatus } from '@/hooks/useSetStatus';
import { useUndoNotifier } from '@/hooks/useUndoNotifier';
import { useHaptics } from '@/hooks/useHaptics';
import { cn } from '@/lib/utils';
import LiveBadge from './LiveBadge';
import SetPickControl from './SetPickControl';
import ArtistName from './ArtistName';
import CrewOverlapAvatars from './CrewOverlapAvatars';
import ClashHatch from '../ui/ClashHatch';

interface SetCardProps {
  set: FestivalSet;
  onTap: () => void;
  onPreview?: () => void;
  showPicks?: boolean;
  /** True while the profile loads: grey placeholders hold the pick buttons' place. */
  picksLoading?: boolean;
  stageName?: string;
  stageColor?: string;
  friendProfiles?: Array<{
    profileId?: string;
    name?: string;
    avatarUrl?: string | null;
    priority: Priority;
    color?: string;
    initials?: string;
  }>;
  clashLabel?: string | null;
  b2bSeparator?: string;
}

const NO_PROFILES: ReturnType<typeof useFestivalStore.getState>['allProfiles'] = [];
const NO_MEMBERS: ReturnType<typeof useCrewStore.getState>['crewMembers'] = [];

const PRI_MAP:Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

function SetCard({
  set,
  onTap,
  onPreview,
  showPicks = true,
  picksLoading = false,
  stageName = set.stageName || 'Unknown',
  stageColor = 'var(--color-stage-fallback)',
  friendProfiles = [],
  clashLabel,
  b2bSeparator,
}: SetCardProps) {
  const myPick = useMyPick(set.id);
  const myNote = useMyNote(set.id);
  const { savePick } = usePickActions();
  const { sync: pickSync, retry: retryPick } = usePickSync(set.id);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  // Read-only joins for the crew-overlap cluster: profiles supply the
  // profileId -> userId link, crew members supply the avatar image. Both are
  // already persisted (Foundations F1), so the cluster renders offline.
  // Only a card that shows friends reads them, so a crew mate's pick re-renders just those cards.
  const hasFriends = friendProfiles.length > 0;
  const allProfiles = useFestivalStore((state) => (hasFriends ? state.allProfiles : NO_PROFILES));
  const crewMembers = useCrewStore((state) => (hasFriends ? state.crewMembers : NO_MEMBERS));
  const clearPick = usePickClear(useUndoNotifier());
  const { tap, select, warning } = useHaptics();
  const [saving, setSaving] = useState(false);
  const setStatus = useSetStatus(set);
  const move = useSetMove(set);
  const days = useFestivalStore((state) => state.days);
  // Dim ended sets only while the festival is running; before/after, every set reads the same.
  const dimmed = setStatus.status === 'past' && festivalPhase(currentFestival, days) === 'live';
  const cardRef = useRef<HTMLDivElement | null>(null);

  // R12: spotlight follows the pointer. Writes CSS vars straight to the node
  // (no React state, so no render per mousemove), one write per frame, and
  // only for a real hover pointer.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    const setPos = (x: string, y: string) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.setProperty('--mx', x);
        card.style.setProperty('--my', y);
      });
    };
    const onMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      setPos(`${e.clientX - rect.left}px`, `${e.clientY - rect.top}px`);
    };
    const onLeave = () => setPos('50%', '50%');
    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      card.removeEventListener('mousemove', onMove);
      card.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const artistName = artistDisplayName(set, b2bSeparator);
  const subtitle = artistSubtitle(set, b2bSeparator);

  const pri = myPick ? PRI_MAP[myPick] : null;
  const hasConflict = !!clashLabel;

  // Enrich + group the crew-overlap cluster:
  //  1. join each friend (profileId -> profile.userId -> crewMember.avatar) to
  //     pull a real avatar image, falling back to the name/initials already on
  //     the friend profile when the member isn't in the persisted crew roster;
  //  2. sort must > want > maybe so the cluster reads priority-first.
  // Pure reads of already-persisted state, so this stays correct offline.
  const groupedFriends = useMemo(() => {
    if (friendProfiles.length === 0) return [];
    const userIdByProfileId = new Map<string, string>();
    for (const p of allProfiles) userIdByProfileId.set(p.id, p.userId);
    const memberByUserId = new Map<string, (typeof crewMembers)[number]>();
    for (const m of crewMembers) memberByUserId.set(m.userId, m);

    return friendProfiles
      .map((f) => {
        const userId = f.profileId ? userIdByProfileId.get(f.profileId) : undefined;
        const member = userId ? memberByUserId.get(userId) : undefined;
        return {
          ...f,
          // Prefer a synced crew avatar; fall back to whatever the caller
          // supplied (which may be undefined → Avatar renders initials).
          avatarUrl: f.avatarUrl ?? null,
          name: f.name ?? member?.name,
        };
      })
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  }, [friendProfiles, allProfiles, crewMembers]);

  const handlePriorityChange = async (priority: string, currentlyActive: boolean) => {
    // Haptic tick fires BEFORE the optimistic store update so the vibration
    // aligns with the finger lift, not the server round-trip. savePick is
    // already optimistic (see festivalStore.savePick) so the star fills
    // instantly either way — haptic just reinforces the state change.
    select();
    if (currentlyActive) {
      clearPick(set.id, artistName);
      return;
    }
    setSaving(true);
    try {
      if (currentFestival) {
        await savePick(currentFestival.id, set.id, priority as Priority);
      }
    } catch {
      // The failed-pick chip under the priority row is the visible error.
      warning();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        // Keep CSS class names for container query selectors (Phase 4 cleanup)
        'set-card',
        // Base styles: tonal card (DESIGN.md: glass is chrome only). Time leads and a 6px stage
        // rail on the left carries the stage colour, with the stage name in text-primary.
        'relative bg-bg-card border border-glass-border rounded-lg',
        'p-4 pl-6 cursor-pointer overflow-hidden',
        // Tailwind writes -translate-y-* to `translate`, so the list names `translate`.
        'transition-[background-color,box-shadow,translate] duration-(--duration-med) ease-(--ease-out)',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        // Hover — gentle lift + surface shift + light glow (no heavy drop shadow).
        // R12: Aqua spotlight effect with 200ms ease-out transition.
        'hover:bg-bg-card-hover hover:-translate-y-0.5',
        'hover:shadow-[0_0_12px_var(--color-aqua-a25),0_0_1px_var(--color-aqua-a4)]',
        // R12: Radial spotlight gradient via ::after pseudo-element.
        'after:content-[""] after:absolute after:inset-0 after:rounded-[inherit]',
        'after:opacity-0 after:transition-opacity after:duration-(--duration-med) after:pointer-events-none',
        'after:pointer-events-none',
        'hover:after:opacity-100',
        // R19: Animated gradient border when set is live (single featured card on screen).
        setStatus.status === 'live' && 'live',
        // Priority variants — lighter, static glow (no infinite pulse for list perf).
        pri === 'must' && ['priority-must', 'shadow-[var(--shadow-glow-coral)]'],
        pri === 'want' && ['priority-want', 'shadow-[var(--shadow-glow-aqua)]'],
        pri === 'maybe' && ['priority-maybe', 'shadow-[var(--shadow-glow-amber)]'],
        // Conflict marker class (for tests + potential styling)
        hasConflict && 'has-conflict',
      )}
      data-testid="set-card"
      data-artist={artistName}
    >
      {/* Click/keyboard target — positioned absolute to fill the card so the
          outer div can stay non-interactive (avoids nested-interactive axe
          violation when footer buttons render as children). Footer buttons
          are positioned above via z-index. */}
      <button
        type="button"
        className={cn(
          'set-card-click-target',
          'absolute inset-0 z-[1] cursor-pointer border-0 bg-transparent p-0 m-0',
          'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-[-2px] focus-visible:rounded-[inherit]',
        )}
        aria-label={`${artistName} — ${stageName}, ${
          set.startTime && set.endTime ? `${formatTime(set.startTime)} to ${formatTime(set.endTime)}` : 'time TBA'
        }${move ? `, ${move.a11y}` : ''}`}
        onClick={() => {
          tap();
          onTap();
        }}
      />

      {/* Stage rail: decorative colour. The stage name below carries the meaning in text-primary. */}
      <span
        data-testid="set-card-rail"
        aria-hidden="true"
        className="card-rail pointer-events-none absolute inset-y-0 left-0 w-1.5"
        style={{ background: dimmed ? 'var(--color-overlay-3)' : stageColor }}
      />

      {/* Listen: an icon button in the top-right corner, above the click target. Opens the set with the player open. */}
      {primarySpotifyArtist(set) && (
        <button
          className={cn(
            'card-preview-btn',
            'absolute top-2 right-2 z-[2]',
            'border bg-[var(--color-overlay-3)] border-border-light text-text-secondary hover:text-text-primary',
            'size-11 rounded-full cursor-pointer',
            'flex items-center justify-center',
            'transition-[background-color,border-color] duration-(--duration-med)',
          )}
          type="button"
          aria-label={`Listen to ${artistName}`}
          onClick={(e) => {
            e.stopPropagation();
            tap();
            (onPreview ?? onTap)();
          }}
        >
          <Play className="w-4 h-4" fill="currentColor" aria-hidden="true" />
        </button>
      )}

      {/* Decorative: the artist, stage and time are already announced by the click-target
          button's aria-label, so these visible copies are aria-hidden to avoid double-announcing. */}
      <div
        className={cn(
          'card-time',
          'relative z-[2] pointer-events-none flex items-baseline gap-2 flex-wrap',
          'type-title tabular-nums',
          primarySpotifyArtist(set) && 'pr-11',
          dimmed ? 'text-text-secondary' : 'text-text-primary',
        )}
        aria-hidden="true"
      >
        <span>{formatSetTimeRange(set) || 'TBA'}</span>
        {isAfterMidnight(set, days) && (
          <span className="text-[length:var(--font-size-12)] font-semibold uppercase tracking-wide text-text-muted">
            Late
          </span>
        )}
      </div>

      <div
        className={cn(
          'card-stage',
          'relative z-[2] pointer-events-none max-w-full truncate mb-2',
          'type-caption font-semibold',
          dimmed ? 'text-text-secondary' : 'text-text-primary',
        )}
        aria-hidden="true"
      >
        {stageName}
      </div>

      {/* Artist name */}
      <div
        className={cn(
          'card-artist',
          'relative z-[2] pointer-events-none',
          'type-title font-bold leading-[1.15] mb-1 break-words',
          dimmed ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        <ArtistName set={set} separator={b2bSeparator} />
      </div>
      {subtitle && (
        <div
          className={cn(
            'card-artist-sub',
            'relative z-[2] pointer-events-none',
            'text-[length:var(--font-size-12)] font-medium leading-[1.35] text-text-muted mt-0.5',
            'overflow-hidden text-ellipsis',
            '[-webkit-line-clamp:2] [-webkit-box-orient:vertical] [display:-webkit-box]',
            'break-words max-h-[2.7em]',
          )}
          aria-hidden="true"
        >
          {subtitle}
        </div>
      )}

      {/* Indicators: note, clash and move. Only mounted when there is one. */}
      {(myNote || hasConflict || move) && (
        <div className={cn('card-indicators', 'relative z-[2] pointer-events-none', 'flex items-center gap-2 flex-wrap', 'type-caption text-text-secondary mt-1')}>
          {myNote && (
            <span className="card-note-indicator inline-flex opacity-50" role="img" aria-label="Has note">
              <StickyNote className="w-4 h-4" aria-hidden="true" />
            </span>
          )}
          {hasConflict && (
            <span
              className={cn(
                'inline-flex items-center gap-1 max-w-full',
                'text-[length:var(--font-size-12)] font-bold py-0.5 px-1.5 rounded-sm leading-tight',
                'bg-[var(--color-clash-tint)] text-text-primary',
              )}
              title={clashLabel}
            >
              <ClashHatch className="h-4 w-1.5" />
              <span className="max-w-full truncate">{clashLabel}</span>
            </span>
          )}
          {move && (
            <span
              data-testid="set-moved-chip"
              aria-hidden="true"
              title={move.line}
              className="inline-flex items-center gap-1 text-[length:var(--font-size-12)] font-bold py-0.5 px-1.5 rounded-sm leading-tight border border-border text-text-secondary"
            >
              <ArrowRightLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
              {move.chip}
            </span>
          )}
        </div>
      )}

      {/* Live badge */}
      {['live', 'soon', 'upcoming'].includes(setStatus.status) && (
        <LiveBadge status={setStatus.status} label={setStatus.label} />
      )}

      {/* Footer with the pick control and crew overlap */}
      <div className={cn('card-footer', 'relative z-[2]', 'flex flex-wrap gap-y-2 items-center justify-between mt-3')}>
        {showPicks && (
          <SetPickControl
            artistName={artistName}
            myPick={myPick}
            syncState={pickSync?.state === 'saving' || pickSync?.state === 'queued' ? pickSync.state : null}
            disabled={saving}
            onSelect={handlePriorityChange}
          />
        )}

        {!showPicks && picksLoading && (
          <div className="flex gap-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skeleton-shimmer w-11 h-11 rounded-full" />
            ))}
          </div>
        )}

        {/* Crew overlap / who's going */}
        {groupedFriends.length > 0 && <CrewOverlapAvatars friends={groupedFriends} artistName={artistName} onClick={onTap} />}
      </div>

      {showPicks && pickSync?.state === 'failed' && (
        <div className="relative z-[2] mt-2 inline-flex items-center gap-2 text-xs font-medium text-accent-amber">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          <span>Pick not saved.</span>
          <button
            type="button"
            className="min-h-[44px] min-w-[44px] px-2 underline cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              retryPick().catch(() => warning());
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Shallow-compare the props that actually affect rendered output.
 *
 * Callback props (onTap, onPreview) are intentionally skipped — parent
 * components pass inline arrows whose references change every render, but
 * whose behavior is stable (they close over the same set object captured in
 * the loop). Comparing them would defeat memoization entirely.
 *
 * Array props (friendProfiles) are compared by length + element
 * identity so we re-render when the list content changes but not when the
 * parent builds a new array reference with identical items.
 */
function setCardPropsAreEqual(prev: Readonly<SetCardProps>, next: Readonly<SetCardProps>): boolean {
  // Core identity — if the set changed, re-render
  if (prev.set.id !== next.set.id) return false;

  // Set data that affects display (updatedAt covers field mutations)
  if (prev.set.updatedAt !== next.set.updatedAt) return false;
  if (prev.set.startTime !== next.set.startTime) return false;
  if (prev.set.endTime !== next.set.endTime) return false;
  if (prev.set.movedAt !== next.set.movedAt) return false;

  // Visual props
  if (prev.stageColor !== next.stageColor) return false;
  if (prev.stageName !== next.stageName) return false;
  if (prev.showPicks !== next.showPicks) return false;
  if (prev.picksLoading !== next.picksLoading) return false;
  if (prev.b2bSeparator !== next.b2bSeparator) return false;

  // friendProfiles — compare length + element identity
  const prevFriends = prev.friendProfiles ?? [];
  const nextFriends = next.friendProfiles ?? [];
  if (prevFriends.length !== nextFriends.length) return false;
  for (let i = 0; i < prevFriends.length; i++) {
    const pf = prevFriends[i]!;
    const nf = nextFriends[i]!;
    if (pf.profileId !== nf.profileId || pf.priority !== nf.priority) return false;
  }

  if (prev.clashLabel !== next.clashLabel) return false;

  return true;
}

export default memo(SetCard, setCardPropsAreEqual);
