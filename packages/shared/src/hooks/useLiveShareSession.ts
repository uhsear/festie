import { useEffect } from 'react';
import type { Socket } from '../services/socket';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useFestivalModeStore } from '../stores/festivalModeStore';
import { useLiveLocationPublisher, type GeoWatcher } from './useLiveLocationPublisher';

/** Browser PERMISSION_DENIED (code 1) or an expo-location permission error. */
function isPermissionDenied(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as { code?: unknown }).code === 1) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /permission/i.test(message);
}

/**
 * Runs the user's live-share session from the shared store, so no screen change
 * stops it. Mount once, app-wide. Pause stops the publisher but not the end timer.
 * A background intent turns the socket publisher off, but the end timer and low-power rule still apply.
 */
export function useLiveShareSession({ socket, watchPosition }: { socket: Socket | null; watchPosition: GeoWatcher }): void {
  const intent = useLiveLocationStore((s) => s.shareIntent);
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const endShare = useLiveLocationStore.getState().endShare;
  const hasIntent = intent !== null;
  const expiresAt = intent?.expiresAt;

  useEffect(() => {
    if (lowPowerMode && hasIntent) endShare('low-power');
  }, [lowPowerMode, hasIntent, endShare]);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => endShare('expired'), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, endShare]);

  useLiveLocationPublisher({
    socket,
    crewId: intent?.crewId ?? null,
    enabled: !!intent && !intent.paused && !intent.background,
    watchPosition,
    expiresAt: intent?.expiresAt,
    shareBattery: intent?.shareBattery ?? false,
    onAutoStop: () => endShare('expired'),
    onError: (err) => endShare(isPermissionDenied(err) ? 'denied' : 'error'),
    onShareRejected: () => endShare('rejected'),
  });
}
