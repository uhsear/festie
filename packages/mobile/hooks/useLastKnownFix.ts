import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useFestivalModeStore } from '@festie/shared/stores';
import { RECENT_FIX_MS, type Coord } from '@festie/shared/utils';

const REREAD_MS = 120_000;

/**
 * Last known device position for Now & Next. Never prompts: it reads only when
 * location permission is already granted. Re-reads every 2 minutes while mounted.
 */
export function useLastKnownFix(): { coord: Coord | null; at: number | null } {
  const [fix, setFix] = useState<{ coord: Coord | null; at: number | null }>({ coord: null, at: null });
  const lowPower = useFestivalModeStore((s) => s.lowPowerMode);
  const lowPowerRef = useRef(lowPower);
  useEffect(() => {
    lowPowerRef.current = lowPower;
  }, [lowPower]);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        let pos = await Location.getLastKnownPositionAsync({ maxAge: RECENT_FIX_MS });
        if (!pos && !lowPowerRef.current) {
          pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        }
        if (!pos || cancelled) return;
        setFix({ coord: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, at: pos.timestamp });
      } catch (err) {
        console.warn('useLastKnownFix', err);
      }
    };
    void read();
    const timer = setInterval(() => void read(), REREAD_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return fix;
}
