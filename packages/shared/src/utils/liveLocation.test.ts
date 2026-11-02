import { describe, it, expect } from 'vitest';
import {
  shouldPublishLocation,
  decideBackgroundFix,
  isPeerStale,
  headingToArrow,
  formatBatteryLabel,
  formatShareWindow,
  formatCountdown,
  liveShareOptions,
  sosSeenLabel,
  LOW_BATTERY_THRESHOLD,
  type LatLng,
} from './liveLocation';
import { LIVE_LOCATION } from '../constants/config';

const NOW = 1_000_000;
const A: LatLng = { lat: 40.0, lng: -74.0 };

describe('liveLocation.shouldPublishLocation', () => {
  it('publishes the first fix when there is no prior coord', () => {
    expect(shouldPublishLocation(null, A, NOW, NOW)).toBe(true);
    expect(shouldPublishLocation(undefined, A, NOW, NOW)).toBe(true);
  });

  it('publishes the first fix when lastSentAt is missing even with a prior coord', () => {
    expect(shouldPublishLocation(A, A, null, NOW)).toBe(true);
    expect(shouldPublishLocation(A, A, undefined, NOW)).toBe(true);
  });

  it('publishes once the update interval has elapsed even if stationary', () => {
    const last = NOW - LIVE_LOCATION.UPDATE_INTERVAL_MS;
    expect(shouldPublishLocation(A, A, last, NOW)).toBe(true);
  });

  it('does NOT publish a stationary phone before the interval elapses', () => {
    const last = NOW - (LIVE_LOCATION.UPDATE_INTERVAL_MS - 1);
    expect(shouldPublishLocation(A, A, last, NOW)).toBe(false);
  });

  it('publishes early when moved more than MIN_MOVE_METERS within the interval', () => {
    // ~0.01° latitude ≈ 1112 m, far beyond MIN_MOVE_METERS.
    const moved: LatLng = { lat: 40.01, lng: -74.0 };
    const last = NOW - 1_000; // within the interval
    expect(shouldPublishLocation(A, moved, last, NOW)).toBe(true);
  });

  it('does NOT publish for a sub-threshold jitter within the interval', () => {
    // ~1e-5° latitude ≈ 1.1 m, below MIN_MOVE_METERS (15 m).
    const jitter: LatLng = { lat: 40.00001, lng: -74.0 };
    const last = NOW - 1_000;
    expect(shouldPublishLocation(A, jitter, last, NOW)).toBe(false);
  });

  it('treats the interval boundary (>=) as elapsed', () => {
    const last = NOW - LIVE_LOCATION.UPDATE_INTERVAL_MS; // exactly the interval
    expect(shouldPublishLocation(A, A, last, NOW)).toBe(true);
  });
});

describe('liveLocation.isPeerStale', () => {
  it('treats a fresh fix (within FRESH_MS) as live', () => {
    expect(isPeerStale(NOW - (LIVE_LOCATION.FRESH_MS - 1), NOW)).toBe(false);
    expect(isPeerStale(NOW, NOW)).toBe(false);
  });

  it('treats a fix older than FRESH_MS as stale', () => {
    expect(isPeerStale(NOW - (LIVE_LOCATION.FRESH_MS + 1), NOW)).toBe(true);
  });

  it('treats the exact FRESH_MS boundary as still live (strict >)', () => {
    expect(isPeerStale(NOW - LIVE_LOCATION.FRESH_MS, NOW)).toBe(false);
  });

  it('accepts ISO strings as well as epoch ms', () => {
    const iso = new Date(NOW - (LIVE_LOCATION.FRESH_MS + 5_000)).toISOString();
    expect(isPeerStale(iso, NOW)).toBe(true);
  });

  it('never greys out a marker with an unknown/invalid timestamp', () => {
    expect(isPeerStale(null, NOW)).toBe(false);
    expect(isPeerStale(undefined, NOW)).toBe(false);
    expect(isPeerStale('not-a-date', NOW)).toBe(false);
  });

  it('honours a custom freshness window', () => {
    expect(isPeerStale(NOW - 5_000, NOW, 1_000)).toBe(true);
    expect(isPeerStale(NOW - 5_000, NOW, 10_000)).toBe(false);
  });
});

describe('liveLocation.headingToArrow', () => {
  it('maps the four cardinals to their arrow glyphs', () => {
    expect(headingToArrow(0)).toBe('↑');
    expect(headingToArrow(90)).toBe('→');
    expect(headingToArrow(180)).toBe('↓');
    expect(headingToArrow(270)).toBe('←');
  });

  it('rounds to the nearest 45° sector (intercardinals)', () => {
    expect(headingToArrow(44)).toBe('↗');
    expect(headingToArrow(45)).toBe('↗');
    expect(headingToArrow(135)).toBe('↘');
    expect(headingToArrow(225)).toBe('↙');
    expect(headingToArrow(315)).toBe('↖');
  });

  it('wraps 360 / negative / out-of-range headings back to North-ish', () => {
    expect(headingToArrow(360)).toBe('↑');
    expect(headingToArrow(720)).toBe('↑');
    expect(headingToArrow(-90)).toBe('←');
    expect(headingToArrow(-45)).toBe('↖');
  });

  it('returns null for absent / non-finite headings (no misleading arrow)', () => {
    expect(headingToArrow(null)).toBeNull();
    expect(headingToArrow(undefined)).toBeNull();
    expect(headingToArrow(NaN)).toBeNull();
    expect(headingToArrow(Infinity)).toBeNull();
  });
});

describe('liveLocation.formatBatteryLabel', () => {
  it('shows a bare percentage when healthy', () => {
    expect(formatBatteryLabel(85)).toBe('85%');
    expect(formatBatteryLabel(100)).toBe('100%');
  });

  it('appends a regroup nudge at/below the low threshold', () => {
    expect(formatBatteryLabel(8)).toBe('8% — regroup');
    expect(formatBatteryLabel(LOW_BATTERY_THRESHOLD)).toBe(`${LOW_BATTERY_THRESHOLD}% — regroup`);
    expect(formatBatteryLabel(0)).toBe('0% — regroup');
  });

  it('rounds fractional levels before formatting', () => {
    expect(formatBatteryLabel(83.4)).toBe('83%');
    expect(formatBatteryLabel(20.6)).toBe('21%');
  });

  it('honours a custom low threshold', () => {
    expect(formatBatteryLabel(30, 50)).toBe('30% — regroup');
    expect(formatBatteryLabel(60, 50)).toBe('60%');
  });

  it('returns null for absent / out-of-range / non-finite levels', () => {
    expect(formatBatteryLabel(null)).toBeNull();
    expect(formatBatteryLabel(undefined)).toBeNull();
    expect(formatBatteryLabel(-1)).toBeNull();
    expect(formatBatteryLabel(101)).toBeNull();
    expect(formatBatteryLabel(NaN)).toBeNull();
  });
});

describe('liveLocation.formatShareWindow', () => {
  it('counts down whole minutes, rounding up', () => {
    expect(formatShareWindow(NOW + 4 * 60_000, NOW)).toBe('sharing ends in 4 min');
    expect(formatShareWindow(NOW + 3 * 60_000 + 1, NOW)).toBe('sharing ends in 4 min');
  });

  it('never shows 0 min while still live (clamps to 1 min)', () => {
    expect(formatShareWindow(NOW + 1, NOW)).toBe('sharing ends in 1 min');
    expect(formatShareWindow(NOW + 30_000, NOW)).toBe('sharing ends in 1 min');
  });

  it('accepts ISO strings as well as epoch ms', () => {
    const iso = new Date(NOW + 10 * 60_000).toISOString();
    expect(formatShareWindow(iso, NOW)).toBe('sharing ends in 10 min');
  });

  it('returns null once the window has elapsed or is absent/invalid', () => {
    expect(formatShareWindow(NOW, NOW)).toBeNull();
    expect(formatShareWindow(NOW - 1, NOW)).toBeNull();
    expect(formatShareWindow(null, NOW)).toBeNull();
    expect(formatShareWindow(undefined, NOW)).toBeNull();
    expect(formatShareWindow('not-a-date', NOW)).toBeNull();
  });
});

describe('liveLocation.formatCountdown', () => {
  it('formats minutes and hours', () => {
    expect(formatCountdown(59_000)).toBe('1 min');
    expect(formatCountdown(42 * 60_000)).toBe('42 min');
    expect(formatCountdown(60 * 60_000)).toBe('1 h');
    expect(formatCountdown(65 * 60_000)).toBe('1 h 5 min');
  });
});

describe('liveLocation.liveShareOptions', () => {
  const TZ = 'America/New_York';
  const DAYS = [{ date: '2026-09-04' }, { date: '2026-09-05' }];
  // 2026-09 is EDT (UTC-4).
  const ny = (date: string, hhmm: string) => {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, m] = hhmm.split(':').map(Number);
    return Date.UTC(y!, mo! - 1, d!, h! + 4, m!);
  };

  it('offers rest of today as the default at 20:00 on a festival day', () => {
    const { options, defaultId } = liveShareOptions({ days: DAYS, timeZone: TZ, nowMs: ny('2026-09-04', '20:00') });
    const day = options.find((o) => o.id === 'day');
    expect(day?.label).toBe('Rest of today (until 6:00 AM)');
    expect(day?.ms).toBe(10 * 3_600_000);
    expect(defaultId).toBe('day');
  });

  it('ends rest of today 1 hour after that day\'s last set', () => {
    const sets = [
      { startTime: '22:00', endTime: '23:30', dayIndex: 0 },
      { startTime: '23:45', endTime: '01:00', dayIndex: 0 },
      { startTime: '02:00', endTime: '04:00', dayIndex: 1 },
    ];
    const { options, defaultId } = liveShareOptions({ days: DAYS, sets, timeZone: TZ, nowMs: ny('2026-09-04', '20:00') });
    const day = options.find((o) => o.id === 'day');
    expect(day?.label).toBe('Rest of today (until 2:00 AM)');
    expect(day?.ms).toBe(6 * 3_600_000);
    expect(defaultId).toBe('day');
  });

  it('drops the day option with 30 minutes left and defaults to 2h', () => {
    const { options, defaultId } = liveShareOptions({ days: DAYS, timeZone: TZ, nowMs: ny('2026-09-05', '05:30') });
    expect(options.some((o) => o.id === 'day')).toBe(false);
    expect(defaultId).toBe('2h');
  });

  it('defaults to 2h outside the festival', () => {
    const { options, defaultId } = liveShareOptions({ days: DAYS, timeZone: TZ, nowMs: ny('2026-08-01', '12:00') });
    expect(options.some((o) => o.id === 'day')).toBe(false);
    expect(defaultId).toBe('2h');
  });
});

describe('liveLocation.sosSeenLabel', () => {
  const entry = (...names: string[]) => ({ seenBy: names.map((username) => ({ userId: username, username })) });
  it('names up to two viewers and counts the rest', () => {
    expect(sosSeenLabel(entry())).toBe('Not seen yet');
    expect(sosSeenLabel({})).toBe('Not seen yet');
    expect(sosSeenLabel(entry('Sam'))).toBe('Seen by Sam');
    expect(sosSeenLabel(entry('Sam', 'Alex'))).toBe('Seen by Sam and Alex');
    expect(sosSeenLabel(entry('Sam', 'Alex', 'Jo', 'Kim'))).toBe('Seen by Sam, Alex and 2 more');
  });
});

describe('liveLocation.decideBackgroundFix', () => {
  const EXPIRES = NOW + 60_000;
  const state = (lastSentAt: number | null, lastSentCoord: LatLng | null = A) => ({ expiresAtMs: EXPIRES, lastSentCoord, lastSentAt });

  it('expires at and after the end time', () => {
    expect(decideBackgroundFix(state(null, null), A, EXPIRES)).toBe('expire');
    expect(decideBackgroundFix(state(null, null), A, EXPIRES + 1)).toBe('expire');
  });

  it('sends the first fix', () => {
    expect(decideBackgroundFix(state(null, null), A, NOW)).toBe('send');
  });

  it('skips 5 s after the last send with no movement', () => {
    expect(decideBackgroundFix(state(NOW), A, NOW + 5_000)).toBe('skip');
  });

  it('sends after 10 s', () => {
    expect(decideBackgroundFix(state(NOW), A, NOW + 10_000)).toBe('send');
  });

  it('sends after a 20 m move', () => {
    const moved: LatLng = { lat: A.lat + 20 / 111_320, lng: A.lng };
    expect(decideBackgroundFix(state(NOW), moved, NOW + 1_000)).toBe('send');
  });
});
