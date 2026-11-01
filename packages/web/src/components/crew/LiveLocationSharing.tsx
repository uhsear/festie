// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { useLiveLocationPublisher, type GeoWatcher } from '@festie/shared/hooks';
import { LIVE_LOCATION } from '@festie/shared/constants';
import { formatShareWindow } from '@festie/shared/utils';
import { useSharedSocket } from '../../lib/socketContext';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';

const SESSION_MINUTES = Math.round(LIVE_LOCATION.MAX_SESSION_MS / 60_000);

function cancelSharing() {
  useLiveLocationStore.getState().cancelSharing();
}

/**
 * LiveLocationSharing — the one owner of the web live-location publisher,
 * mounted once in AppShell so sharing keeps running across pages (e.g. the crew
 * Meet tab → /map). The Meet tab's switch only writes the opt-in
 * (liveLocationStore.shareIntentCrewId); this component turns it into a GPS
 * watch + socket emits and shows a non-dismissible indicator on every page.
 *
 * Sharing stops on: toggle off / Stop, the publisher's time-box auto-stop,
 * a geolocation error, a rejected share, low-power mode, a crew switch and
 * logout (both clear the intent in the store), a festival switch, the socket
 * going away, and this component unmounting.
 */
export default function LiveLocationSharing() {
  const socket = useSharedSocket();
  const { toast } = useToast();
  const shareIntentCrewId = useLiveLocationStore((s) => s.shareIntentCrewId);
  const sharingCrewId = useLiveLocationStore((s) => s.sharingCrewId);
  const sharingExpiresAt = useLiveLocationStore((s) => s.sharingExpiresAt);
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const festivalId = useFestivalStore((s) => s.currentFestivalId);

  // These run before the publisher effect, so a stop never re-shares first.
  useEffect(() => {
    if (lowPowerMode) cancelSharing();
  }, [lowPowerMode]);
  useEffect(() => {
    if (!socket) cancelSharing();
  }, [socket]);
  const festivalRef = useRef(festivalId);
  useEffect(() => {
    if (festivalRef.current === festivalId) return;
    festivalRef.current = festivalId;
    cancelSharing();
  }, [festivalId]);
  useEffect(() => cancelSharing, []);

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
    crewId: shareIntentCrewId,
    enabled: shareIntentCrewId !== null,
    watchPosition,
    onAutoStop: () => {
      cancelSharing();
      toast(`Live location stopped automatically after ${SESSION_MINUTES} minutes.`, 'info');
    },
    onError: (err) => {
      cancelSharing();
      const denied =
        typeof err === 'object' && err !== null && 'code' in err && (err as GeolocationPositionError).code === 1;
      toast(
        denied
          ? 'Location permission denied — turn it on in your browser to share.'
          : "Couldn't read your location — live sharing stopped.",
        'error',
      );
    },
    onShareRejected: () => {
      cancelSharing();
      toast("Couldn't start sharing your location. Try again.", 'error');
    },
  });

  // Phase 4C: tick so the own-side "sharing ends in Nm" countdown stays
  // current. Only runs while sharing (cleared otherwise).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!sharingExpiresAt) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [sharingExpiresAt]);
  const shareCountdown = sharingExpiresAt ? formatShareWindow(sharingExpiresAt, nowTick) : null;

  // The publisher sets sharingCrewId before it starts the GPS watch and clears
  // it when the watch stops, so this shows whenever geolocation is running.
  if (!sharingCrewId) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sharing-indicator"
      className="shrink-0 flex items-center gap-3 border-b border-accent-aqua bg-accent-aqua/10 px-4 py-2"
    >
      <span className="festie-live-dot" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">You&apos;re sharing your live location</p>
        <p className="text-xs text-text-muted">
          Only this crew can see it. Stops automatically{shareCountdown ? ` — ${shareCountdown}` : ''}.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={cancelSharing} aria-label="Stop sharing my live location">
        <Square className="w-4 h-4" aria-hidden="true" /> Stop
      </Button>
    </div>
  );
}
