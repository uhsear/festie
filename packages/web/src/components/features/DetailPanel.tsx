import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName, hasSetStarted, buildSetUrl, formatSetWhen, primarySpotifyArtist } from '@festie/shared/utils';
import { useDebouncedNote, useSpotifyPreview } from '@festie/shared/hooks';
import { api, mapErrorToUserMessage } from '@festie/shared/services/api';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { Drawer } from 'vaul';
import RatingButtons from './RatingButtons';
import DetailArtistHeader from './DetailArtistHeader';
import DetailArtistLinks from './DetailArtistLinks';
import DetailSpotifySection from './DetailSpotifySection';
import DetailReminderNotePanel from './DetailReminderNotePanel';
import DetailConflictWarning from './DetailConflictWarning';
import ClashPrompt from './ClashPrompt';
import DetailPriorityPicker from './DetailPriorityPicker';
import DetailCrewSection from './DetailCrewSection';
import DetailNotesSection from './DetailNotesSection';
import { useDetailPanelData } from './useDetailPanelData';
import { useHaptics } from '../../hooks/useHaptics';
import { useSetStatus } from '../../hooks/useSetStatus';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useToast } from '../../lib/toastContext';
import { Share2 } from 'lucide-react';
import Button from '../ui/Button';
import { CHIP_TINT_ALPHA, inactiveChipTextColor } from '../ui/StageBadge';

interface DetailPanelProps {
  set: FestivalSet;
  onClose: () => void;
  autoOpenSpotify?: boolean;
}

export default function DetailPanel({ set, onClose, autoOpenSpotify = false }: DetailPanelProps) {
  const theme = useUIStore((s) => s.theme);
  const isLg = useMediaQuery('(min-width: 1024px)');
  const {
    currentFestival,
    festivalDays,
    currentProfile,
    b2bSeparator,
    stageColor,
    stageName,
    myPick,
    myReminder,
    artistName,
    sub,
    artistLinks,
    isB2B,
    primaryArtist,
    allGenres,
    conflicts,
    others,
    crewNotes,
    whoTitle,
    savePick,
    saveReminder,
    getOtherPicks,
    getStageName,
    getMyPick,
  } = useDetailPanelData(set);

  const { select: selectHaptic, success: successHaptic, warning: warningHaptic } = useHaptics();
  const { toast, toastError } = useToast();

  const personal = useDebouncedNote({
    festivalId: currentFestival?.id,
    profileId: currentProfile?.id,
    noteKey: set.id,
    initialValue: currentProfile?.notes?.[set.id] || '',
    onSaved: successHaptic,
    onError: warningHaptic,
  });
  const crew = useDebouncedNote({
    festivalId: currentFestival?.id,
    profileId: currentProfile?.id,
    noteKey: 'crew:' + set.id,
    initialValue: currentProfile?.notes?.['crew:' + set.id] || '',
    onSaved: successHaptic,
    onError: warningHaptic,
  });
  const [spotifyVisible, setSpotifyVisible] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [priorityBusy, setPriorityBusy] = useState<Priority | null | 'clear'>(null);
  const [reminderBusy, setReminderBusy] = useState<number | null | 'clear'>(null);

  const [snap, setSnap] = useState<number | string | null>(autoOpenSpotify ? 1 : 0.5);
  const status = useSetStatus(set);
  const { status: spotifyStatus, preview: spotifyPreview } = useSpotifyPreview(set.id);
  const spotifyArtist = primarySpotifyArtist(set);
  const canRemind = !!set.startTime && !(currentFestival && hasSetStarted(set, currentFestival, festivalDays));

  // Open the player once the preview is ready, when the card's Listen button asked for it.
  useEffect(() => {
    if (autoOpenSpotify && spotifyStatus === 'ready') setSpotifyVisible(true);
  }, [autoOpenSpotify, spotifyStatus]);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Share the set's own page (festie.us/set/<id>). Where the browser has no share
  // sheet, copy the link instead.
  const handleShare = useCallback(async () => {
    const time = set.startTime ? ` at ${formatTime(set.startTime)}` : '';
    const fest = currentFestival?.name ? ` — ${currentFestival.name}` : '';
    const text = `Catch ${artistName}${fest}${time} 🎶`;
    const url = buildSetUrl(set.id);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: artistName, text, url });
        return;
      } catch (err) {
        // AbortError = user dismissed the sheet; don't fall through to clipboard.
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied', 'success');
    } catch {
      toast("Couldn't share this set. Try again.", 'error');
    }
  }, [set.id, set.startTime, currentFestival?.name, artistName, toast]);

  // Priority picker handler
  const handlePriorityClick = useCallback(
    async (priority: Priority | null) => {
      if (!currentFestival) return;
      selectHaptic();
      setPriorityBusy(priority ?? 'clear');
      try {
        await savePick(currentFestival.id, set.id, priority);
      } catch (err) {
        toast(mapErrorToUserMessage(err, "Couldn't save your pick. Try again."), 'error');
      } finally {
        setPriorityBusy(null);
      }
    },
    [currentFestival, set.id, savePick, selectHaptic, toast],
  );

  const handleReminderClick = useCallback(
    async (minutes: number | null) => {
      if (!currentFestival) return;
      selectHaptic();
      setReminderBusy(minutes ?? 'clear');
      try {
        await saveReminder(currentFestival.id, set.id, minutes);
      } catch (err) {
        toast(mapErrorToUserMessage(err, "Couldn't save your reminder. Try again."), 'error');
      } finally {
        setReminderBusy(null);
      }
    },
    [currentFestival, set.id, saveReminder, selectHaptic, toast],
  );

  // Conflict switch handler. Sequenced (was two independent un-awaited
  // calls) so a mid-switch failure produces exactly one toast instead of two
  // writes racing silently, and so the first call's rollback
  // (festivalDataStore.ts's `set({ currentProfile: prev })`) can never fire
  // after the second call's optimistic apply has already landed.
  const handleConflictSwitch = useCallback(
    async (fromSetId: string, toSet: FestivalSet, priority: Priority) => {
      if (!currentFestival) return;
      try {
        await savePick(currentFestival.id, fromSetId, null);
        await savePick(currentFestival.id, toSet.id, priority);
      } catch (err) {
        toast(mapErrorToUserMessage(err, "Couldn't switch your pick. Try again."), 'error');
      }
    },
    [currentFestival, savePick, toast],
  );

  // Clash-prompt clear handler — demote one side of a clash to null. savePick is
  // offline-queued, so resolving a clash works on dead signal.
  const handleClashClear = useCallback(
    (setId: string) => {
      if (!currentFestival) return;
      selectHaptic();
      savePick(currentFestival.id, setId, null).catch((err) => {
        toast(mapErrorToUserMessage(err, "Couldn't clear your pick. Try again."), 'error');
      });
    },
    [currentFestival, savePick, selectHaptic, toast],
  );

  // Join festival handler
  const handleJoinFestival = useCallback(async () => {
    if (!currentFestival) return;
    setJoinBusy(true);
    try {
      await api.post(`/profiles`, { festivalId: currentFestival.id });
      await useFestivalStore.getState().loadProfiles(currentFestival.id);
      onClose();
    } catch (e) {
      toastError(e, "Couldn't join the festival. Try again.");
    } finally {
      setJoinBusy(false);
    }
  }, [currentFestival, onClose, toastError]);

  return (
    <Drawer.Root
      open
      onOpenChange={(o: boolean) => {
        if (!o) onClose();
      }}
      direction={isLg ? 'right' : 'bottom'}
      dismissible
      {...(isLg ? {} : { snapPoints: [0.5, 1], activeSnapPoint: snap, setActiveSnapPoint: setSnap })}
    >
      <Drawer.Portal>
        {/* R4: scrim rgba(0,0,0,0.6) per spec (was bg-black/50 = 0.5) */}
        <Drawer.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/60" />
        {/* R4: glassmorphic surface — rgba(29,29,29,0.82) + blur(20px) +
            1px rgba(255,255,255,0.08) border + inset top highlight.
            Radii: 24px top-corners on mobile sheet, 16px left-only on the lg side panel.
            detail-glass utility owns all four glass properties; rounded-* owns radii. */}
        <Drawer.Content
          aria-label="Set detail panel"
          className="fixed bottom-0 inset-x-0 z-[var(--z-modal)] h-[96dvh] flex flex-col
                     rounded-tl-[24px] rounded-tr-[24px] detail-glass outline-none
                     lg:inset-y-0 lg:right-0 lg:left-auto lg:bottom-auto lg:h-dvh
                     lg:w-[420px] lg:max-w-full
                     lg:rounded-none lg:rounded-l-[16px]"
          onOpenAutoFocus={(e: Event) => {
            e.preventDefault();
            closeBtnRef.current?.focus();
          }}
        >
          <div className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-border-light flex-shrink-0 lg:hidden" />
          <Drawer.Title className="sr-only">{artistDisplayName(set, b2bSeparator)}</Drawer.Title>
          <Drawer.Description className="sr-only">
            Set details, schedule, and crew info for {artistDisplayName(set, b2bSeparator)}
          </Drawer.Description>
          <button
              className="absolute top-4 right-[68px] w-11 h-11 min-w-11 min-h-11 rounded-full bg-bg-card border border-border-light flex items-center justify-center text-text-secondary cursor-pointer transition-[background-color,color,border-color] duration-200 ease-[var(--ease-standard)] hover:bg-accent-aqua hover:text-text-on-accent hover:border-accent-aqua focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:border-accent-aqua z-10"
              type="button"
              aria-label="Share this set"
              onClick={handleShare}
            >
              <Share2 className="w-5 h-5" aria-hidden="true" />
            </button>
          <button
            className="absolute top-4 right-4 w-11 h-11 min-w-11 min-h-11 rounded-full bg-bg-card border border-border-light flex items-center justify-center text-text-secondary text-lg cursor-pointer transition-[background-color,color,border-color] duration-200 ease-[var(--ease-standard)] hover:bg-accent-coral-strong hover:text-text-on-accent hover:border-accent-coral-strong focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:border-accent-aqua z-10"
            type="button"
            aria-label="Close detail panel"
            onClick={onClose}
            ref={closeBtnRef}
          >
            {'×'}
          </button>
          <div
            className={`min-h-0 flex flex-col gap-[var(--space-4)] ${isLg || snap === 1 ? 'overflow-y-auto' : 'overflow-hidden'} overscroll-contain p-7 pb-[max(12px,env(safe-area-inset-bottom))]`}
            ref={panelRef}
          >
            <div>
              <div
                className="relative inline-block self-start px-3 py-1 rounded-full type-micro mb-3 overflow-hidden"
                // Opaque ground under the tint: the panel is translucent glass, so the text is solved
                // against bg-primary plus the tint, not against whatever shows through the panel.
                style={{ color: inactiveChipTextColor(stageColor, theme), background: 'var(--color-bg-primary)' }}
              >
                {/* tint layer — safe with any CSS color format (hex, rgb, var()) */}
                <span
                  className="absolute inset-0 rounded-full"
                  style={{ background: stageColor, opacity: CHIP_TINT_ALPHA }}
                  aria-hidden="true"
                />
                <span className="relative">{stageName}</span>
              </div>

              <DetailArtistHeader
                artistName={artistName}
                subtitle={sub}
                primaryArtist={primaryArtist}
                stageColor={stageColor}
                setArtist={set.artist}
              />

              <div className="text-base text-text-secondary tabular-nums" data-testid="set-when">
                {formatSetWhen(set, festivalDays, status)}
              </div>
            </div>

            {currentProfile ? (
              <>
                <DetailPriorityPicker
                  setId={set.id}
                  myPick={myPick || null}
                  priorityBusy={priorityBusy}
                  onPriorityClick={handlePriorityClick}
                />
                <DetailReminderNotePanel
                  myReminder={myReminder}
                  reminderBusy={reminderBusy}
                  onReminderClick={handleReminderClick}
                  canRemind={canRemind}
                  personalNote={personal.value}
                  onPersonalChange={personal.setValue}
                  personalStatus={personal.status}
                  onRetryPersonal={personal.retry}
                  onExpand={() => setSnap(1)}
                />
              </>
            ) : (
              <div className="p-4 rounded-DEFAULT bg-[var(--color-overlay-2)] border border-glass-border">
                <p className="text-[length:var(--font-size-14)] text-text-secondary leading-normal mb-3">
                  Join this festival to save picks, keep private notes, and compare crew overlap.
                </p>
                <Button
                  variant="primary"
                  type="button"
                  disabled={joinBusy}
                  isLoading={joinBusy}
                  onClick={handleJoinFestival}
                >
                  {joinBusy ? 'Joining…' : 'Join Festival'}
                </Button>
              </div>
            )}

            {spotifyArtist && (
              <>
                <hr className="border-t border-border -mx-7" />
                <DetailSpotifySection
                  status={spotifyStatus}
                  preview={spotifyPreview}
                  spotifyUrl={spotifyArtist.url}
                  visible={spotifyVisible}
                  onToggle={() => setSpotifyVisible((v) => !v)}
                />
              </>
            )}

            {currentProfile && (
              <ClashPrompt
                currentSet={set}
                conflicts={conflicts}
                b2bSeparator={b2bSeparator}
                getPriority={getMyPick}
                onClear={handleClashClear}
              />
            )}

            <DetailConflictWarning
              conflicts={conflicts}
              currentSetId={set.id}
              myPick={myPick || null}
              b2bSeparator={b2bSeparator}
              getStageName={getStageName}
              getOtherPicks={getOtherPicks}
              onSwitch={handleConflictSwitch}
            />

            {currentProfile && set && currentFestival && hasSetStarted(set, currentFestival, festivalDays) && (
              <div className="mx-0 text-center">
                <div className="mb-2 text-[length:var(--font-size-12)] uppercase tracking-wide text-text-muted">
                  Rate this set
                </div>
                <RatingButtons setId={set.id} festivalId={currentFestival.id} />
              </div>
            )}

            <DetailArtistLinks artistLinks={artistLinks} isB2B={isB2B} genres={allGenres} hideLink={spotifyArtist} />

            <hr className="border-t border-border -mx-7" />
            <DetailCrewSection title={whoTitle} others={others} crewNotes={crewNotes} />

            {currentProfile && (
              <>
                <hr className="border-t border-border -mx-7" />
                <DetailNotesSection
                  crewNote={crew.value}
                  onCrewChange={crew.setValue}
                  crewStatus={crew.status}
                  onRetryCrew={crew.retry}
                />
              </>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
