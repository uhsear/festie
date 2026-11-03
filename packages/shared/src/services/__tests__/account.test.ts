import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '../api';
import { exportErrorMessage, fetchAccountExport } from '../account';
import { DATA_COPY } from '../../constants/privacyCopy';

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;
const err = (status: number, retryAfter?: string, extra: object = {}) =>
  Object.assign(new Error('x'), { name: 'ApiClientError', status, retryAfter, ...extra });
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

describe('exportErrorMessage', () => {
  it('429 with Retry-After in the morning says today', () => {
    const now = new Date(2026, 5, 10, 9, 0, 0).getTime();
    expect(exportErrorMessage(err(429, '3600'), now)).toBe(DATA_COPY.limit('today', clock(now + 3600_000)));
  });

  it('429 late at night says tomorrow', () => {
    const now = new Date(2026, 5, 10, 23, 30, 0).getTime();
    expect(exportErrorMessage(err(429, '3600'), now)).toBe(DATA_COPY.limit('tomorrow', clock(now + 3600_000)));
  });

  it('429 without Retry-After has no time', () => {
    expect(exportErrorMessage(err(429))).toBe(DATA_COPY.limitNoTime);
  });

  it('500 gives the server-problem text', () => {
    expect(exportErrorMessage(err(500))).toBe('Something went wrong on our side. Try again in a minute.');
  });

  it('a network error gives the offline text', () => {
    expect(exportErrorMessage(err(0, undefined, { isNetworkError: true }))).toBe(
      "You're offline. Check your connection and try again.",
    );
  });
});

describe('fetchAccountExport', () => {
  beforeEach(() => mockGet.mockReset());

  it('asks for a 60 second timeout', async () => {
    mockGet.mockResolvedValue({ exportVersion: '1.2' });
    await fetchAccountExport();
    expect(mockGet).toHaveBeenCalledWith('/account/export', { timeoutMs: 60000 });
  });
});
