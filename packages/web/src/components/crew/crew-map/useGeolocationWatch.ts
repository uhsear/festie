// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { geoStateFromErrorCode, type Coord, type GeoState } from '@festie/shared/utils';

export type { GeoState };

export interface GeolocationWatch {
  /** The user's own GPS fix, or null until they enable location / on failure. */
  selfCoord: Coord | null;
  /** The fix's reported accuracy radius in metres, or null when unknown. */
  accuracyM: number | null;
  geoState: GeoState;
  /** Start a continuous browser geolocation watch (idempotent while active). */
  enableLocation: () => void;
  /** Stop any watch and start again (after a weak signal or a blocked prompt). */
  retryLocation: () => void;
}

/**
 * Browser geolocation watch for pursue / nearest-X. A continuous `watchPosition`
 * keeps `selfCoord` fresh as the user moves so the arrow + ETA recompute live.
 * Low-power mode lowers accuracy and accepts older fixes (the watch restarts when
 * it flips). The watch stops while the tab is hidden and resumes when it is
 * visible again, and is torn down on unmount.
 */
export function useGeolocationWatch(): GeolocationWatch {
  const [selfCoord, setSelfCoord] = useState<Coord | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [geoState, setGeoState] = useState<GeoState>('idle');
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const watchIdRef = useRef<number | null>(null);
  // The user enabled location; survives a hidden tab so the watch can resume.
  const wantedRef = useRef(false);
  const lowPowerRef = useRef(lowPowerMode);
  lowPowerRef.current = lowPowerMode;

  const clearWatch = useCallback(() => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (geo && watchIdRef.current != null) geo.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }, []);

  const startWatch = useCallback(() => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      setGeoState('unavailable');
      return;
    }
    if (watchIdRef.current != null) return; // already watching
    setGeoState((s) => (s === 'on' ? s : 'locating'));
    watchIdRef.current = geo.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setSelfCoord({ latitude, longitude });
          setAccuracyM(Number.isFinite(accuracy) ? accuracy : null);
          setGeoState('on');
        }
      },
      (err) => {
        if (geoStateFromErrorCode(err?.code) === 'denied') {
          setGeoState('denied');
          wantedRef.current = false;
          clearWatch();
          return;
        }
        // A timeout or lost signal is not a refusal: keep watching so a later fix wins.
        setGeoState((s) => (s === 'on' ? s : 'unavailable'));
      },
      lowPowerRef.current
        ? { enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 }
        : { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  }, [clearWatch]);

  const enableLocation = useCallback(() => {
    wantedRef.current = true;
    startWatch();
  }, [startWatch]);

  const retryLocation = useCallback(() => {
    clearWatch();
    enableLocation();
  }, [clearWatch, enableLocation]);

  // Restart with the new options when low-power mode flips mid-watch.
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    if (watchIdRef.current == null) return;
    clearWatch();
    startWatch();
  }, [lowPowerMode, clearWatch, startWatch]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearWatch();
      else if (wantedRef.current) startWatch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearWatch();
    };
  }, [clearWatch, startWatch]);

  return { selfCoord, accuracyM, geoState, enableLocation, retryLocation };
}
