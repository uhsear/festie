export const PUSH_BACKOFF_MS = 60_000;

/** True for an HTTP 429 from the API client (limit is 5/min on /notifications/token). */
export const isRateLimited = (e: unknown): boolean => (e as { status?: number } | null)?.status === 429;

/**
 * Collapse bursts of identical sends. Concurrent calls with the same key share one
 * request, and the key is remembered BEFORE awaiting, so a reconcile storm cannot
 * pass a check-then-act on persisted state. After a 429 nothing is sent for `backoffMs`.
 * A failed send forgets its key so a later call can retry; the error still reaches the caller.
 */
export function createSendGuard(now: () => number = Date.now, backoffMs = PUSH_BACKOFF_MS) {
  let lastKey: string | null = null;
  let blockedUntil = 0;
  const inFlight = new Map<string, Promise<void>>();

  return {
    async run(key: string, send: () => Promise<void>): Promise<void> {
      const pending = inFlight.get(key);
      if (pending) return pending;
      if (key === lastKey || now() < blockedUntil) return;
      const previous = lastKey;
      lastKey = key;
      const promise = send().catch((e) => {
        lastKey = previous;
        if (isRateLimited(e)) blockedUntil = now() + backoffMs;
        throw e;
      }).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
    /** Forget what was sent, e.g. after register or sign-out changes the server row. */
    reset(): void {
      lastKey = null;
    },
  };
}
