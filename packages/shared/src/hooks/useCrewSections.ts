import { useCallback, useEffect, useRef, useState } from 'react';
import { useCrewStore } from '../stores/crewStore';
import { useUIStore } from '../stores/uiStore';
import { isApiClientError, parseRetryAfterMs } from '../services/errors';

export const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 30_000;
// The offline flag clears before the radio is usable, so the reload at reconnect can fail; one more try follows.
export const RECONNECT_RETRY_MS = 5000;

/** 429, 5xx and network failures can clear on their own; 4xx client errors cannot. */
export function isTransientError(err: unknown): boolean {
  return isApiClientError(err) && (err.status === 429 || err.status >= 500 || !!err.isNetworkError);
}

/** Retry-After wins (the server's own window); otherwise exponential backoff with jitter. */
export function retryDelayMs(err: unknown, attempt: number): number {
  const serverMs = isApiClientError(err) ? parseRetryAfterMs(err.retryAfter) : null;
  if (serverMs != null) return Math.min(serverMs, RETRY_CAP_MS);
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS) * (0.5 + Math.random() * 0.5);
}

/**
 * Runs `fn`, retrying transient failures up to RETRY_MAX_ATTEMPTS total. `isCancelled`
 * is checked after every wait so an unmounted or superseded caller stops retrying.
 */
export async function retryTransient<T>(fn: () => Promise<T>, isCancelled: () => boolean): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRY_MAX_ATTEMPTS || !isTransientError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(err, attempt)));
      if (isCancelled()) throw err;
    }
  }
}

/**
 * Loads a crew's polls, meeting points, packing list, rides and expenses, each with
 * bounded retry. `error` names the sections still failing; `reload` starts over
 * (a Try again tap, screen focus, app foreground). A failure left over from an offline
 * spell reloads at once when the connection returns. A new crew id or unmount cancels pending retries.
 */
export function useCrewSections(crewId: string | undefined): { error: string | null; reload: () => void } {
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // `afterReconnect` runs get one extra try, scheduled when that run settles, so Retry-After waits are never cut short.
  const load = useCallback((afterReconnect: boolean) => {
    const id = ++run.current;
    clearTimeout(retryTimer.current);
    if (!crewId) {
      setError(null);
      return;
    }
    const cancelled = () => run.current !== id;
    const s = useCrewStore.getState();
    const sections: [string, () => Promise<unknown>][] = [
      ['polls', () => s.loadPolls(crewId)],
      ['meeting points', () => s.loadMeetingPoints(crewId)],
      ['packing', () => s.loadPacking(crewId)],
      ['rides', () => s.loadRides(crewId)],
      ['expenses', () => s.loadExpenses(crewId)],
    ];
    // The loaders share one store `error` field, so collect failures locally instead.
    Promise.allSettled(sections.map(([, loadSection]) => retryTransient(loadSection, cancelled))).then((results) => {
      if (cancelled()) return;
      const failed = sections.filter((_, i) => results[i]?.status === 'rejected').map(([name]) => name);
      setError(failed.length ? `Failed to load: ${failed.join(', ')}` : null);
      if (afterReconnect && failed.length) retryTimer.current = setTimeout(() => load(false), RECONNECT_RETRY_MS);
    });
  }, [crewId]);

  const reload = useCallback(() => load(false), [load]);

  useEffect(() => {
    load(false);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- run is a counter, not a DOM ref; cleanup must bump the current value
      run.current++;
      clearTimeout(retryTimer.current);
    };
  }, [load]);

  // Offline, the loaders fail by design; do not leave that failure on screen until the next timed retry.
  const offlineMode = useUIStore((s) => s.offlineMode);
  const wasOffline = useRef(offlineMode);
  useEffect(() => {
    if (wasOffline.current && !offlineMode && error) load(true);
    wasOffline.current = offlineMode;
  }, [offlineMode, error, load]);

  return { error, reload };
}
