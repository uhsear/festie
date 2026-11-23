import { describe, it, expect } from 'vitest';
import { mapErrorToUserMessage, isResetLinkExpired } from './errors';

function apiError(status: number, extra: Record<string, unknown> = {}, message = 'Bad thing') {
  return Object.assign(new Error(message), { name: 'ApiClientError', status, isNetworkError: false, ...extra });
}

describe('mapErrorToUserMessage', () => {
  it('maps a network error to the offline copy', () => {
    expect(mapErrorToUserMessage(apiError(0, { isNetworkError: true }))).toBe(
      "You're offline. Check your connection and try again.",
    );
  });

  it('uses the singular for a 1 second Retry-After', () => {
    expect(mapErrorToUserMessage(apiError(429, { retryAfter: '1' }))).toBe(
      'Too many tries. Wait 1 second and try again.',
    );
  });

  it('uses the plural for a 30 second Retry-After', () => {
    expect(mapErrorToUserMessage(apiError(429, { retryAfter: '30' }))).toBe(
      'Too many tries. Wait 30 seconds and try again.',
    );
  });

  it('maps a 429 with no delay and no reason to a moment', () => {
    expect(mapErrorToUserMessage(apiError(429, {}, ''))).toBe('Too many tries. Wait a moment and try again.');
  });

  it('shows the server reason for a 429 flagged as a cap (a daily limit)', () => {
    expect(
      mapErrorToUserMessage(apiError(429, { details: { cap: true } }, 'Your organization can send 3 announcements a day. Try again tomorrow.')),
    ).toBe('Your organization can send 3 announcements a day. Try again tomorrow.');
  });

  it('keeps the generic words for the per-account login 429, which has no Retry-After and no cap flag', () => {
    expect(mapErrorToUserMessage(apiError(429, {}, 'Too many login attempts for this account'))).toBe(
      'Too many tries. Wait a moment and try again.',
    );
  });

  it('keeps the generic words for the resend-verification 429 whose text names a delay in seconds', () => {
    expect(mapErrorToUserMessage(apiError(429, {}, 'Too many verification emails sent to this address. Try again in 3600s'))).toBe(
      'Too many tries. Wait a moment and try again.',
    );
  });

  it('keeps the wait copy for a 429 with Retry-After even when it has a message', () => {
    expect(mapErrorToUserMessage(apiError(429, { retryAfter: '30' }, 'Too many requests'))).toBe(
      'Too many tries. Wait 30 seconds and try again.',
    );
  });

  it('maps a 5xx to the server copy', () => {
    expect(mapErrorToUserMessage(apiError(503))).toBe('Something went wrong on our side. Try again in a minute.');
  });

  it('passes a 4xx message through', () => {
    expect(mapErrorToUserMessage(apiError(400, {}, 'Name is required'), 'Fallback')).toBe('Name is required');
  });

  it('replaces a raw push-service failure with the fallback', () => {
    const abort = Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' });
    expect(mapErrorToUserMessage(abort, "Couldn't turn on notifications. Try again.")).toBe(
      "Couldn't turn on notifications. Try again.",
    );
    expect(mapErrorToUserMessage(new Error('Registration failed - push service error'), 'Fallback')).toBe('Fallback');
  });

  it('uses a plain Error message', () => {
    expect(mapErrorToUserMessage(new Error('x'), 'Fallback')).toBe('x');
  });

  it('uses the fallback for a non-error, and the default fallback without one', () => {
    expect(mapErrorToUserMessage('boom', "Couldn't save. Try again.")).toBe("Couldn't save. Try again.");
    expect(mapErrorToUserMessage(null)).toBe('Something went wrong. Try again.');
  });
});

describe('423 lockout', () => {
  it('names the wait in minutes', () => {
    expect(mapErrorToUserMessage(apiError(423, { retryAfter: '900' }))).toContain('Try again in 15 minutes');
  });
  it('rounds a short wait up to 1 minute', () => {
    expect(mapErrorToUserMessage(apiError(423, { retryAfter: '30' }))).toContain('Try again in 1 minute,');
  });
  it('falls back to later without Retry-After', () => {
    expect(mapErrorToUserMessage(apiError(423))).toContain('Try again later');
  });
});

describe('isResetLinkExpired', () => {
  it('is true only for TOKEN_EXPIRED', () => {
    expect(isResetLinkExpired(apiError(400, { code: 'TOKEN_EXPIRED' }))).toBe(true);
    expect(isResetLinkExpired(apiError(400, { code: 'INVALID_INPUT' }))).toBe(false);
    expect(isResetLinkExpired(new Error('x'))).toBe(false);
  });
});
