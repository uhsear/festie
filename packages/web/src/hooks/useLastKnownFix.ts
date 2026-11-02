import { useEffect, useState } from 'react';
import type { Coord } from '@festie/shared/utils';
import { RECENT_FIX_MS } from '@festie/shared/utils';

export interface LastKnownFix {
  coord: Coord | null;
  at: number | null;
}

const REREAD_MS = 120_000;
const NONE: LastKnownFix = { coord: null, at: null };

/**
 * The browser's recent position, read only when location permission is already
 * granted. It never prompts, and the fix stays in React state.
 */
export function useLastKnownFix(): LastKnownFix {
  const [fix, setFix] = useState<LastKnownFix>(NONE);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query || !navigator.geolocation) return;
    let cancelled = false;
    // Re-check every read: the user can revoke or grant the permission mid-session.
    const read = () => {
      if (document.visibilityState === 'hidden') return;
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (cancelled || status.state !== 'granted') return;
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (cancelled) return;
              setFix({ coord: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, at: pos.timestamp });
            },
            () => {},
            { enableHighAccuracy: false, maximumAge: RECENT_FIX_MS, timeout: 10_000 },
          );
        })
        .catch((err) => console.warn('Location permission query failed', err));
    };

    read();
    const timer = setInterval(read, REREAD_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return fix;
}
