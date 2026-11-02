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
  primarySpotifyArtist,
  safeReturnPath,
} from './links';
import type { FestivalSet } from '../types/domain';

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

describe('links — primarySpotifyArtist', () => {
  const set = (artists: Array<{ name: string; links?: Record<string, string> }>) =>
    ({ id: 's', festivalId: 'f', stageId: 'st', startTime: '', endTime: '', createdAt: '', updatedAt: '', artists }) as FestivalSet;
  it('skips a Spotify link that is not an artist URL', () => {
    const s = set([
      { name: 'A', links: { spotify: 'https://open.spotify.com/user/abc' } },
      { name: 'B', links: { spotify: 'https://open.spotify.com/artist/xyz789' } },
    ]);
    expect(primarySpotifyArtist(s)).toEqual({ name: 'B', url: 'https://open.spotify.com/artist/xyz789' });
  });
  it('returns null when no artist qualifies', () => {
    expect(primarySpotifyArtist(set([{ name: 'A' }, { name: 'B', links: { instagram: 'x' } }]))).toBeNull();
    expect(primarySpotifyArtist({ ...set([]), artists: undefined })).toBeNull();
  });
});

describe('links — safeReturnPath', () => {
  it.each(['/set/abc', '/picks?day=2', '/(tabs)/picks'])('accepts the in-app path %s', (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '',
    42,
    undefined,
    '/login',
    '/register?next=/x',
    '/forgot-password',
    '/(auth)/login',
    '/set/a\nb',
    `/${'a'.repeat(512)}`,
  ])('rejects %j', (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it('accepts a path of exactly 512 characters', () => {
    const path = `/${'a'.repeat(511)}`;
    expect(safeReturnPath(path)).toBe(path);
  });
});
