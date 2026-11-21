import { describe, it, expect } from 'vitest';
import { loadErrorMessage } from './loadErrorMessage';

const apiError = (status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('raw server text'), { name: 'ApiClientError', status, ...extra });

describe('loadErrorMessage', () => {
  it('says the device is offline for a network failure', () => {
    expect(loadErrorMessage(apiError(0, { isNetworkError: true }), 'fallback')).toBe(
      "You're offline. Check your connection and try again.",
    );
  });

  it('says the server failed for a 5xx', () => {
    expect(loadErrorMessage(apiError(503), 'fallback')).toBe('Something went wrong on our side. Try again in a minute.');
  });

  it('keeps the server message for other API errors', () => {
    expect(loadErrorMessage(apiError(403), 'fallback')).toBe('raw server text');
  });

  it('uses the fallback for an error that is not an API error, never its message', () => {
    expect(loadErrorMessage(new TypeError('x is undefined'), 'fallback')).toBe('fallback');
    expect(loadErrorMessage('oops', 'fallback')).toBe('fallback');
  });
});
