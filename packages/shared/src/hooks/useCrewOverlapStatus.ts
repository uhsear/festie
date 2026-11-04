import { useCallback, useEffect, useState } from 'react';
import { useCrewStore } from '../stores/crewStore';

export type CrewOverlapStatus = 'idle' | 'loading' | 'ready' | 'error';

const LOAD_TIMEOUT_MS = 5000;
// The crew whose overlap is in the store from this session. The store's empty start value
// looks the same as "nobody overlaps", so only a finished load counts.
let loadedCrewId: string | null = null;

/** Test hook: forget the session's loaded crew. */
export function clearCrewOverlapStatusCache() {
  loadedCrewId = null;
}

/**
 * Loads the active crew's overlap while `enabled` (the image's crew mode). A crew loaded
 * earlier this session is ready at once and refreshes in the background. A first load
 * that takes longer than 5 s, or fails, reports 'error'; `retry` tries again.
 */
export function useCrewOverlapStatus(enabled: boolean, fallbackFestivalId?: string) {
  const crewId = useCrewStore((s) => s.activeCrew?.id);
  const crewFestivalId = useCrewStore((s) => s.activeCrew?.festivalId);
  const loadOverlap = useCrewStore((s) => s.loadOverlap);
  const [status, setStatus] = useState<CrewOverlapStatus>('idle');
  const [attempt, setAttempt] = useState(0);
  const festivalId = crewFestivalId ?? fallbackFestivalId;

  useEffect(() => {
    if (!enabled || !crewId || !festivalId) {
      setStatus('idle');
      return;
    }
    let live = true;
    const cached = loadedCrewId === crewId;
    setStatus(cached ? 'ready' : 'loading');
    const timer = cached ? undefined : setTimeout(() => live && setStatus('error'), LOAD_TIMEOUT_MS);
    loadOverlap(crewId, festivalId).then(
      () => {
        loadedCrewId = crewId;
        if (live) setStatus('ready');
      },
      (err: unknown) => {
        console.warn('crew overlap: load failed', err);
        if (live && !cached) setStatus('error');
      },
    ).finally(() => clearTimeout(timer));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, crewId, festivalId, loadOverlap, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, retry };
}
