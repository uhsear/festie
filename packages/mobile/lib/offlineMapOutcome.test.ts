import { describe, it, expect } from 'vitest';
import { getMapOutcome, setMapOutcome, subscribeMapOutcome } from './offlineMapOutcome';

describe('offlineMapOutcome', () => {
  it('keeps an error and its message until cleared, and tells subscribers', () => {
    let calls = 0;
    const off = subscribeMapOutcome(() => (calls += 1));
    const error = { section: { status: 'error' as const, syncedAt: 1 }, message: 'Not enough free space' };
    setMapOutcome('https://x/a.pmtiles', error);
    expect(getMapOutcome('https://x/a.pmtiles')).toBe(error);
    expect(getMapOutcome('https://x/b.pmtiles')).toBeNull();
    setMapOutcome('https://x/a.pmtiles', null);
    expect(getMapOutcome('https://x/a.pmtiles')).toBeNull();
    expect(calls).toBe(2);
    off();
  });
});
