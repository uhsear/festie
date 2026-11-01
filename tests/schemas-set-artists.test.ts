/**
 * resolveSetArtists (lib/schemas.ts): a festival update keeps the per-artist
 * links, photos and genres the client never sent, and a typed rename wins.
 * Pure function, no DB.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveSetArtists, sanitizeFestivalPayload } from '../lib/schemas.js';

const SPOTIFY_A = 'https://open.spotify.com/artist/a';
const SPOTIFY_B = 'https://open.spotify.com/artist/b';
const SC_A = 'https://soundcloud.com/a';

const storedB2B = {
  id: 'set-1',
  artist: 'Alpha b2b Beta',
  artists: [
    { name: 'Alpha', links: { spotify: SPOTIFY_A, soundcloud: SC_A }, photo: 'https://i.scdn.co/a.jpg', genres: ['house'] },
    { name: 'Beta', links: { spotify: SPOTIFY_B }, photo: 'https://i.scdn.co/b.jpg', genres: ['techno', 'trance'] },
  ],
};

describe('resolveSetArtists', () => {
  it('keeps the stored artists when artists[] is absent and the typed name is unchanged', () => {
    const result = resolveSetArtists({ id: 'set-1', artist: 'Alpha b2b Beta' }, storedB2B, 'b2b');
    assert.deepEqual(result, storedB2B.artists);
  });

  it('applies an edited or cleared linkUrl to the first stored artist (mobile)', () => {
    const NEW = 'https://open.spotify.com/artist/new';
    const edited = resolveSetArtists({ id: 'set-1', artist: 'Alpha b2b Beta', linkUrl: NEW }, storedB2B, 'b2b');
    assert.equal(edited[0].links.spotify, NEW);
    assert.equal(edited[0].links.soundcloud, SC_A);
    assert.deepEqual(edited[1], storedB2B.artists[1]);

    const cleared = resolveSetArtists({ id: 'set-1', artist: 'Alpha b2b Beta', linkUrl: null }, storedB2B, 'b2b');
    assert.equal(cleared[0].links.spotify, undefined);
    assert.equal(cleared[0].links.soundcloud, SC_A);

    const same = resolveSetArtists({ id: 'set-1', artist: 'Alpha b2b Beta', linkUrl: SPOTIFY_A }, storedB2B, 'b2b');
    assert.deepEqual(same, storedB2B.artists);
  });

  it('uses artists[] and keeps photo and genres from the stored artist', () => {
    const result = resolveSetArtists(
      {
        id: 'set-1',
        artist: 'Alpha b2b Beta',
        artists: [
          { name: 'Alpha', links: { spotify: SPOTIFY_A, soundcloud: SC_A } },
          { name: 'Beta', links: { spotify: SPOTIFY_B } },
        ],
      },
      storedB2B,
      'b2b',
    );
    assert.deepEqual(result, storedB2B.artists);
  });

  it('keeps a link removed from artists[] removed', () => {
    const result = resolveSetArtists(
      {
        id: 'set-1',
        artist: 'Alpha b2b Beta',
        artists: [{ name: 'Alpha', links: { spotify: SPOTIFY_A } }, { name: 'Beta', links: {} }],
      },
      storedB2B,
      'b2b',
    );
    assert.deepEqual(result[0].links, { spotify: SPOTIFY_A });
    assert.deepEqual(result[1].links, {});
    assert.equal(result[1].photo, 'https://i.scdn.co/b.jpg');
  });

  it('lets a typed rename win over a stale artists[] (admin-v1)', () => {
    const result = resolveSetArtists(
      { id: 'set-2', artist: 'New', artists: [{ name: 'Old', links: { spotify: SPOTIFY_A } }] },
      { id: 'set-2', artist: 'Old', artists: [{ name: 'Old', links: { spotify: SPOTIFY_A }, photo: 'https://x/o.jpg' }] },
      'b2b',
    );
    assert.deepEqual(result, [{ name: 'New', links: {} }]);
  });

  it('splits a typed B2B rename and copies links by name, payload first then stored', () => {
    const result = resolveSetArtists(
      {
        id: 'set-1',
        artist: 'alpha B2B Beta B2B Gamma',
        artists: [{ name: 'Alpha', links: { spotify: 'https://open.spotify.com/artist/a2' } }],
      },
      storedB2B,
      'b2b',
    );
    assert.deepEqual(
      result.map((a) => a.name),
      ['alpha', 'Beta', 'Gamma'],
    );
    assert.deepEqual(result[0].links, { spotify: 'https://open.spotify.com/artist/a2' });
    assert.deepEqual(result[1].links, { spotify: SPOTIFY_B });
    assert.deepEqual(result[2].links, {});
    assert.equal(result[0].photo, 'https://i.scdn.co/a.jpg');
    assert.deepEqual(result[1].genres, ['techno', 'trance']);
  });

  it('builds from the typed name when the set is new and gives the first artist linkUrl as spotify', () => {
    const result = resolveSetArtists({ artist: 'Solo x Duo', linkUrl: SPOTIFY_A }, undefined, 'x');
    assert.deepEqual(result, [
      { name: 'Solo', links: { spotify: SPOTIFY_A } },
      { name: 'Duo', links: {} },
    ]);
  });

  it('escapes a separator with regex characters', () => {
    const result = resolveSetArtists({ artist: 'A + B' }, undefined, '+');
    assert.deepEqual(
      result.map((a) => a.name),
      ['A', 'B'],
    );
  });

  it('drops a stored photo that is not https or too long, and cleans genres', () => {
    const stored = {
      id: 's',
      artist: 'Alpha',
      artists: [
        {
          name: 'Alpha',
          links: {},
          photo: 'http://insecure/a.jpg',
          genres: ['  house  ', 7, '', ...Array.from({ length: 12 }, (_, i) => `g${i}`)],
        },
      ],
    };
    const [artist] = resolveSetArtists({ id: 's', artist: 'Alpha' }, stored, 'b2b');
    assert.equal(artist.photo, undefined);
    assert.equal(artist.genres.length, 10);
    assert.equal(artist.genres[0], 'house');

    const longPhoto = { ...stored, artists: [{ name: 'Alpha', photo: `https://x/${'a'.repeat(500)}` }] };
    assert.equal(resolveSetArtists({ id: 's', artist: 'Alpha' }, longPhoto, 'b2b')[0].photo, undefined);
  });
});

describe('sanitizeFestivalPayload with a stored festival', () => {
  const config = { MAX_STAGES: 20, MAX_DAYS: 10, MAX_SETS_PER_DAY: 200 };
  const createOpaqueId = (prefix: string) => `${prefix}-new`;
  const existing = {
    id: 'fest-1',
    name: 'Fest',
    b2bSeparator: 'b2b',
    stages: [{ id: 'main', name: 'Main', color: '#123456' }],
    days: [{ label: 'Fri', date: '2026-06-01', sets: [{ ...storedB2B, stageId: 'main', startTime: '20:00', endTime: '21:00' }] }],
  };

  it('keeps both artists and their links for a mobile-style save', () => {
    const result = sanitizeFestivalPayload(
      {
        name: 'Fest',
        days: [{ label: 'Fri', date: '2026-06-01', sets: [{ id: 'set-1', artist: 'Alpha b2b Beta', stageId: 'main', startTime: '20:00', endTime: '21:00' }] }],
      },
      existing,
      config,
      createOpaqueId,
    );
    const set = result.days[0].sets[0];
    assert.deepEqual(set.artists, storedB2B.artists);
    assert.equal(set.artist, 'Alpha b2b Beta');
    assert.equal(set.linkUrl, SPOTIFY_A);
  });

  it('still uses normalizeSetArtists on create (no stored festival)', () => {
    const result = sanitizeFestivalPayload(
      { name: 'Fest', days: [{ sets: [{ id: 'n', artist: 'A b2b B' }] }] },
      null,
      config,
      createOpaqueId,
    );
    assert.deepEqual(result.days[0].sets[0].artists, [{ name: 'A b2b B', links: {} }]);
  });
});
