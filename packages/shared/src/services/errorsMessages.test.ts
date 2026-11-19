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

  it('maps a 429 with no delay to a moment', () => {
    expect(mapErrorToUserMessage(apiError(429))).toBe('Too many tries. Wait a moment and try again.');
  });

  it('maps a 5xx to the server copy', () => {
    expect(mapErrorToUserMessage(apiError(503))).toBe('Something went wrong on our side. Try again in a minute.');
  });

  it('passes a 4xx message through', () => {
    expect(mapErrorToUserMessage(apiError(400, {}, 'Name is required'), 'Fallback')).toBe('Name is required');
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
