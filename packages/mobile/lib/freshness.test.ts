import { freshnessFor, LIVE_MAX_AGE_MS, AGING_MAX_AGE_MS } from './freshness';

describe('freshnessFor', () => {
  const now = 1_000_000_000_000;

  it('is live for a recent cache and for clock skew', () => {
    expect(freshnessFor(now - 30_000, now)).toBe('live');
    expect(freshnessFor(now + 10_000, now)).toBe('live');
  });

  it('turns aging at the live threshold', () => {
    expect(freshnessFor(now - LIVE_MAX_AGE_MS, now)).toBe('aging');
    expect(freshnessFor(now - (AGING_MAX_AGE_MS - 1), now)).toBe('aging');
  });

  it('turns stale at the aging threshold, e.g. a 3 day old cache', () => {
    expect(freshnessFor(now - AGING_MAX_AGE_MS, now)).toBe('stale');
    expect(freshnessFor(now - 3 * 86_400_000, now)).toBe('stale');
  });
});
