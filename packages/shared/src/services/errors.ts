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
 * rate-limited / server / client failures. Non-ApiClientErrors fall back to
 * their `.message` (or the provided fallback), so plain-Error call sites and
 * existing message assertions are unaffected.
 */
export function mapErrorToUserMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (isApiClientError(err)) {
    if (err.isNetworkError || err.status === 0) {
      return "You're offline. Check your connection and try again.";
    }
    if (err.status === 429) {
      const ms = parseRetryAfterMs(err.retryAfter);
      const secs = ms != null ? Math.ceil(ms / 1000) : null;
      if (!secs) return 'Too many tries. Wait a moment and try again.';
      return `Too many tries. Wait ${secs} ${secs === 1 ? 'second' : 'seconds'} and try again.`;
    }
    if (err.status === 423) {
      const ms = parseRetryAfterMs(err.retryAfter);
      if (ms == null) return 'This account is locked after too many failed sign-ins. Try again later, or reset your password.';
      const n = Math.max(1, Math.ceil(ms / 60000));
      return `This account is locked after too many failed sign-ins. Try again in ${n} minute${n === 1 ? '' : 's'}, or reset your password.`;
    }
    if (err.status >= 500) return 'Something went wrong on our side. Try again in a minute.';
    return err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

/** True when a reset-password call failed because the link expired or was already used. */
export function isResetLinkExpired(err: unknown): boolean {
  return isApiClientError(err) && err.code === 'TOKEN_EXPIRED';
}
