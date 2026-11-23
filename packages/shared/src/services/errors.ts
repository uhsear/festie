import type { ApiClientError } from './api';

/**
 * Error-classification helpers, kept in their own module (no runtime dependency
 * on api.ts — `ApiClientError` is a type-only import) so that tests which
 * `vi.mock('../services/api')` to stub the network layer don't clobber these
 * pure functions. Duck-typed (no `instanceof`) so they also survive module
 * mocks / realm boundaries.
 */

/** True when `err` looks like an ApiClientError (status + network/retry shape). */
export function isApiClientError(err: unknown): err is ApiClientError {
  return (
    typeof err === 'object' && err !== null &&
    typeof (err as { status?: unknown }).status === 'number' &&
    ('isNetworkError' in err || 'retryAfter' in err || (err as { name?: unknown }).name === 'ApiClientError')
  );
}

/**
 * Normalize an HTTP `Retry-After` value to milliseconds. The header may be
 * delta-seconds ("120") OR an HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT").
 * Returns null if unparseable.
 */
export function parseRetryAfterMs(retryAfter: number | string | null | undefined): number | null {
  if (retryAfter == null) return null;
  if (typeof retryAfter === 'number') return Math.max(0, Math.round(retryAfter * 1000));
  const s = String(retryAfter).trim();
  if (s === '') return null;
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10) * 1000);
  const when = Date.parse(s);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

/**
 * Map any thrown error to a user-facing message that distinguishes offline /
 * rate-limited / server / client failures. A VALIDATION_ERROR drops the
 * server's leading `field.path: ` so users see plain words. Non-ApiClientErrors fall back to
 * their `.message` (or the provided fallback), so plain-Error call sites and
 * existing message assertions are unaffected. The exception is a raw browser or
 * push-service failure (AbortError, "Registration failed - push service error"):
 * those strings mean nothing to a user, so the fallback is used instead.
 */
export function mapErrorToUserMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (isApiClientError(err)) {
    if (err.isNetworkError || err.status === 0) {
      return "You're offline. Check your connection and try again.";
    }
    if (err.status === 429) {
      const ms = parseRetryAfterMs(err.retryAfter);
      const secs = ms != null ? Math.ceil(ms / 1000) : null;
      // A business cap (daily limit) flags itself with `cap` and carries its own reason; waiting would not help.
      // Any other 429 without Retry-After keeps the generic words: its server text can name an account or an address.
      if (!secs) return err.details?.cap === true && err.message ? err.message : 'Too many tries. Wait a moment and try again.';
      return `Too many tries. Wait ${secs} ${secs === 1 ? 'second' : 'seconds'} and try again.`;
    }
    if (err.status === 423) {
      const ms = parseRetryAfterMs(err.retryAfter);
      if (ms == null) return 'This account is locked after too many failed sign-ins. Try again later, or reset your password.';
      const n = Math.max(1, Math.ceil(ms / 60000));
      return `This account is locked after too many failed sign-ins. Try again in ${n} minute${n === 1 ? '' : 's'}, or reset your password.`;
    }
    if (err.status >= 500) return 'Something went wrong on our side. Try again in a minute.';
    if (err.code === 'VALIDATION_ERROR') return err.message.replace(/^[\w.[\]]+: /, '') || fallback;
    return err.message || fallback;
  }
  if (err instanceof Error && (err.name === 'AbortError' || /registration failed|push service/i.test(err.message))) {
    return fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

/** True when a reset-password call failed because the link expired or was already used. */
export function isResetLinkExpired(err: unknown): boolean {
  return isApiClientError(err) && err.code === 'TOKEN_EXPIRED';
}

/** True when a call failed because the current password was wrong. */
export function isPasswordIncorrect(err: unknown): boolean {
  return isApiClientError(err) && err.code === 'PASSWORD_INCORRECT';
}

/**
 * Edge (Cloudflare tunnel) statuses that mean the origin never ran the request:
 * connection refused, timed out, unreachable, TLS failure, or tunnel down.
 */
const EDGE_NOT_PROCESSED = new Set([521, 522, 523, 525, 526, 527, 528, 529, 530]);

/** Edge statuses where the origin may already have committed the write before the answer was lost. */
const EDGE_MAYBE_PROCESSED = new Set([502, 503, 504, 520, 524]);

/** True when an edge status says the server is unreachable, so the failure is not a verdict on the write. */
export function isEdgeUnavailable(status: number | undefined): boolean {
  return status !== undefined && (EDGE_NOT_PROCESSED.has(status) || EDGE_MAYBE_PROCESSED.has(status));
}

/**
 * Whether a mutation that got this edge status may go to the offline queue. A queued write replays,
 * and the origin may have committed it already. PUT, PATCH and DELETE replay safely, because they
 * set a final value. A POST would create twice once its Idempotency-Key cache expires (5 min), so
 * it queues only when the origin certainly never ran it.
 */
export function canQueueOnEdgeError(status: number | undefined, method: string): boolean {
  if (!isEdgeUnavailable(status)) return false;
  const verb = method.toUpperCase();
  if (verb === 'POST') return EDGE_NOT_PROCESSED.has(status as number);
  return verb === 'PUT' || verb === 'PATCH' || verb === 'DELETE';
}

/** Cap on transient-failure replay attempts per queued write; at the cap the write is surfaced and dropped. */
export const MAX_RETRIES = 5;

/** Cap on edge-5xx replay attempts per entry; a higher bar than MAX_RETRIES because an outage is not the entry's fault, but one poison entry must not block the queue forever. */
export const MAX_EDGE_RETRIES = 5;

/**
 * What a replay failure means for a queued write.
 *  - hold-network / hold-edge: the origin is unreachable; keep the entry, stop the drain.
 *  - rate-limited: transient; wait out Retry-After, no retry consumed.
 *  - permanent: surface to the user and drop (4xx incl. 409, edge retries or MAX_RETRIES exhausted).
 *  - transient: keep the entry, count one retry.
 */
export type ReplayOutcome = 'hold-network' | 'hold-edge' | 'rate-limited' | 'permanent' | 'transient';

/** Classify a thrown replay error. Pure: the caller owns pacing, storage and surfacing. */
export function classifyReplayFailure(
  err: unknown,
  attempts: { retries?: number; edgeRetries?: number },
): ReplayOutcome {
  const { status, isNetworkError } = (err ?? {}) as { status?: number; isNetworkError?: boolean };
  if (status === 429) return 'rate-limited';
  if (isNetworkError === true) return 'hold-network';
  if (isEdgeUnavailable(status)) return (attempts.edgeRetries ?? 0) + 1 < MAX_EDGE_RETRIES ? 'hold-edge' : 'permanent';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'permanent';
  return (attempts.retries ?? 0) + 1 >= MAX_RETRIES ? 'permanent' : 'transient';
}
