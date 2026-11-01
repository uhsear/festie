import { describe, it, expect } from 'vitest';
import {
  FESTIE_ORIGIN,
  FESTIE_SCHEME,
  buildJoinUrl,
  buildSetUrl,
  buildPicksShareUrl,
  buildPublicScheduleUrl,
  buildHomeUrl,
  buildAppDeepLink,
  buildPlanQrUrl,
  extractPlanSnapshotText,
  buildCalendarLinks,
} from './links';
import { encodePlanSnapshot, decodePlanSnapshot } from './planSnapshot';

describe('links — buildJoinUrl', () => {
  it('builds the production join link by default', () => {
    expect(buildJoinUrl('ABC123')).toBe('https://festie.us/join/ABC123');
  });

  it('uses a runtime origin override (web dev/preview hosts)', () => {
    expect(buildJoinUrl('ABC123', 'http://localhost:5173')).toBe(
      'http://localhost:5173/join/ABC123',
    );
  });

  it('percent-encodes the invite code', () => {
    expect(buildJoinUrl('a b/c?')).toBe('https://festie.us/join/a%20b%2Fc%3F');
  });

  it('collapses a trailing slash on the origin so there is no double slash', () => {
    expect(buildJoinUrl('X', 'https://festie.us/')).toBe('https://festie.us/join/X');
  });
});

describe('links — buildSetUrl', () => {
  it('builds the production set deep link by default', () => {
    expect(buildSetUrl('set-42')).toBe('https://festie.us/set/set-42');
  });

  it('honours an origin override and encodes the id', () => {
    expect(buildSetUrl('a/b', 'https://staging.festie.us')).toBe(
      'https://staging.festie.us/set/a%2Fb',
    );
  });
});

describe('links — buildPicksShareUrl', () => {
  it('mirrors the GET /s/:profileId server route', () => {
    expect(buildPicksShareUrl('p1')).toBe('https://festie.us/s/p1');
  });

  it('encodes the profile id', () => {
    expect(buildPicksShareUrl('p 1')).toBe('https://festie.us/s/p%201');
  });
});

describe('links — buildHomeUrl', () => {
  it('returns the production origin by default', () => {
    expect(buildHomeUrl()).toBe('https://festie.us');
    expect(buildHomeUrl()).toBe(FESTIE_ORIGIN);
  });

  it('strips a trailing slash from a passed origin', () => {
    expect(buildHomeUrl('http://localhost:5173/')).toBe('http://localhost:5173');
  });
});

describe('links — buildAppDeepLink', () => {
  it('preserves an absolute path (festie:///find)', () => {
    expect(buildAppDeepLink('/find')).toBe('festie:///find');
  });

  it('preserves a scheme-relative path (festie://set/123)', () => {
    expect(buildAppDeepLink('set/123')).toBe('festie://set/123');
  });

  it('uses the exported scheme constant', () => {
    expect(buildAppDeepLink('').startsWith(FESTIE_SCHEME)).toBe(true);
  });
});

describe('links — buildPublicScheduleUrl', () => {
  it('builds the vanity schedule URL and encodes the username', () => {
    expect(buildPublicScheduleUrl('raver_1')).toBe('https://festie.us/s/u/raver_1');
    expect(buildPublicScheduleUrl('a b', 'http://localhost:5173/')).toBe('http://localhost:5173/s/u/a%20b');
  });
});

describe('links - plan QR url', () => {
  it('puts the snapshot in the hash', () => {
    expect(buildPlanQrUrl('abc_-1')).toBe('https://festie.us/p#abc_-1');
    expect(buildPlanQrUrl('x', 'http://localhost:5173/')).toBe('http://localhost:5173/p#x');
  });

  it('extracts the hash text from the URL form', () => {
    expect(extractPlanSnapshotText('https://festie.us/p#abc_-1')).toBe('abc_-1');
    expect(extractPlanSnapshotText('  https://festie.us/p/#abc  ')).toBe('abc');
  });

  it('returns anything else unchanged', () => {
    expect(extractPlanSnapshotText('eyJ2IjoxfQ')).toBe('eyJ2IjoxfQ');
    expect(extractPlanSnapshotText('https://evil.example/x#abc')).toBe('https://evil.example/x#abc');
    expect(extractPlanSnapshotText('https://festie.us/p#abc?x=1')).toBe('https://festie.us/p#abc?x=1');
    expect(extractPlanSnapshotText(42)).toBe(42);
  });

  it('round-trips an encoded snapshot', () => {
    const encoded = encodePlanSnapshot({
      festivalId: 'f1',
      festivalName: 'Fest',
      picks: [{ setId: 's1', priority: 'must' }],
    });
    const decoded = decodePlanSnapshot(extractPlanSnapshotText(buildPlanQrUrl(encoded)));
    expect(decoded.ok).toBe(true);
  });
});

describe('links - buildCalendarLinks', () => {
  it('maps https and http feeds to webcal and Google', () => {
    for (const scheme of ['https', 'http']) {
      const feed = `${scheme}://festie.us/cal/tok.ics`;
      const links = buildCalendarLinks(feed);
      expect(links.httpsUrl).toBe(feed);
      expect(links.webcalUrl).toBe('webcal://festie.us/cal/tok.ics');
      expect(links.googleUrl).toBe(
        `https://calendar.google.com/calendar/render?cid=${encodeURIComponent('webcal://festie.us/cal/tok.ics')}`,
      );
    }
  });
});
