import { describe, it, expect } from 'vitest';
import {
  festivalStatus,
  festivalPhase,
  groupFestivalsByStatus,
  festivalTimeLabel,
  isFestivalOver,
  hasSetStarted,
  isValidTimeZone,
  listTimeZones,
  pickDefaultFestival,
  resolveFestivalTimeZone,
  sortFestivalsForPicker,
  timeZoneCity,
} from './festivalTime';
import type { Festival } from '../types/domain';

function fest(overrides: Partial<Festival> = {}): Festival {
  return {
    id: 'f1',
    name: 'Test Fest',
    startDate: '2026-09-04',
    endDate: '2026-09-06',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('isValidTimeZone', () => {
  it('accepts a valid IANA zone', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects empty/garbage zones', () => {
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});

describe('resolveFestivalTimeZone', () => {
  it('returns the festival zone when present and valid', () => {
    expect(resolveFestivalTimeZone(fest({ timeZone: 'America/New_York' }))).toBe('America/New_York');
  });

  it('returns undefined when absent or invalid (device-local fallback)', () => {
    expect(resolveFestivalTimeZone(fest())).toBeUndefined();
    expect(resolveFestivalTimeZone(fest({ timeZone: 'bogus' }))).toBeUndefined();
    expect(resolveFestivalTimeZone(null)).toBeUndefined();
  });
});

describe('festivalStatus', () => {
  it("returns 'past' from 06:00 after the final day", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-09-07T06:00:00'))).toBe('past');
  });

  it("stays 'ongoing' through the last night (before 06:00 after the final day)", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-09-07T05:59:00'))).toBe('ongoing');
  });

  it("returns 'upcoming' before the first day", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-08-01T00:00:00'))).toBe('upcoming');
  });

  it("returns 'ongoing' during the festival", () => {
    expect(festivalStatus(fest(), undefined, new Date('2026-09-05T12:00:00'))).toBe('ongoing');
  });

  it('prefers inline days[] over start/end dates', () => {
    const f = fest({ startDate: '', endDate: '' });
    const days = [{ date: '2026-09-04' }, { date: '2026-09-06' }];
    expect(festivalStatus(f, days, new Date('2026-09-07T06:00:00'))).toBe('past');
    expect(festivalStatus(f, days, new Date('2026-08-01T00:00:00'))).toBe('upcoming');
  });

  it('returns null when no dates are available', () => {
    expect(festivalStatus(fest({ startDate: '', endDate: '' }), undefined, new Date())).toBeNull();
    expect(festivalStatus(null)).toBeNull();
  });

  // Regression: with no festival zone, bounds must be anchored to the device's
  // LOCAL wall clock, not a UTC-parsed instant. The injected `now` is built from
  // local calendar fields, so the comparison must agree with local midnight and
  // 06:00 regardless of the machine's UTC offset (CI runs UTC; users do not).
  it('anchors bounds to the local wall clock (non-UTC safe)', () => {
    // `now` constructed via local fields — 06:00 after the last day.
    const justPast = new Date();
    justPast.setFullYear(2026, 8, 7); // 2026-09-07 (month is 0-based)
    justPast.setHours(6, 0, 0, 0);
    expect(festivalStatus(fest(), undefined, justPast)).toBe('past');

    // The prior local day, 23:59 — still before the first day's 00:00.
    const justBefore = new Date();
    justBefore.setFullYear(2026, 8, 3); // 2026-09-03
    justBefore.setHours(23, 59, 0, 0);
    expect(festivalStatus(fest(), undefined, justBefore)).toBe('upcoming');

    // Squarely inside the window, late local night (where a UTC vs local parse
    // of 23:59 would diverge for negative-offset zones).
    const lateNight = new Date();
    lateNight.setFullYear(2026, 8, 6); // 2026-09-06
    lateNight.setHours(23, 30, 0, 0);
    expect(festivalStatus(fest(), undefined, lateNight)).toBe('ongoing');
  });

  it('ends at 06:00 after the last day in the festival zone, not the device zone', () => {
    const la = fest({ timeZone: 'America/Los_Angeles' });
    // 2026-09-07 is PDT (UTC-7): 01:30 local = 08:30Z, 06:01 local = 13:01Z.
    expect(festivalStatus(la, undefined, new Date(Date.UTC(2026, 8, 7, 8, 30)))).toBe('ongoing');
    expect(festivalStatus(la, undefined, new Date(Date.UTC(2026, 8, 7, 13, 1)))).toBe('past');
  });
});

describe('festivalPhase', () => {
  it("maps upcoming → 'pre'", () => {
    expect(festivalPhase(fest(), undefined, new Date('2026-08-01T00:00:00'))).toBe('pre');
  });

  it("maps ongoing → 'live'", () => {
    expect(festivalPhase(fest(), undefined, new Date('2026-09-05T12:00:00'))).toBe('live');
  });

  it("maps past → 'post'", () => {
    expect(festivalPhase(fest(), undefined, new Date('2026-09-07T06:00:00'))).toBe('post');
  });

  it('prefers inline days[] over start/end dates', () => {
    const f = fest({ startDate: '', endDate: '' });
    const days = [{ date: '2026-09-04' }, { date: '2026-09-06' }];
    expect(festivalPhase(f, days, new Date('2026-09-05T12:00:00'))).toBe('live');
  });

  it('returns null when no dates are available', () => {
    expect(festivalPhase(fest({ startDate: '', endDate: '' }), undefined, new Date())).toBeNull();
    expect(festivalPhase(null)).toBeNull();
  });
});

describe('isFestivalOver / hasSetStarted (local-frame)', () => {
  const days = [{ date: '2026-09-04' }, { date: '2026-09-05' }, { date: '2026-09-06' }];

  it('isFestivalOver flips at 06:00 after the last day', () => {
    // A long-past festival is over; a far-future one is not — independent of TZ
    // because both bounds and `new Date()` share the same local frame.
    // (isFestivalOver reads the days array, not startDate/endDate.)
    expect(isFestivalOver(fest(), [{ date: '2000-01-01' }, { date: '2000-01-02' }])).toBe(true);
    expect(isFestivalOver(fest(), [{ date: '2099-01-01' }, { date: '2099-01-02' }])).toBe(false);
  });

  it('isFestivalOver returns false for missing/invalid dates', () => {
    expect(isFestivalOver(undefined)).toBe(false);
    expect(isFestivalOver(fest(), [])).toBe(false);
    expect(isFestivalOver(fest(), [{ date: null }])).toBe(false);
  });

  it('hasSetStarted is false for a future-dated set, true for a past one', () => {
    const futureFest = fest({ startDate: '2099-09-04', endDate: '2099-09-06' });
    const futureDays = [{ date: '2099-09-04' }, { date: '2099-09-05' }, { date: '2099-09-06' }];
    expect(hasSetStarted({ startTime: '20:00', dayIndex: 1 }, futureFest, futureDays)).toBe(false);

    const pastFest = fest({ startDate: '2000-09-04', endDate: '2000-09-06' });
    const pastDays = [{ date: '2000-09-04' }, { date: '2000-09-05' }, { date: '2000-09-06' }];
    expect(hasSetStarted({ startTime: '20:00', dayIndex: 1 }, pastFest, pastDays)).toBe(true);
  });

  it('hasSetStarted falls back to isFestivalOver when the set has no time', () => {
    expect(hasSetStarted({ startTime: null, dayIndex: 0 }, fest(), days)).toBe(isFestivalOver(fest(), days));
  });

  it('isFestivalOver is false through the last night and true after 06:00, in the festival zone', () => {
    const la = fest({ timeZone: 'America/Los_Angeles' });
    expect(isFestivalOver(la, days, new Date(Date.UTC(2026, 8, 7, 8, 0)))).toBe(false); // 01:00 PDT
    expect(isFestivalOver(la, days, new Date(Date.UTC(2026, 8, 7, 13, 1)))).toBe(true); // 06:01 PDT
  });

  it('hasSetStarted puts a 01:00 set on the night of its day, in the festival zone', () => {
    const la = fest({ timeZone: 'America/Los_Angeles' });
    const set = { startTime: '01:00', dayIndex: 0 };
    // Day 0 is 2026-09-04, so the set starts 2026-09-05 01:00 PDT (08:00Z).
    expect(hasSetStarted(set, la, days, new Date(Date.UTC(2026, 8, 5, 6, 0)))).toBe(false); // day 0 23:00 PDT
    expect(hasSetStarted(set, la, days, new Date(Date.UTC(2026, 8, 5, 8, 5)))).toBe(true); // 09-05 01:05 PDT
  });
});

describe('festivalTimeLabel', () => {
  const ms = Date.UTC(2026, 8, 5, 12, 0);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // An Etc/GMT zone 9 hours from the host (Etc/GMT signs are inverted), so the case holds under any TZ.
  const hostHours = Math.round(-new Date(ms).getTimezoneOffset() / 60);
  const awayHours = hostHours + 9 > 14 ? hostHours + 9 - 24 : hostHours + 9;
  const awayZone = `Etc/GMT${awayHours > 0 ? '-' : '+'}${Math.abs(awayHours)}`;

  it('is null when the festival zone has the device offset', () => {
    expect(festivalTimeLabel(deviceZone, ms)).toBeNull();
    if (new Date(ms).getTimezoneOffset() === 0) expect(festivalTimeLabel('UTC', ms)).toBeNull();
  });

  it("is 'Festival time' when the offsets differ", () => {
    expect(isValidTimeZone(awayZone)).toBe(true);
    expect(festivalTimeLabel(awayZone, ms)).toBe('Festival time');
  });

  it('is null without a valid zone', () => {
    expect(festivalTimeLabel(undefined, ms)).toBeNull();
    expect(festivalTimeLabel('Mars/Base', ms)).toBeNull();
  });
});

describe('timeZoneCity', () => {
  it('returns the city part with spaces', () => {
    expect(timeZoneCity('America/Los_Angeles')).toBe('Los Angeles');
    expect(timeZoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(timeZoneCity('UTC')).toBe('UTC');
  });
});

describe('listTimeZones', () => {
  const intl = Intl as { supportedValuesOf?: unknown };

  it('lists the runtime zones and merges a valid current zone that is missing', () => {
    const zones = listTimeZones('US/Eastern');
    expect(zones).toContain('Asia/Tokyo');
    expect(zones).toContain('US/Eastern');
    expect(listTimeZones('Mars/Base')).not.toContain('Mars/Base');
  });

  it('falls back to a fixed list when Intl.supportedValuesOf is missing', () => {
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = undefined;
    try {
      const zones = listTimeZones('Asia/Kolkata');
      expect(zones.slice(0, 2)).toEqual(['UTC', 'America/New_York']);
      expect(zones).toContain('Europe/Amsterdam');
      expect(zones).toContain('Pacific/Auckland');
      expect(zones[zones.length - 1]).toBe('Asia/Kolkata');
      expect(listTimeZones('Asia/Tokyo').filter((z) => z === 'Asia/Tokyo')).toHaveLength(1);
    } finally {
      intl.supportedValuesOf = original;
    }
  });
});

describe('groupFestivalsByStatus', () => {
  const f = (id: string, startDate: string, endDate: string, name = id) => fest({ id, name, startDate, endDate });
  it('groups and orders by status', () => {
    const g = groupFestivalsByStatus(
      [
        f('p1', '2026-01-01', '2026-01-02'),
        f('p2', '2026-03-01', '2026-03-02'),
        f('u2', '2026-12-10', '2026-12-11'),
        f('u1', '2026-11-20', '2026-11-21'),
        f('live', '2026-10-30', '2026-11-02'),
        f('zz', '', '', 'Zed'),
        f('aa', '', '', 'Abe'),
      ],
      new Date('2026-11-01T12:00:00'),
    );
    expect(g.live.map((x) => x.id)).toEqual(['live']);
    expect(g.upcoming.map((x) => x.id)).toEqual(['u1', 'u2']);
    expect(g.past.map((x) => x.id)).toEqual(['p2', 'p1']);
    expect(g.undated.map((x) => x.id)).toEqual(['aa', 'zz']);
  });
});

describe('sortFestivalsForPicker / pickDefaultFestival', () => {
  const now = new Date(2026, 8, 5, 12, 0); // 2026-09-05 12:00 local
  const live = fest({ id: 'live', startDate: '2026-09-04', endDate: '2026-09-06' });
  const soon = fest({ id: 'soon', startDate: '2026-10-01', endDate: '2026-10-02' });
  const later = fest({ id: 'later', startDate: '2026-11-01', endDate: '2026-11-02' });
  const oldPast = fest({ id: 'old', startDate: '2026-05-01', endDate: '2026-05-02' });
  const recentPast = fest({ id: 'recent', startDate: '2026-08-01', endDate: '2026-08-02' });

  it('orders live, then soonest upcoming, then most recent past', () => {
    const sorted = sortFestivalsForPicker([oldPast, later, recentPast, live, soon], now);
    expect(sorted.map((f) => f.id)).toEqual(['live', 'soon', 'later', 'recent', 'old']);
  });

  it('picks the live festival by default', () => {
    expect(pickDefaultFestival([oldPast, soon, live], now)?.id).toBe('live');
  });

  it('returns undefined for an empty list', () => {
    expect(pickDefaultFestival([], now)).toBeUndefined();
  });

  it('returns the most recent festival when all are past', () => {
    expect(pickDefaultFestival([oldPast, recentPast], now)?.id).toBe('recent');
  });
});
