/**
 * Spotify candidates for the Artists screen: ranking, the search call and the lookup by id.
 * Spotify is a fetch mock, so no network and no database.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

let spotify: any;
let originalFetch: any;
let importCounter = 0;

const id = (n: number) => String(n).padStart(22, 'A');
const artist = (n: number, name: string, followers: number | null, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  name,
  followers: followers === null ? undefined : { total: followers },
  images: [{ url: `https://i.scdn.co/image/${n}` }],
  genres: ['house', 'techno', 'trance', 'edm', 'dance', 'extra'],
  ...extra,
});

function mockFetch(responses: any[]) {
  let index = 0;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return responses[index++] ?? { ok: false, status: 500, text: async () => 'error', json: async () => ({}) };
  }) as any;
  return calls;
}
const token = { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
const search = (items: any[]) => ({ ok: true, status: 200, json: async () => ({ artists: { items } }) });

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  spotify = await import(`../lib/spotify.js?candidates=${++importCounter}`);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('rankCandidates', () => {
  test('exact names come first, then by followers, and at most 3 are kept', () => {
    const data = {
      artists: {
        items: [
          artist(1, 'Hol Superstar', 9_000_000),
          artist(2, 'HOL', 500),
          artist(3, 'Holy', 8_000_000),
          artist(4, 'hol!', 20_000),
          artist(5, 'Hollow', 7_000_000),
        ],
      },
    };
    const ranked = spotify.rankCandidates(data, 'HOL');
    assert.deepEqual(
      ranked.map((c: any) => [c.name, c.exact]),
      [
        ['hol!', true],
        ['HOL', true],
        ['Hol Superstar', false],
      ],
    );
  });

  test('a candidate carries the link, photo, followers and the top 5 genres', () => {
    const [first] = spotify.rankCandidates({ artists: { items: [artist(7, 'Avello', 1234)] } }, 'Avello');
    assert.equal(first.spotifyId, id(7));
    assert.equal(first.spotifyUrl, `https://open.spotify.com/artist/${id(7)}`);
    assert.equal(first.imageUrl, 'https://i.scdn.co/image/7');
    assert.equal(first.followers, 1234);
    assert.deepEqual(first.genres, ['house', 'techno', 'trance', 'edm', 'dance']);
  });

  test('equal followers keep the order Spotify returned', () => {
    const data = { artists: { items: [artist(1, 'Zed', 10), artist(2, 'Zed', 10)] } };
    assert.deepEqual(spotify.rankCandidates(data, 'Zed').map((c: any) => c.spotifyId), [id(1), id(2)]);
  });

  test('an item without a valid 22-character id is dropped', () => {
    const data = { artists: { items: [{ id: 'short', name: 'Bad' }, { name: 'No id' }, artist(3, 'Good', 1)] } };
    assert.deepEqual(spotify.rankCandidates(data, 'Good').map((c: any) => c.name), ['Good']);
  });

  test('an empty answer gives no candidates', () => {
    assert.deepEqual(spotify.rankCandidates({}, 'X'), []);
    assert.deepEqual(spotify.rankCandidates({ artists: { items: [] } }, 'X'), []);
  });
});

describe('searchCandidates and bulkSearchCandidates', () => {
  test('cleans booking noise from the name and returns ranked candidates', async () => {
    const calls = mockFetch([token, search([artist(1, 'Drama', 100), artist(2, 'Drama Club', 900)])]);
    const found = await spotify.searchCandidates('Drama (DJ Set)', 'cid', 'secret');
    assert.deepEqual(found.map((c: any) => c.name), ['Drama', 'Drama Club']);
    assert.match(calls[1]!, /q=Drama&type=artist/);
  });

  test('no match is [] and a refusal from Spotify is null', async () => {
    mockFetch([token, search([])]);
    assert.deepEqual(await spotify.searchCandidates('Nobody', 'cid', 'secret'), []);
    spotify = await import(`../lib/spotify.js?candidates=${++importCounter}`);
    mockFetch([token, { ok: false, status: 500, json: async () => ({}) }]);
    assert.equal(await spotify.searchCandidates('Busy', 'cid', 'secret'), null);
  });

  test('the first 429 stops the pool and bulkSearchCandidates throws SPOTIFY_RATE_LIMITED', async () => {
    const calls = mockFetch([token, { ok: false, status: 429, json: async () => ({}) }]);
    await assert.rejects(
      spotify.bulkSearchCandidates(['A', 'B', 'C', 'D', 'E'], 'cid', 'secret', { concurrency: 1 }),
      (error: any) => error.code === 'SPOTIFY_RATE_LIMITED' && error instanceof spotify.SpotifyRateLimitedError,
    );
    assert.equal(calls.length, 2, 'one token call and one search, no more after the 429');
  });

  test('without credentials it does not call Spotify', async () => {
    const calls = mockFetch([]);
    assert.equal(await spotify.searchCandidates('X', '', ''), null);
    assert.equal(calls.length, 0);
  });

  test('the bulk map holds [] for no match and leaves out a name that Spotify refused', async () => {
    mockFetch([
      token,
      search([artist(1, 'Alpha', 5)]),
      { ok: false, status: 500, json: async () => ({}) },
      search([]),
    ]);
    const found = await spotify.bulkSearchCandidates(['Alpha', 'Beta', 'Gamma'], 'cid', 'secret', { concurrency: 1 });
    assert.deepEqual(found.get('Alpha').map((c: any) => c.name), ['Alpha']);
    assert.equal(found.has('Beta'), false);
    assert.deepEqual(found.get('Gamma'), []);
  });
});

describe('getArtistsByIds', () => {
  test('returns the photo and genres of an artist, and leaves out an id Spotify does not know', async () => {
    mockFetch([
      token,
      { ok: true, status: 200, json: async () => artist(1, 'Known', 42) },
      { ok: false, status: 404, json: async () => ({}) },
    ]);
    const found = await spotify.getArtistsByIds([id(1), id(2)], 'cid', 'secret', { concurrency: 1 });
    assert.equal(found.get(id(1)).imageUrl, 'https://i.scdn.co/image/1');
    assert.equal(found.has(id(2)), false);
  });

  test('an answer for a different id is not trusted', async () => {
    mockFetch([token, { ok: true, status: 200, json: async () => artist(9, 'Other', 1) }]);
    const found = await spotify.getArtistsByIds([id(1)], 'cid', 'secret', { concurrency: 1 });
    assert.equal(found.size, 0);
  });
});
