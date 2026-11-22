// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import React, { useId, useMemo, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { AlertCircle, Navigation, ShieldCheck, MapPin } from 'lucide-react';
import { clearCrewSos, sosErrorMessage } from '@festie/shared';
import type { SosEntry } from '@festie/shared/types';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { useFestivalStore } from '@festie/shared/stores';
import { useShareExplainer } from '@festie/shared/hooks';
import { LIVE_SHARE_COPY, LOW_POWER_COPY } from '@festie/shared/constants';
import { formatStaleness, liveShareOptions, resolveFestivalTimeZone, sosSeenLabel } from '@festie/shared/utils';
import { useSharedSocket } from '../../lib/socketContext';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import Switch from '../ui/Switch';
import SosRaiseButton from './SosRaiseButton';
import CheckInCard from './CheckInCard';
import { BeaconButton } from './BeaconOverlay';

interface Props {
  crewId: string;
  currentUserId: string;
}

/**
 * LiveLocationControls — opt-in live-location sharing + SOS for the active crew.
 *
 * PRIVACY MODEL (see liveLocationStore header): sharing is OFF by default and is a
 * per-session opt-in that is never persisted (resets on reload). The sharer picks
 * how long; the choice becomes ONE session per crew in liveLocationStore
 * (`shareIntent`). LiveLocationSharing in AppShell runs it app-wide, so it survives
 * tab and page changes, and shows the bar with Pause and Stop. It ends at the
 * picked time, on Stop, on a crew switch, on logout or when low-power mode turns on.
 *
 * SOS is HTTP (not a fire-and-forget socket emit) so it reliably writes the
 * crew_activity row + fans out push; it is online-only (never queued), so an
 * offline raise surfaces an explicit "use your phone/radio" error rather than a
 * silently-queued stale rescue.
 */
export default function LiveLocationControls({ crewId, currentUserId }: Props) {
  const socket = useSharedSocket();
  const { toast } = useToast();

  // Per-session opt-in, held in the non-persisted store (always starts OFF).
  const shareIntent = useLiveLocationStore((s) => s.shareIntent);
  // Read the FULL active-SOS list (not just the newest `sos`) so a second
  // concurrent SOS stays visible. The store is scoped to the active crew; filter
  // anyway as defense in depth (parity with mobile CrewSos).
  const activeSosList = useLiveLocationStore((s) => s.activeSosList);
  const sosList = useMemo(() => activeSosList.filter((e) => e.crewId === crewId), [activeSosList, crewId]);
  const isSharingThisCrew = shareIntent?.crewId === crewId;

  // Low-power mode disables the battery-hungry live-location auto-share (GPS
  // watch + socket emit loop). SOS stays available — it's an essential.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const setLowPowerMode = useFestivalModeStore((s) => s.setLowPowerMode);
  const festivalDays = useFestivalStore((s) => s.days);
  const festivalSets = useFestivalStore((s) => s.sets);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const chooserHeadingId = useId();

  const [chooserOpen, setChooserOpen] = useState(false);
  const explainer = useShareExplainer();
  const [shareBattery, setShareBattery] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  // The SOS pending a clear-confirm. Any member may resolve any SOS (parity with
  // mobile — the raiser's phone may be dead), but a stray tap must not silently
  // clear a live emergency, so clearing is confirm-gated like the raise. null = closed.
  const [clearTarget, setClearTarget] = useState<SosEntry | null>(null);

  function toggleSharing() {
    if (isSharingThisCrew) {
      useLiveLocationStore.getState().endShare('user');
      return;
    }
    setChooserOpen((open) => !open);
  }

  function startSharing(ms: number) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast('Location is not available on this device.', 'error');
      return;
    }
    if (!socket || !socket.connected) {
      toast('Not connected — can’t share your location right now.', 'error');
      return;
    }
    useLiveLocationStore.getState().beginShare(crewId, new Date(Date.now() + ms).toISOString(), shareBattery);
    setChooserOpen(false);
    setShareBattery(false);
  }

  // Clear a specific raiser's SOS. Any crew member may resolve any SOS (the
  // raiser's phone may be dead), so we always target by raiserId — mirroring
  // mobile — rather than assuming the current user is the raiser.
  async function clearSos(raiserId: string) {
    if (clearBusy) return;
    setClearBusy(true);
    try {
      // Also clears the store, so the banner dismisses now.
      await clearCrewSos(crewId, raiserId);
      toast('SOS cleared', 'success');
      setClearTarget(null);
    } catch (err) {
      toast(sosErrorMessage(err, 'clear'), 'error');
    } finally {
      setClearBusy(false);
    }
  }

  const showSos = sosList.length > 0;
  const clearMine = clearTarget?.userId === currentUserId;
  const ownSosActive = sosList.some((e) => e.userId === currentUserId);
  const showChooser = chooserOpen && !isSharingThisCrew && !lowPowerMode;
  // Duration buttons in ascending order; the default is marked, not moved.
  const durationChoices = showChooser
    ? liveShareOptions({
        days: festivalDays,
        sets: festivalSets,
        timeZone: resolveFestivalTimeZone(currentFestival),
        nowMs: Date.now(),
      })
    : null;
  const orderedOptions = durationChoices
    ? [...durationChoices.options].sort((a, b) => a.ms - b.ms)
    : [];

  return (
    <div className="space-y-2">
      {/* ── Send SOS: top of the Meet tab. Hidden while your own SOS is active
          (the banner below carries "I'm safe"), as on mobile. ─────────────── */}
      {!ownSosActive && <SosRaiseButton crewId={crewId} alerting={showSos} />}
      {!ownSosActive && (
        <p className="text-xs text-text-muted">For emergencies — alerts your whole crew. Needs signal to send.</p>
      )}
      <CheckInCard crewId={crewId} />

      {/* ── Active SOS banners (crew-wide, prominent) ──────────────────────────
          One banner per active SOS. With 2+ live, a "{N} active" header labels
          the stack (parity with mobile); a single SOS looks identical to before. */}
      {sosList.length > 1 && (
        <p role="heading" aria-level={2} className="text-sm font-bold text-accent-coral">
          {sosList.length} active SOS
        </p>
      )}
      {sosList.map((entry) => {
        const isMine = entry.userId === currentUserId;
        return (
          <div
            key={`${entry.userId}|${entry.raisedAt}`}
            role="alert"
            aria-atomic="true"
            data-testid="sos-banner"
            className="rounded-lg border-2 border-accent-coral bg-accent-coral/15 p-3 space-y-2 animate-[card-in_220ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-accent-coral shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-text-primary">
                  {isMine ? 'You raised an SOS' : `${entry.username} raised an SOS`}
                </p>
                {entry.message && <p className="text-sm text-text-secondary mt-0.5 break-words">{entry.message}</p>}
                <p className="text-xs text-text-muted mt-0.5">{formatStaleness(entry.raisedAt)}</p>
                <p className="text-xs text-text-muted">{sosSeenLabel(entry)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {entry.position && !isMine && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    window.open(
                      `https://maps.google.com/?q=${entry.position!.lat},${entry.position!.lng}`,
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  <Navigation className="w-4 h-4" aria-hidden="true" /> Get directions
                </Button>
              )}
              {/* Any member may resolve any SOS (raiser's phone may be dead). */}
              <Button variant="primary" size="sm" onClick={() => setClearTarget(entry)}>
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />{' '}
                {isMine ? "I'm safe — clear SOS" : `Mark ${entry.username}'s SOS resolved`}
              </Button>
            </div>
          </div>
        );
      })}

      {/* ── Share toggle ──────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-card p-3">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-text-secondary shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p id="live-share-label" className="text-sm font-semibold text-text-primary">
              {LIVE_SHARE_COPY.title}
            </p>
            <p id="live-share-desc" className="text-xs text-text-muted">
              {lowPowerMode ? LOW_POWER_COPY.livePaused : LIVE_SHARE_COPY.ruleWeb}
            </p>
          </div>
          <Switch
            checked={isSharingThisCrew}
            onChange={() => toggleSharing()}
            label={LIVE_SHARE_COPY.switchA11y}
            describedBy="live-share-desc"
            disabled={lowPowerMode}
            data-testid="live-share-toggle"
          />
        </div>
        {lowPowerMode && (
          <Button variant="secondary" size="sm" onClick={() => setLowPowerMode(false)}>
            {LOW_POWER_COPY.turnOff}
          </Button>
        )}
        {showChooser && (
          <div
            role="group"
            aria-labelledby={chooserHeadingId}
            className="flex flex-col gap-2"
            data-testid="live-share-chooser"
          >
            <p id={chooserHeadingId} className="text-sm font-semibold text-text-primary">
              {explainer.needed ? LIVE_SHARE_COPY.explainerTitle : LIVE_SHARE_COPY.chooserTitle}
            </p>
            {explainer.needed ? (
              <>
                <ul className="list-disc pl-5 text-sm text-text-secondary space-y-1">
                  {LIVE_SHARE_COPY.explainerPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <Button className="min-h-11" onClick={explainer.markSeen}>
                  {LIVE_SHARE_COPY.explainerOk}
                </Button>
              </>
            ) : (
              <>
                <label className="flex items-start gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={shareBattery}
                    onChange={(e) => setShareBattery(e.target.checked)}
                    className="mt-1 h-4 w-4 accent-accent-aqua"
                  />
                  <span>
                    {LIVE_SHARE_COPY.battery}
                    <span className="block text-xs text-text-muted">{LIVE_SHARE_COPY.batteryHint}</span>
                  </span>
                </label>
                {orderedOptions.map((option) => (
                  <Button
                    key={option.id}
                    variant={option.id === durationChoices?.defaultId ? 'primary' : 'secondary'}
                    className="min-h-11"
                    onClick={() => startSharing(option.ms)}
                  >
                    {option.label}
                    {option.id === durationChoices?.defaultId && (
                      <span aria-hidden="true" className="ml-2 text-xs font-normal opacity-80">
                        Recommended
                      </span>
                    )}
                  </Button>
                ))}
              </>
            )}
            <Button variant="utility" className="min-h-11" onClick={() => setChooserOpen(false)}>
              {LIVE_SHARE_COPY.cancel}
            </Button>
          </div>
        )}
      </div>

      <BeaconButton />

      {/* ── Clear-SOS confirm dialog (parity with the raise: one stray tap must
          not silently resolve a live emergency) ────────────────────────────── */}
      <Dialog
        open={!!clearTarget}
        onOpenChange={(o) => !clearBusy && !o && setClearTarget(null)}
        icon={<ShieldCheck className="w-5 h-5 text-accent-aqua" aria-hidden="true" />}
        title={clearTarget ? (clearMine ? 'Clear your SOS?' : `Mark ${clearTarget.username}'s SOS resolved?`) : ''}
        description={
          clearTarget
            ? clearMine
              ? "This tells your whole crew you're safe and removes the alert for everyone. Only do this once you're actually OK."
              : `This clears ${clearTarget.username}'s active emergency alert for everyone in the crew. Only do this if you know they are safe.`
            : undefined
        }
        closeDisabled={clearBusy}
      >
        {clearTarget && (
          <>
            <div className="flex gap-2">
              <RadixDialog.Close asChild>
                <Button variant="secondary" type="button" className="flex-1 min-h-11" disabled={clearBusy}>
                  Cancel
                </Button>
              </RadixDialog.Close>
              <Button
                type="button"
                variant="primary"
                onClick={() => clearSos(clearTarget.userId)}
                isLoading={clearBusy}
                className="flex-1 min-h-11"
              >
                {clearMine ? "I'm safe" : 'Mark resolved'}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
