import { describe, it, expect } from 'vitest';
import { freshnessFor, signalStateFor, signalGlows, signalAgeNumeral, LIVE_MAX_AGE_MS, AGING_MAX_AGE_MS } from './signalState';
import type { SignalState } from './signalState';

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

describe('signalStateFor', () => {
  const now = 1_000_000_000_000;
  it('lets offline win over a fresh cache', () => {
    expect(signalStateFor(now, true, now)).toBe('offline');
  });
  it('falls back to the cache age level online', () => {
    expect(signalStateFor(now - AGING_MAX_AGE_MS, false, now)).toBe('stale');
    expect(signalStateFor(now, false, now)).toBe('live');
  });
  it('keeps the glow for live only', () => {
    expect(['live', 'aging', 'stale', 'offline'].filter((s) => signalGlows(s as SignalState))).toEqual(['live']);
  });
});

describe('signalAgeNumeral', () => {
  const now = 1_000_000_000_000;
  it.each([
    [30_000, '<1m'],
    [-10_000, '<1m'],
    [4 * 60_000, '4m'],
    [2 * 3_600_000 + 5_000, '2h'],
    [3 * 86_400_000, '3d'],
  ])('age %i ms reads %s', (age, text) => {
    expect(signalAgeNumeral(now - age, now)).toBe(text);
  });
});
