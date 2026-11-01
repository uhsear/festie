// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Square, AlertCircle, Navigation, ShieldCheck, X, MapPin } from 'lucide-react';
import { clearCrewSos, sosErrorMessage } from '@festie/shared';
import type { SosEntry } from '@festie/shared/types';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { useLiveLocationPublisher, type GeoWatcher } from '@festie/shared/hooks';
import { LIVE_LOCATION } from '@festie/shared/constants';
import { formatStaleness, formatShareWindow } from '@festie/shared/utils';
import { useSharedSocket } from '../../lib/socketContext';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import SosRaiseButton from './SosRaiseButton';

interface Props {
  crewId: string;
  currentUserId: string;
}

const SESSION_MINUTES = Math.round(LIVE_LOCATION.MAX_SESSION_MS / 60_000);

/**
 * LiveLocationControls — opt-in live-location sharing + SOS for the active crew.
 *
 * PRIVACY MODEL (see liveLocationStore header): sharing is OFF by default, is a
 * per-session opt-in that is never persisted (resets on reload), is scoped to
 * THIS crew only, and auto-stops on every exit path (toggle off, unmount, socket
 * disconnect, and a hard MAX_SESSION_MS cap). While sharing, a hard-to-miss,
 * non-dismissible banner with a one-tap Stop is always shown.
 *
 * SOS is HTTP (not a fire-and-forget socket emit) so it reliably writes the
 * crew_activity row + fans out push; it is online-only (never queued), so an
 * offline raise surfaces an explicit "use your phone/radio" error rather than a
 * silently-queued stale rescue.
 */
export default function LiveLocationControls({ crewId, currentUserId }: Props) {
  const socket = useSharedSocket();
  const { toast } = useToast();

  // Per-session opt-in. NOT persisted — always starts OFF (privacy requirement).
  const [sharing, setSharing] = useState(false);
  const sharingCrewId = useLiveLocationStore((s) => s.sharingCrewId);
  const sharingExpiresAt = useLiveLocationStore((s) => s.sharingExpiresAt);
  // Read the FULL active-SOS list (not just the newest `sos`) so a second
  // concurrent SOS stays visible. The store is scoped to the active crew; filter
  // anyway as defense in depth (parity with mobile CrewSos).
  const activeSosList = useLiveLocationStore((s) => s.activeSosList);
  const sosList = useMemo(() => activeSosList.filter((e) => e.crewId === crewId), [activeSosList, crewId]);

  // Phase 4C: tick once a minute so the own-side "sharing ends in Nm" countdown
  // stays current. Only runs while sharing (cleared otherwise).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!sharingExpiresAt) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [sharingExpiresAt]);
  const shareCountdown = sharingExpiresAt ? formatShareWindow(sharingExpiresAt, nowTick) : null;
  // Low-power mode disables the battery-hungry live-location auto-share (GPS
  // watch + socket emit loop). SOS stays available — it's an essential.
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);

  // If low-power mode flips on while we're sharing, stop the GPS watch loop.
  useEffect(() => {
    if (lowPowerMode && sharing) setSharing(false);
  }, [lowPowerMode, sharing]);

  const [clearBusy, setClearBusy] = useState(false);
  // The SOS pending a clear-confirm. Any member may resolve any SOS (parity with
  // mobile — the raiser's phone may be dead), but a stray tap must not silently
  // clear a live emergency, so clearing is confirm-gated like the raise. null = closed.
  const [clearTarget, setClearTarget] = useState<SosEntry | null>(null);

  // Adapter: navigator.geolocation.watchPosition → the publisher's GeoWatcher
  // shape. Stable identity (the publisher assumes a stable watcher). Balanced
  // accuracy (enableHighAccuracy:false) to spare battery at a festival.
  const watchPosition = useMemo<GeoWatcher>(
    () => (onFix, onError) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        onError?.(new Error('GEO_UNSUPPORTED'));
        return () => {};
      }
      const id = navigator.geolocation.watchPosition(
        (pos) =>
          onFix({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            heading: pos.coords.heading ?? undefined,
            speed: pos.coords.speed ?? undefined,
            // TODO(battery): the Battery Status API (navigator.getBattery()) is
            // non-standard and unavailable in Safari/iOS, so battery is left
            // undefined here for parity with mobile (build-gated). The payload
            // field + peer popup already exist; wire getBattery().level×100 when a
            // cross-browser source is acceptable.
            capturedAt: new Date(pos.timestamp).toISOString(),
          }),
        (err) => onError?.(err),
        { enableHighAccuracy: false, maximumAge: 10_000, timeout: 20_000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    },
    [],
  );

  useLiveLocationPublisher({
    socket,
    crewId,
    enabled: sharing,
    watchPosition,
    onAutoStop: () => {
      setSharing(false);
      toast(`Live location stopped automatically after ${SESSION_MINUTES} minutes.`, 'info');
    },
    onError: (err) => {
      setSharing(false);
      const denied =
        typeof err === 'object' && err !== null && 'code' in err && (err as GeolocationPositionError).code === 1;
      toast(
        denied
          ? 'Location permission denied — turn it on in your browser to share.'
          : "Couldn't read your location — live sharing stopped.",
        'error',
      );
    },
  });

  function toggleSharing() {
    if (sharing) {
      setSharing(false);
      return;
    }
    if (lowPowerMode) {
      toast('Low-power mode is on — turn it off to share your live location.', 'info');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast('Location is not available on this device.', 'error');
      return;
    }
    if (!socket || !socket.connected) {
      toast('Not connected — can’t share your location right now.', 'error');
      return;
    }
    setSharing(true);
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

  const isSharingThisCrew = sharing && sharingCrewId === crewId;
  const showSos = sosList.length > 0;
  const clearMine = clearTarget?.userId === currentUserId;
  const ownSosActive = sosList.some((e) => e.userId === currentUserId);

  return (
    <div className="space-y-2">
      {/* ── Send SOS: top of the Meet tab. Hidden while your own SOS is active
          (the banner below carries "I'm safe"), as on mobile. ─────────────── */}
      {!ownSosActive && <SosRaiseButton crewId={crewId} alerting={showSos} />}
      <p className="text-xs text-text-muted">For emergencies — alerts your whole crew. Needs signal to send.</p>

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
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {entry.position && (
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

      {/* ── Sharing indicator (non-dismissible while active) ───────────────── */}
      {isSharingThisCrew && (
        <div
          role="status"
          aria-live="polite"
          data-testid="sharing-indicator"
          className="flex items-center gap-3 rounded-lg border border-accent-aqua bg-accent-aqua/10 p-3"
        >
          <span className="festie-live-dot" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary">You&apos;re sharing your live location</p>
            <p className="text-xs text-text-muted">
              Only this crew can see it. Stops automatically when you leave{shareCountdown ? ` — ${shareCountdown}` : ''}.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSharing(false)}
            aria-label="Stop sharing my live location"
          >
            <Square className="w-4 h-4" aria-hidden="true" /> Stop
          </Button>
        </div>
      )}

      {/* ── Share toggle ──────────────────────────────────────── */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-card p-3">
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-text-secondary shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p id="live-share-label" className="text-sm font-semibold text-text-primary">
              Share my live location with this crew
            </p>
            <p id="live-share-desc" className="text-xs text-text-muted">
              {lowPowerMode
                ? 'Paused by low-power mode to save battery. Turn it off in Now & Next to share.'
                : `Ephemeral and crew-only. Auto-stops on exit and after ${SESSION_MINUTES} min.`}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isSharingThisCrew}
            aria-labelledby="live-share-label"
            aria-describedby="live-share-desc"
            onClick={toggleSharing}
            disabled={lowPowerMode}
            data-testid="live-share-toggle"
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua disabled:opacity-40 disabled:cursor-not-allowed ${
              isSharingThisCrew ? 'bg-accent-aqua' : 'bg-border-light'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                isSharingThisCrew ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Clear-SOS confirm dialog (parity with the raise: one stray tap must
          not silently resolve a live emergency) ────────────────────────────── */}
      <Dialog.Root open={!!clearTarget} onOpenChange={(o: boolean) => !clearBusy && !o && setClearTarget(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-border-light bg-bg-card p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
            {clearTarget && (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Dialog.Title className="flex items-center gap-2 text-base font-bold text-text-primary">
                      <ShieldCheck className="w-5 h-5 text-accent-aqua" aria-hidden="true" />{' '}
                      {clearMine ? 'Clear your SOS?' : `Mark ${clearTarget.username}'s SOS resolved?`}
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-text-secondary">
                      {clearMine
                        ? "This tells your whole crew you're safe and removes the alert for everyone. Only do this once you're actually OK."
                        : `This clears ${clearTarget.username}'s active emergency alert for everyone in the crew. Only do this if you know they are safe.`}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <IconButton label="Close" icon={<X className="w-5 h-5" />} disabled={clearBusy} />
                  </Dialog.Close>
                </div>
                <div className="flex gap-2">
                  <Dialog.Close asChild>
                    <Button variant="outline" type="button" className="flex-1 min-h-11" disabled={clearBusy}>
                      Cancel
                    </Button>
                  </Dialog.Close>
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
