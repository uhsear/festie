import React, { memo, useRef, useState, useEffect, useMemo } from 'react';
import { Play, Square, AlertTriangle, StickyNote, Clock } from 'lucide-react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { usePicks, usePickSync } from '@festie/shared/hooks';
import { formatTime, artistDisplayName, artistSubtitle, festivalPhase, PRIORITY_RANK } from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { useFestivalStore, useCrewStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services/api';
import { useSetStatus } from '@/hooks/useSetStatus';
import { useToast } from '@/lib/toastContext';
import { useHaptics } from '@/hooks/useHaptics';
import { cn } from '@/lib/utils';
import LiveBadge from './LiveBadge';
import PriorityIcon from '../ui/PriorityIcon';
import CrewOverlapAvatars from './CrewOverlapAvatars';
import { ensureWhiteContrast } from '../ui/StageBadge';

interface SpotifyPreviewResponse {
  /** Direct mp3 URL if the backend has one. */
  url?: string;
  /** Fallback embed URL (real /spotify/preview/:setId response shape). */
  embedUrl?: string;
  embedType?: 'track' | 'artist' | null;
}

interface SetCardProps {
  set: FestivalSet;
  onTap: () => void;
  onPreview?: () => void;
  showPicks?: boolean;
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
  conflicts?: FestivalSet[];
  b2bSeparator?: string;
}

const PRI_MAP: Record<string, string> = {
  must: 'must',
  'want-to-see': 'want',
  maybe: 'maybe',
};

function SetCard({
  set,
  onTap,
  onPreview,
  showPicks = true,
  stageName = set.stageName || 'Unknown',
  stageColor = 'var(--color-accent-coral)',
  friendProfiles = [],
  conflicts = [],
  b2bSeparator,
}: SetCardProps) {
  const { getMyPick, savePick, getMyNote } = usePicks();
  const { sync: pickSync, retry: retryPick } = usePickSync(set.id);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  // Read-only joins for the crew-overlap cluster: profiles supply the
  // profileId -> userId link, crew members supply the avatar image. Both are
  // already persisted (Foundations F1), so the cluster renders offline.
  const allProfiles = useFestivalStore((state) => state.allProfiles);
  const crewMembers = useCrewStore((state) => state.crewMembers);
  const { toast } = useToast();
  const { tap, select, warning } = useHaptics();
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioListenersRef = useRef<{ ended: () => void; error: () => void } | null>(null);
  const setStatus = useSetStatus(set);
  const days = useFestivalStore((state) => state.days);
  // Dim ended sets only while the festival is running; before/after, every set reads the same.
  const dimmed = setStatus.status === 'past' && festivalPhase(currentFestival, days) === 'live';
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [spotlightPos, setSpotlightPos] = useState({ x: '50%', y: '50%' });

  // Cleanup audio element and its event listeners on unmount to prevent leaks.
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
        if (audioListenersRef.current) {
          audio.removeEventListener('ended', audioListenersRef.current.ended);
          audio.removeEventListener('error', audioListenersRef.current.error);
        }
        audioRef.current = null;
        audioListenersRef.current = null;
      }
    };
  }, []);

  // R12: Spotlight hover effect — mousemove listener updates CSS vars
  // for radial gradient spotlight. Desktop-only via @media (hover: hover).
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setSpotlightPos({
      x: `${x}px`,
      y: `${y}px`,
    });
  };

  const handleMouseLeave = () => {
    // Reset to center on leave (will fade out via CSS transition)
    setSpotlightPos({ x: '50%', y: '50%' });
  };

  const myPick = getMyPick(set.id);
  const myNote = getMyNote(set.id);
  const artistName = artistDisplayName(set, b2bSeparator);
  const subtitle = artistSubtitle(set, b2bSeparator);

  const pri = myPick ? PRI_MAP[myPick] : null;
  const hasConflict = conflicts.length > 0;

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
    setSaving(true);
    try {
      if (currentFestival) {
        await savePick(currentFestival.id, set.id, currentlyActive ? null : (priority as Priority));
      }
    } catch {
      // The failed-pick chip under the priority row is the visible error.
      warning();
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewClick = async (e: React.MouseEvent) => {
    // Keep the outer card-click handler from firing (task: don't open detail).
    e.stopPropagation();
    e.preventDefault();

    // Toggle stop if already playing.
    if (previewPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPreviewPlaying(false);
      return;
    }

    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const data = await api.get<SpotifyPreviewResponse>(`/spotify/preview/${set.id}`);
      // Prefer a direct mp3 URL (task contract). Fall back to the real
      // /spotify/preview response shape which returns embedUrl for non-mp3
      // Spotify embeds — we can't inline-play those via <audio>, so surface
      // a friendly "No preview" and let users open the detail panel.
      const src = data?.url;
      if (!src) {
        if (data?.embedType) {
          // No 30-sec clip but Spotify embed is available — open detail panel
          // with Spotify auto-expanded (via onPreview), or fall back to onTap.
          (onPreview ?? onTap)();
        } else {
          setPreviewError('No preview');
          toast('No preview available', 'info');
        }
        return;
      }
      if (!audioRef.current) {
        audioRef.current = new Audio();
        const onEnded = () => setPreviewPlaying(false);
        const onError = () => {
          setPreviewPlaying(false);
          setPreviewError('Playback failed');
        };
        audioRef.current.addEventListener('ended', onEnded);
        audioRef.current.addEventListener('error', onError);
        audioListenersRef.current = { ended: onEnded, error: onError };
      }
      audioRef.current.src = src;
      await audioRef.current.play();
      setPreviewPlaying(true);
    } catch {
      setPreviewError('No preview');
      toast('No preview available', 'info');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        // Keep CSS class names for container query selectors (Phase 4 cleanup)
        'set-card',
        // Base styles — tonal card (DESIGN.md: glass is chrome only). Stage
        // identity is carried by the stage pill (not a left stripe, which reads
        // as an AI tell). Softer radius + density.
        'relative bg-bg-card border border-glass-border rounded-xl',
        'p-4 cursor-pointer overflow-hidden',
        // Transition + will-change — token-eased, reduce-motion safe.
        'transition-[background-color,box-shadow,transform] duration-200 ease-out will-change-transform',
        'motion-reduce:transition-none motion-reduce:transform-none',
        // Hover — gentle lift + surface shift + light glow (no heavy drop shadow).
        // R12: Aqua spotlight effect with 200ms ease-out transition.
        'hover:bg-bg-card-hover hover:-translate-y-0.5',
        'hover:shadow-[0_0_12px_rgba(0,232,208,0.25),0_0_1px_rgba(0,232,208,0.4)]',
        'transition-shadow duration-200 ease-out',
        // R12: Radial spotlight gradient via ::after pseudo-element.
        'after:content-[""] after:absolute after:inset-0 after:rounded-[inherit]',
        'after:opacity-0 after:transition-opacity after:duration-200 after:pointer-events-none',
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
      style={
        {
          // R12: CSS vars for radial spotlight gradient
          '--mx': spotlightPos.x,
          '--my': spotlightPos.y,
        } as React.CSSProperties
      }
      data-testid="set-card"
      data-artist={artistName}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
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
        }`}
        onClick={() => {
          tap();
          onTap();
        }}
      />

      {/* Spotify preview button — top-right corner, above click target */}
      {set.artists?.some((a) => a.links?.spotify) && (
        <button
          className={cn(
            'card-preview-btn',
            'absolute top-2 right-2 z-[2]',
            'border',
            previewPlaying
              ? 'bg-spotify/20 border-spotify/40 text-spotify'
              : 'bg-[var(--color-overlay-3)] border-border-light text-text-secondary hover:text-text-primary',
            'rounded-full w-11 h-11 text-sm cursor-pointer',
            'flex items-center justify-center',
            'transition-[background-color,border-color] duration-150',
          )}
          type="button"
          aria-label={previewPlaying ? `Stop preview for ${artistName}` : `Preview ${artistName}`}
          title={previewError || (previewPlaying ? 'Stop preview' : 'Play preview')}
          disabled={previewLoading}
          onClick={handlePreviewClick}
        >
          {previewPlaying ? (
            <Square className="w-4 h-4" fill="currentColor" aria-hidden="true" />
          ) : (
            <Play className="w-4 h-4" fill="currentColor" aria-hidden="true" />
          )}
        </button>
      )}

      {/* Decorative — the artist/stage/time are already announced via the
          click-target button's aria-label, so these visible copies are
          aria-hidden to avoid double-announcing each set to screen readers. */}
      <span
        className={cn(
          'card-stage',
          'relative z-[2] inline-block px-2 py-1 rounded-xl',
          'type-micro font-bold uppercase tracking-[0.08em] mb-2.5',
          dimmed
            ? 'bg-[var(--color-overlay-3)] text-text-secondary'
            : 'text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]',
        )}
        style={dimmed ? undefined : { background: ensureWhiteContrast(stageColor) }}
        aria-hidden="true"
      >
        {stageName}
      </span>

      {/* Artist name */}
      <div
        className={cn(
          'card-artist',
          'relative z-[2] pointer-events-none',
          'type-title font-bold leading-[1.15] mb-1',
          dimmed ? 'text-text-secondary' : 'text-text-primary',
        )}
        aria-hidden="true"
      >
        {artistName}
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

      {/* Time + indicators */}
      <div
        className={cn(
          'card-time',
          'relative z-[2] pointer-events-none',
          'flex items-center gap-2 flex-wrap',
          'type-caption text-text-secondary tabular-nums mb-3',
        )}
      >
        <span aria-hidden="true">
          {set.startTime && set.endTime ? `${formatTime(set.startTime)} - ${formatTime(set.endTime)}` : 'TBA'}
        </span>
        {myNote && (
          <span className="card-note-indicator inline-flex opacity-50" role="img" aria-label="Has note">
            <StickyNote className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
        )}
        {hasConflict && (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              'text-[length:var(--font-size-12)] font-bold py-0.5 px-1.5 rounded-sm leading-tight',
              'bg-[var(--color-clash-tint)] text-text-primary',
              'border border-[var(--color-clash)]',
              'tracking-[0.5px] uppercase',
            )}
          >
            <AlertTriangle className="w-3 h-3 text-[var(--color-clash)]" aria-hidden="true" /> {COPY.clash.badge}
          </span>
        )}
      </div>

      {/* Live badge */}
      {['live', 'soon', 'upcoming'].includes(setStatus.status) && (
        <LiveBadge status={setStatus.status} label={setStatus.label} />
      )}

      {/* Footer with priority buttons, crew overlap, and preview */}
      <div className={cn('card-footer', 'relative z-[2]', 'flex flex-wrap gap-y-2 items-center justify-between mt-3')}>
        {/* Priority buttons */}
        {showPicks && (
          <div className="card-priority flex gap-2" role="group" aria-label={`Priority for ${artistName}`}>
            {(['must', 'want-to-see', 'maybe'] as const).map((p) => {
              const active = myPick === p;
              const priKey = PRI_MAP[p];
              const pending = active && (pickSync?.state === 'saving' || pickSync?.state === 'queued');
              const pendingSuffix = pending
                ? pickSync?.state === 'queued'
                  ? ' (saved on this device, will sync)'
                  : ' (saving)'
                : '';
              return (
                <button
                  key={p}
                  className={cn(
                    'card-priority-btn',
                    'h-11 min-w-11 min-h-11 px-3 gap-1.5 rounded-full',
                    'flex items-center justify-center',
                    'bg-[var(--color-overlay-3)] border border-border-light',
                    'text-sm text-text-muted cursor-pointer',
                    'transition-[transform,box-shadow,background,border-color,color] duration-200 ease-out',
                    'hover:border-text-secondary hover:bg-[var(--color-overlay-5)]',
                    'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-[-2px]',
                    'active:scale-[0.92] motion-reduce:transform-none',
                    // Active priority states — static glow (mobile keeps these
                    // static for list-scroll perf; no infinite pulse animation).
                    active &&
                      priKey === 'must' && [
                        'active-must',
                        // Fill = coral-strong so white label clears WCAG AA (white on
                        // #ff3366 is only 3.55:1); brand coral #ff3366 stays as the
                        // rim border + glow halo for the "hot must-pick" identity.
                        'bg-accent-coral-strong text-text-on-accent border-priority-must',
                        'shadow-[var(--shadow-glow-coral),0_0_0_1px_var(--color-coral-a3)]',
                      ],
                    active &&
                      priKey === 'want' && [
                        'active-want',
                        'bg-priority-want text-[var(--text-on-light-accent)] border-priority-want',
                        'shadow-[var(--shadow-glow-aqua),0_0_0_1px_var(--color-aqua-a3)]',
                      ],
                    active &&
                      priKey === 'maybe' && [
                        'active-maybe',
                        'bg-priority-maybe text-[var(--text-on-light-accent)] border-priority-maybe',
                        'shadow-[var(--shadow-glow-amber),0_0_0_1px_var(--color-amber-a3)]',
                      ],
                  )}
                  type="button"
                  aria-pressed={active ? 'true' : 'false'}
                  aria-label={`${PRIORITY_SYMBOLS[p].label}: ${artistName}${pendingSuffix}`}
                  disabled={saving}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePriorityChange(p, active);
                  }}
                >
                  <span
                    className={
                      active
                        ? undefined
                        : p === 'must'
                          ? 'text-priority-must'
                          : p === 'want-to-see'
                            ? 'text-priority-want'
                            : 'text-priority-maybe'
                    }
                  >
                    <PriorityIcon priority={p} filled={active} />
                  </span>
                  <span className={cn('text-xs font-semibold', !active && 'text-text-secondary')}>
                    {PRIORITY_SYMBOLS[p].short}
                  </span>
                  {pending && <Clock className="w-3 h-3 ml-0.5" aria-hidden="true" data-testid="pick-pending-clock" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Crew overlap / who's going */}
        {groupedFriends.length > 0 && <CrewOverlapAvatars friends={groupedFriends} artistName={artistName} />}
      </div>

      {showPicks && pickSync?.state === 'failed' && (
        <div className="relative z-[2] mt-2 inline-flex items-center gap-2 text-xs font-medium text-accent-amber">
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
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
 * Array props (friendProfiles, conflicts) are compared by length + element
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

  // Visual props
  if (prev.stageColor !== next.stageColor) return false;
  if (prev.stageName !== next.stageName) return false;
  if (prev.showPicks !== next.showPicks) return false;
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

  // conflicts — compare by length + set IDs
  const prevConflicts = prev.conflicts ?? [];
  const nextConflicts = next.conflicts ?? [];
  if (prevConflicts.length !== nextConflicts.length) return false;
  for (let i = 0; i < prevConflicts.length; i++) {
    if (prevConflicts[i]!.id !== nextConflicts[i]!.id) return false;
  }

  return true;
}

export default memo(SetCard, setCardPropsAreEqual);
