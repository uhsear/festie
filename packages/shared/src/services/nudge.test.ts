import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nudgeCrewMember, nudgeErrorMessage } from './nudge';
import { api, ApiClientError, isOfflineEligible } from './api';

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}));

describe('nudgeCrewMember', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it('posts online-only to the member nudge route', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ nudged: true });
    await expect(nudgeCrewMember('c', 'u')).resolves.toEqual({ nudged: true });
    expect(api.post).toHaveBeenCalledWith('/crews/c/members/u/nudge', {}, { _bypassOfflineQueue: true });
  });

  it('is never eligible for the offline queue', () => {
    expect(isOfflineEligible('/crews/c/members/u/nudge')).toBe(false);
  });
});

describe('nudgeErrorMessage', () => {
  const err = (status: number, network = false) => new ApiClientError('x', status, undefined, undefined, network);

  it('maps each status', () => {
    expect(nudgeErrorMessage(err(0, true), 'Ana')).toBe('No signal. Nothing was sent.');
    expect(nudgeErrorMessage(err(0), 'Ana')).toBe('No signal. Nothing was sent.');
    expect(nudgeErrorMessage(err(429), 'Ana')).toBe('You told Ana in the last 5 minutes. Try again later.');
    expect(nudgeErrorMessage(err(403), 'Ana')).toBe("You're not in this crew any more.");
    expect(nudgeErrorMessage(err(404), 'Ana')).toBe('Ana is no longer in this crew.');
    expect(nudgeErrorMessage(err(503), 'Ana')).toBe('"Looking for you" is not available right now.');
  });

  it('falls back for a 500 and for non-API errors', () => {
    expect(nudgeErrorMessage(undefined, 'Ana')).toBe("Couldn't send it. Try again.");
    expect(nudgeErrorMessage(err(500), 'Ana')).toBe('Something went wrong on our side. Try again in a minute.');
  });
});
