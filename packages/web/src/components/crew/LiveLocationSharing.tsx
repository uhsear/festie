// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useLiveShareSession, type GeoWatcher } from '@festie/shared/hooks';
import { LIVE_SHARE_COPY } from '@festie/shared/constants';
import { fmtZonedClock, formatCountdown, liveShareEndedText } from '@festie/shared/utils';
import { useSharedSocket } from '../../lib/socketContext';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';

/** The Battery Status API is non-standard and absent in Safari, so it is typed locally. */
interface BatteryManagerLike extends EventTarget {
  level: number;
}
type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

function endShare() {
  useLiveLocationStore.getState().endShare('user');
}

/**
 * LiveLocationSharing — the one app-wide host of the web live-share session,
 * mounted once in AppShell so sharing keeps running across tabs and pages. The
 * Meet tab only writes the session (`shareIntent`) to liveLocationStore; this
 * component runs it through useLiveShareSession and shows the "you are sharing"
 * bar on every screen, including while paused.
 */
export default function LiveLocationSharing() {
  const socket = useSharedSocket();
  const { toast } = useToast();
  const intent = useLiveLocationStore((s) => s.shareIntent);
  const endedReason = useLiveLocationStore((s) => s.shareEndedReason);
  const festivalId = useFestivalStore((s) => s.currentFestivalId);
  const batteryRef = useRef<number | undefined>(undefined);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as NavigatorWithBattery | undefined;
    if (!nav?.getBattery) return;
    let cancelled = false;
    let battery: BatteryManagerLike | null = null;
    const onLevel = () => {
      if (battery) batteryRef.current = Math.round(battery.level * 100);
    };
    nav
      .getBattery()
      .then((b) => {
        if (cancelled) return;
        battery = b;
        onLevel();
        b.addEventListener('levelchange', onLevel);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      battery?.removeEventListener('levelchange', onLevel);
    };
  }, []);

  // Stable identity (the publisher assumes a stable watcher). Balanced accuracy
  // (enableHighAccuracy:false) to spare battery at a festival.
  const watchPosition = useMemo<GeoWatcher>(
    () => (onFix, onError) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        onError?.(new Error('GEO_UNSUPPORTED'));
        return () => {};
      }
      let hinted = false;
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          hinted = false;
          onFix({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            heading: pos.coords.heading ?? undefined,
            speed: pos.coords.speed ?? undefined,
            battery: batteryRef.current,
            capturedAt: new Date(pos.timestamp).toISOString(),
          });
        },
        (err) => {
          // Only a denied permission is fatal. TIMEOUT / POSITION_UNAVAILABLE are
          // transient and watchPosition keeps retrying, so keep sharing and hint once.
          if (err.code !== err.PERMISSION_DENIED) {
            if (!hinted) toastRef.current(LIVE_SHARE_COPY.weakGps, 'info');
            hinted = true;
            return;
          }
          onError?.(err);
        },
        { enableHighAccuracy: false, maximumAge: 10_000, timeout: 20_000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    },
    [],
  );

  // These run before the session effects, so a stop never re-shares first.
  useEffect(() => {
    if (!socket) endShare();
  }, [socket]);
  const festivalRef = useRef(festivalId);
  useEffect(() => {
    if (festivalRef.current === festivalId) return;
    festivalRef.current = festivalId;
    endShare();
  }, [festivalId]);
  useEffect(() => endShare, []);

  useLiveShareSession({ socket, watchPosition });

  useEffect(() => {
    if (!endedReason) return;
    const text = liveShareEndedText(endedReason);
    if (text) toast(text, endedReason === 'expired' ? 'info' : 'error');
    useLiveLocationStore.getState().clearShareEnded();
  }, [endedReason, toast]);

  const [nowTick, setNowTick] = useState(() => Date.now());
  const hasIntent = intent !== null;
  useEffect(() => {
    if (!hasIntent) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [hasIntent]);

  if (!intent) return null;

  const expiresMs = Date.parse(intent.expiresAt);
  const countdown = formatCountdown(expiresMs - nowTick);
  const clock = fmtZonedClock(expiresMs);
  const paused = intent.paused;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sharing-indicator"
      className="shrink-0 flex items-center gap-3 border-b border-accent-aqua bg-accent-aqua/10 px-4 py-2"
    >
      {paused ? (
        <span className="w-2 h-2 shrink-0 rounded-full border-2 border-accent-aqua" aria-hidden="true" />
      ) : (
        <span className="festie-live-dot" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">
          {paused ? LIVE_SHARE_COPY.pausedTitle : LIVE_SHARE_COPY.sharingTitle}
        </p>
        <p className="text-xs text-text-muted">
          {paused ? LIVE_SHARE_COPY.pausedSub(countdown, clock) : LIVE_SHARE_COPY.sharingSub(countdown, clock)}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => useLiveLocationStore.getState().setSharePaused(!paused)}
        aria-label={paused ? LIVE_SHARE_COPY.resumeA11y : LIVE_SHARE_COPY.pauseA11y}
      >
        {paused ? <Play className="w-4 h-4" aria-hidden="true" /> : <Pause className="w-4 h-4" aria-hidden="true" />}{' '}
        {paused ? LIVE_SHARE_COPY.resume : LIVE_SHARE_COPY.pause}
      </Button>
      <Button variant="outline" size="sm" onClick={endShare} aria-label={LIVE_SHARE_COPY.stopA11y}>
        <Square className="w-4 h-4" aria-hidden="true" /> {LIVE_SHARE_COPY.stop}
      </Button>
    </div>
  );
}
