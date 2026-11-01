import { describe, it, expect } from 'vitest';
import { mapErrorToUserMessage } from './errors';

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
