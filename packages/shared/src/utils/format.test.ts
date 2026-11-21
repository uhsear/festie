import { describe, it, expect } from 'vitest';
import { makeFestivalSet } from '../test-fixtures/festivalSet';
import {
  formatFestivalDate,
  formatDateSpan,
  formatClock,
  formatTime,
  formatTimeOrRaw,
  uses24HourClock,
  timeToMinutes,
  minutesToTime,
  artistDisplayName,
  artistSubtitle,
  getSetLinks,
  platformLabel,
  artistLinkEntries,
  isSafeExternalUrl,
  formatFestivalDateRange,
} from './format';
import type { FestivalSet } from '../types/domain';

function makeSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return makeFestivalSet(overrides);
}

describe('formatFestivalDateRange', () => {
  it('formats a multi-day range with a single trailing year', () => {
    expect(formatFestivalDateRange('2026-09-04', '2026-09-06')).toBe('Sep 4 – Sep 6, 2026');
  });

  it('collapses a one-day festival to a single date', () => {
    expect(formatFestivalDateRange('2026-09-04', '2026-09-04')).toBe('Sep 4, 2026');
  });

  it('keeps both years across New Year', () => {
    expect(formatFestivalDateRange('2026-12-30', '2027-01-02')).toBe('Dec 30, 2026 – Jan 2, 2027');
  });

  it('accepts ISO datetime strings (uses the date portion)', () => {
    expect(formatFestivalDateRange('2026-09-04T12:00:00Z', '2026-09-06T00:00:00Z')).toBe('Sep 4 – Sep 6, 2026');
  });

  it('returns null when either date is missing', () => {
    expect(formatFestivalDateRange(undefined, '2026-09-06')).toBeNull();
    expect(formatFestivalDateRange('2026-09-04', null)).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(formatFestivalDateRange('not-a-date', 'also-bad')).toBeNull();
  });

  it('renders the calendar day in the local frame (no UTC off-by-one)', () => {
    // A bare YYYY-MM-DD parsed as UTC midnight would shift to the previous day
    // for any user west of UTC. createDateInLocalFrame anchors it locally, so the
    // day in the label must always match the input day regardless of TZ offset.
    const result = formatFestivalDateRange('2026-09-04', '2026-09-06');
    expect(result).toBe('Sep 4 – Sep 6, 2026');
    expect(result).toContain('Sep 4');
  });
});

describe('formatTime', () => {
  it('returns empty string for undefined', () => {
    expect(formatTime(undefined)).toBe('');
  });

  it('converts 24h morning time to 12h AM', () => {
    expect(formatTime('09:30')).toBe('9:30 AM');
  });

  it('converts noon to 12 PM', () => {
    expect(formatTime('12:00')).toBe('12:00 PM');
  });

  it('converts afternoon time to 12h PM', () => {
    expect(formatTime('14:30')).toBe('2:30 PM');
  });

  it('converts midnight to 12 AM', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
  });

  it('converts 23:59 to 11:59 PM', () => {
    expect(formatTime('23:59')).toBe('11:59 PM');
  });
});

describe('formatTime follows the locale hour cycle', () => {
  it.each([
    ['en-US', '21:30', '9:30 PM'],
    ['en-US', '00:05', '12:05 AM'],
    ['en-US', '12:00', '12:00 PM'],
    ['en-GB', '21:30', '21:30'],
    ['en-GB', '09:05', '09:05'],
    ['de-DE', '21:30', '21:30'],
    ['de-DE', '00:05', '00:05'],
  ])('%s shows %s as %s', (locale, hhmm, expected) => {
    expect(formatTime(hhmm, locale)).toBe(expected);
  });

  it('reads the runtime locale when none is given', () => {
    const runtime = new Intl.DateTimeFormat().resolvedOptions().locale;
    expect(formatTime('21:30')).toBe(formatTime('21:30', runtime));
  });

  it('never uses a no-break space and returns non-time input unchanged', () => {
    expect(formatTime('21:30', 'en-US')).not.toMatch(/[  ]/);
    expect(formatTime('soon', 'en-US')).toBe('soon');
    expect(formatTimeOrRaw('21:30', 'de-DE')).toBe('21:30');
    expect(formatTimeOrRaw('after sunset', 'de-DE')).toBe('after sunset');
  });

  it('does not move with the host time zone', () => {
    // formatTime builds a UTC date, so no zone can shift a wall-clock time. Run the check in two zones.
    const original = process.env.TZ;
    try {
      const seen = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].map((tz) => {
        process.env.TZ = tz;
        return [formatTime('23:30', 'en-US'), formatTime('23:30', 'de-DE')];
      });
      expect(seen[0]).toEqual(['11:30 PM', '23:30']);
      expect(seen[1]).toEqual(seen[0]);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe('formatClock', () => {
  // 2026-07-11 01:30 UTC is 6:30 PM on Jul 10 in Los Angeles and 10:30 AM in Tokyo.
  const instant = Date.UTC(2026, 6, 11, 1, 30);

  it('shows the festival zone clock, not the host clock', () => {
    expect(formatClock(instant, 'America/Los_Angeles', 'en-US')).toBe('6:30 PM');
    expect(formatClock(instant, 'America/Los_Angeles', 'en-GB')).toBe('18:30');
    expect(formatClock(instant, 'Asia/Tokyo', 'en-US')).toBe('10:30 AM');
    expect(formatClock(instant, 'Asia/Tokyo', 'de-DE')).toBe('10:30');
  });
});

describe('uses24HourClock', () => {
  it('tells 12-hour locales from 24-hour ones', () => {
    expect(uses24HourClock('en-US')).toBe(false);
    expect(uses24HourClock('en-GB')).toBe(true);
    expect(uses24HourClock('de-DE')).toBe(true);
  });
});

describe('formatTimeOrRaw', () => {
  it('formats HH:MM values', () => {
    expect(formatTimeOrRaw('14:30')).toBe('2:30 PM');
  });

  it('passes free text through unchanged', () => {
    expect(formatTimeOrRaw('after sunset')).toBe('after sunset');
    expect(formatTimeOrRaw('9:30')).toBe('9:30');
  });
});

describe('timeToMinutes', () => {
  it('returns 0 for undefined', () => {
    expect(timeToMinutes(undefined)).toBe(0);
  });

  it('converts midnight to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('converts 14:30 to 870', () => {
    expect(timeToMinutes('14:30')).toBe(870);
  });

  it('converts 23:59 to 1439', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('converts 01:00 to 60', () => {
    expect(timeToMinutes('01:00')).toBe(60);
  });
});

describe('minutesToTime', () => {
  it('converts 0 to 00:00', () => {
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('converts 870 to 14:30', () => {
    expect(minutesToTime(870)).toBe('14:30');
  });

  it('converts 60 to 01:00', () => {
    expect(minutesToTime(60)).toBe('01:00');
  });

  it('converts 1439 to 23:59', () => {
    expect(minutesToTime(1439)).toBe('23:59');
  });
});

describe('artistDisplayName', () => {
  it('prefers the billed display name over the joined artists', () => {
    const set = makeSet({ displayName: 'Skull Machine', artists: [{ name: 'A' }, { name: 'B' }] as never });
    expect(artistDisplayName(set, 'B2B')).toBe('Skull Machine');
    expect(artistSubtitle(set, 'B2B')).toBe('A B2B B');
  });

  it('returns artist field when no artists array', () => {
    const set = makeSet({ artist: 'Daft Punk' });
    expect(artistDisplayName(set)).toBe('Daft Punk');
  });

  it('returns Unknown when no artist and no artists', () => {
    const set = makeSet({});
    expect(artistDisplayName(set)).toBe('Unknown');
  });

  it('returns joined artists when artist matches joined', () => {
    const set = makeSet({
      artist: 'A b2b B',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistDisplayName(set)).toBe('A b2b B');
  });

  it('returns artist field when it differs from joined artists', () => {
    const set = makeSet({
      artist: 'Custom Name',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistDisplayName(set)).toBe('Custom Name');
  });

  it('uses custom separator', () => {
    const set = makeSet({
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistDisplayName(set, 'vs')).toBe('A vs B');
  });

  it('returns joined artists when artist field is empty', () => {
    const set = makeSet({
      artist: '',
      artists: [{ name: 'Solo' }],
    });
    expect(artistDisplayName(set)).toBe('Solo');
  });
});

describe('artistSubtitle', () => {
  it('returns empty string for single artist', () => {
    const set = makeSet({ artists: [{ name: 'Solo' }] });
    expect(artistSubtitle(set)).toBe('');
  });

  it('returns empty string when no artists', () => {
    const set = makeSet({});
    expect(artistSubtitle(set)).toBe('');
  });

  it('returns joined artists when artist field differs', () => {
    const set = makeSet({
      artist: 'Custom',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistSubtitle(set)).toBe('A b2b B');
  });

  it('returns empty string when artist matches joined', () => {
    const set = makeSet({
      artist: 'A b2b B',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistSubtitle(set)).toBe('');
  });

  it('uses custom separator', () => {
    const set = makeSet({
      artist: 'Custom',
      artists: [{ name: 'A' }, { name: 'B' }],
    });
    expect(artistSubtitle(set, 'vs')).toBe('A vs B');
  });
});

describe('platformLabel', () => {
  it('maps known link keys to display names and passes unknown keys through', () => {
    expect(platformLabel('soundcloud')).toBe('SoundCloud');
    expect(platformLabel('apple_music')).toBe('Apple Music');
    expect(platformLabel('youtube')).toBe('YouTube');
    expect(platformLabel('website')).toBe('Website');
    expect(platformLabel('twitter')).toBe('X');
    expect(platformLabel('bandcamp')).toBe('bandcamp');
  });
});

describe('getSetLinks', () => {
  it('returns empty array when no artists and no linkUrl', () => {
    const set = makeSet({});
    expect(getSetLinks(set)).toEqual([]);
  });

  it('returns linkUrl as spotify link when no artists but linkUrl present', () => {
    const set = makeSet({
      artist: 'Solo',
      linkUrl: 'https://spotify.com/track/123',
    });
    expect(getSetLinks(set)).toEqual([{ name: 'Solo', links: { spotify: 'https://spotify.com/track/123' } }]);
  });

  it('returns artists with links, filtering out those without', () => {
    const set = makeSet({
      artists: [
        { name: 'A', links: { spotify: 'https://sp/a' } },
        { name: 'B' },
        { name: 'C', links: { soundcloud: 'https://sc/c' } },
      ],
    });
    const result = getSetLinks(set);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'A', links: { spotify: 'https://sp/a' } });
    expect(result[1]).toEqual({ name: 'C', links: { soundcloud: 'https://sc/c' } });
  });

  it('returns empty array for artists with empty link objects', () => {
    const set = makeSet({
      artists: [{ name: 'A', links: {} }],
    });
    expect(getSetLinks(set)).toEqual([]);
  });
});

describe('formatFestivalDate', () => {
  it('formats a YYYY-MM-DD date without a timezone shift', () => {
    expect(formatFestivalDate('2025-06-21')).toBe('Jun 21, 2025');
  });
  it('reads the calendar parts off a full ISO timestamp', () => {
    expect(formatFestivalDate('2025-12-01T23:30:00.000Z')).toBe('Dec 1, 2025');
  });
  it('returns null for empty input and echoes an unparseable string', () => {
    expect(formatFestivalDate(null)).toBeNull();
    expect(formatFestivalDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateSpan', () => {
  it('collapses a single-day festival to one date', () => {
    expect(formatDateSpan('2025-06-21', '2025-06-21')).toBe('Jun 21, 2025');
  });
  it('drops the repeated year inside a same-year span', () => {
    expect(formatDateSpan('2025-06-21', '2025-06-23')).toBe('Jun 21 – Jun 23, 2025');
  });
  it('keeps both years when they differ', () => {
    expect(formatDateSpan('2024-12-31', '2025-01-01')).toBe('Dec 31, 2024 – Jan 1, 2025');
  });
  it('returns null when both ends are missing', () => {
    expect(formatDateSpan(null, null)).toBeNull();
  });
});

describe('isSafeExternalUrl', () => {
  it('allows only http and https', () => {
    expect(isSafeExternalUrl('https://open.spotify.com/artist/1')).toBe(true);
    expect(isSafeExternalUrl('HTTP://example.com')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,hi')).toBe(false);
    expect(isSafeExternalUrl('intent://x#Intent;end')).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
  });
});

describe('artistLinkEntries', () => {
  it('orders music services before socials, puts unknown keys last, and drops non-http(s) urls', () => {
    const out = artistLinkEntries({
      instagram: 'https://instagram.com/a',
      zzz: 'https://z.example',
      spotify: 'https://open.spotify.com/a',
      website: 'javascript:alert(1)',
      twitter: 'https://x.com/a',
    });
    expect(out.map((l) => l.key)).toEqual(['spotify', 'instagram', 'twitter', 'zzz']);
    expect(out[2]!.label).toBe('X');
  });

  it('returns an empty list for no links', () => {
    expect(artistLinkEntries(undefined)).toEqual([]);
  });
});
