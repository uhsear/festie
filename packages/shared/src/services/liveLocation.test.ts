import { describe, it, expect, vi } from 'vitest';
import { postLiveFix, stopLiveFix, isTerminalLiveFixError } from './liveLocation';
import { api, ApiClientError, isOfflineEligible } from './api';

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  api: { post: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) },
}));

describe('live fix service', () => {
  it('posts the fix with an 8 s timeout', async () => {
    const body = { lat: 1, lng: 2, capturedAt: 'a', expiresAt: 'b' };
    await postLiveFix('c 1', body);
    expect(api.post).toHaveBeenCalledWith('/crews/c%201/live-location', body, { timeoutMs: 8000 });
  });

  it('deletes with an 8 s timeout', async () => {
    await stopLiveFix('c1');
    expect(api.delete).toHaveBeenCalledWith('/crews/c1/live-location', { timeoutMs: 8000 });
  });

  it('is never queued offline', () => {
    expect(isOfflineEligible('/crews/abc/live-location')).toBe(false);
  });

  it('classifies terminal errors', () => {
    for (const status of [400, 401, 403, 404, 503]) {
      expect(isTerminalLiveFixError(new ApiClientError('x', status))).toBe(true);
    }
    for (const status of [429, 500]) {
      expect(isTerminalLiveFixError(new ApiClientError('x', status))).toBe(false);
    }
    expect(isTerminalLiveFixError(new ApiClientError('x', 0, undefined, null, true))).toBe(false);
    expect(isTerminalLiveFixError(new TypeError('Network request failed'))).toBe(false);
  });
});
