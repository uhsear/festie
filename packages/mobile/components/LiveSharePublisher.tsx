// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * LiveSharePublisher — the app-wide mobile host for live location sharing.
 *
 * Mounted once in app/_layout.tsx so no tab or screen change stops a share. It
 * runs the shared session (`useLiveShareSession`) from the `shareIntent` that
 * CrewLiveLocation writes to liveLocationStore. Foreground-only until T41: when
 * the app goes inactive or background, the session ends with 'background'.
 * Renders nothing.
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState, Alert, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { useLiveShareSession, type GeoWatcher } from '@festie/shared/hooks';
import { useLiveLocationStore } from '@festie/shared/stores';
import { LIVE_LOCATION } from '@festie/shared/constants';
import { liveShareEndedText } from '@festie/shared/utils';
import { useLiveSocket } from '../lib/liveSocket';

export default function LiveSharePublisher() {
  const socket = useLiveSocket();
  const endShare = useLiveLocationStore((s) => s.endShare);
  const clearShareEnded = useLiveLocationStore((s) => s.clearShareEnded);
  const shareEndedReason = useLiveLocationStore((s) => s.shareEndedReason);

  // Phase 4C battery: cache the latest battery % so each GPS fix can attach it
  // SYNCHRONOUSLY without awaiting a native read in the publish path — a slow or
  // failed battery read must never block (or fail) a location send. Seeded once,
  // then kept fresh by the OS battery-level listener. Fully optional + resilient:
  // any failure leaves the ref undefined and the peer popup simply omits the chip.
  const batteryPctRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let sub: ReturnType<typeof Battery.addBatteryLevelListener> | null = null;
    // getBatteryLevelAsync returns 0–1 (or -1 when unknown, e.g. some emulators).
    const setFromLevel = (level: number) => {
      if (active && typeof level === 'number' && level >= 0) {
        batteryPctRef.current = Math.round(level * 100);
      }
    };
    Battery.getBatteryLevelAsync()
      .then(setFromLevel)
      .catch(() => {
        /* battery unreadable — leave undefined so the chip is omitted */
      });
    try {
      sub = Battery.addBatteryLevelListener(({ batteryLevel }) => setFromLevel(batteryLevel));
    } catch {
      /* listener unavailable — the seeded value (if any) is still used */
    }
    return () => {
      active = false;
      sub?.remove();
    };
  }, []);

  // Peer low-power flag (#5): cache whether the device is in battery-saver /
  // low-power mode so each GPS fix can attach it SYNCHRONOUSLY (same pattern as
  // battery above — no awaiting a native read in the publish path). Seeded once,
  // then kept fresh by the OS low-power-mode listener. Fully optional + resilient:
  // any failure leaves the ref undefined and the peer popup simply omits the cue.
  const lowPowerRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let sub: ReturnType<typeof Battery.addLowPowerModeListener> | null = null;
    Battery.isLowPowerModeEnabledAsync()
      .then((enabled) => {
        if (active && typeof enabled === 'boolean') lowPowerRef.current = enabled;
      })
      .catch(() => {
        /* low-power state unreadable — leave undefined so the cue is omitted */
      });
    try {
      sub = Battery.addLowPowerModeListener(({ lowPowerMode }) => {
        if (active && typeof lowPowerMode === 'boolean') lowPowerRef.current = lowPowerMode;
      });
    } catch {
      /* listener unavailable — the seeded value (if any) is still used */
    }
    return () => {
      active = false;
      sub?.remove();
    };
  }, []);

  // expo-location → GeoFix adapter for the shared publisher. watchPositionAsync
  // is async; we hold the subscription and tear it down synchronously. The shared
  // publisher strips battery and lowPower unless the sharer opted in.
  const watchPosition = useCallback<GeoWatcher>((onFix, onError) => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: LIVE_LOCATION.UPDATE_INTERVAL_MS,
        distanceInterval: LIVE_LOCATION.MIN_MOVE_METERS,
      },
      (pos) => {
        onFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
          heading: pos.coords.heading ?? undefined,
          speed: pos.coords.speed ?? undefined,
          battery: batteryPctRef.current,
          lowPower: lowPowerRef.current,
          capturedAt: new Date(pos.timestamp).toISOString(),
        });
      },
    )
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch((err) => onError?.(err));
    return () => {
      cancelled = true;
      sub?.remove();
      sub = null;
    };
  }, []);

  useLiveShareSession({ socket, watchPosition });

  // Foreground-only: stop sharing the moment the app backgrounds so the toggle
  // is OFF when the user returns (useRealtimeSync emits the server-side stop).
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next.match(/inactive|background/)) endShare('background');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [endShare]);

  // 'background' and 'low-power' get an inline notice in CrewLiveLocation.
  useEffect(() => {
    if (shareEndedReason !== 'expired' && shareEndedReason !== 'error' && shareEndedReason !== 'denied') return;
    Alert.alert('Sharing stopped', liveShareEndedText(shareEndedReason));
    clearShareEnded();
  }, [shareEndedReason, clearShareEnded]);

  return null;
}
