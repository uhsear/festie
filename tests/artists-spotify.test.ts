import 'dotenv/config';
/**
 * "Find Spotify links": the candidates route writes nothing, and the picks route stores only a Spotify
 * artist the editor chose, reads the photo and genres from Spotify, and checks "on other festivals"
 * again under the locks. Spotify is a fetch mock. Needs TEST_DATABASE_URL (a database whose name contains _test).
 */
process.env.SPOTIFY_CLIENT_ID = 'test-client-id';
process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret';

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { lockFestivalAny } from '../lib/db/stores/lineup-imports';
import { TEST_DATABASE_URL } from './_integration-helpers';
import { createArtist, festivalRow, seedFestival, setRow, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';

const id = (n: number) => `Test${String(n).padStart(18, '0')}`;
const spotifyArtist = (n: number, name: string, followers = 100) => ({
  id: id(n),
  name,
  followers: { total: followers },
  images: [{ url: `https://i.scdn.co/image/${n}` }],
  genres: ['house', 'techno'],
});

/** What the fake Spotify knows: search results by query, and artists by id. */
let searchTable: Record<string, any[] | 'fail'> = {};
let artistTable: Record<string, any> = {};
let spotifyCalls: string[] = [];
const realFetch = globalThis.fetch;
function installSpotifyMock() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (!url.includes('spotify.com')) return realFetch(input, init);
    spotifyCalls.push(url);
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes('/api/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.includes('/v1/search')) {
      const hits = searchTable[decodeURIComponent(new URL(url).searchParams.get('q') ?? '')];
      return hits === 'fail' ? json(500, {}) : json(200, { artists: { items: hits ?? [] } });
    }
    const found = artistTable[url.split('/v1/artists/')[1] ?? ''];
    return found ? json(200, found) : json(404, {});
  }) as any;
}

let app: ArtistServer;
before(async () => {
  if (skip) return;
  installSpotifyMock();
  app = await startArtistServer();
});
after(async () => {
  globalThis.fetch = realFetch;
  if (app) await app.close();
});
afterEach(() => {
  searchTable = {};
  artistTable = {};
  spotifyCalls = [];
});

const elementOf = (artist: any) => ({ id: artist.id, name: artist.name, links: artist.links ?? {} });
const pickBody = (festivalId: string, artist: any, spotifyId: string, acceptedAlsoOn?: number) => ({
  festivalId,
  picks: [{ artistId: artist.id, expectedUpdatedAt: artist.updatedAt, spotifyId, ...(acceptedAlsoOn === undefined ? {} : { acceptedAlsoOn }) }],
});
const artistRow = async (artistId: string) =>
  withPool(async (pool) => (await pool.query('SELECT links, spotify_id, photo, genres, updated_at FROM artists WHERE id = $1', [artistId])).rows[0]);

describe('spotify candidates and picks', { skip, concurrency: 1 }, () => {
  test('both routes refuse a caller without an admin session', async () => {
    await app.server.request.post('/api/v1/admin/artists/spotify-candidates').send({ festivalId: 'x' }).expect(401);
    await app.server.request.post('/api/v1/admin/artists/spotify-picks').send({}).expect(401);
  });

  test('candidates: ranks exact names first, skips artists that have a link, and writes nothing', async () => {
    const alpha = await createArtist(app, { name: 'Cand Alpha' });
    const linked = await createArtist(app, { name: 'Cand Linked', link: `https://open.spotify.com/artist/${id(90)}` });
    const none = await createArtist(app, { name: 'Cand Nobody' });
    await withPool((pool) =>
      seedFestival(pool, {
        id: 'fest-cand-1',
        sets: [alpha, linked, none].map((a, i) => ({ id: `cand-1-${i}`, artist: a.name, artists: [elementOf(a)] })),
      }),
    );
    searchTable = {
      'Cand Alpha': [spotifyArtist(1, 'Cand Alphabet', 9000), spotifyArtist(2, 'Cand Alpha', 50)],
      'Cand Nobody': [],
    };
    const before = await artistRow(alpha.id);
    const res = await app.post('/api/v1/admin/artists/spotify-candidates', { festivalId: 'fest-cand-1' }).expect(200);
    const rows = res.body.data.artists;
    assert.deepEqual(rows.map((r: any) => r.artist.name).sort(), ['Cand Alpha', 'Cand Nobody']);
    const alphaRow = rows.find((r: any) => r.artist.name === 'Cand Alpha');
    assert.deepEqual(alphaRow.candidates.map((c: any) => [c.name, c.exact]), [['Cand Alpha', true], ['Cand Alphabet', false]]);
    assert.equal(alphaRow.candidates[0].spotifyUrl, `https://open.spotify.com/artist/${id(2)}`);
    assert.equal(alphaRow.singleExact, true);
    const nobody = rows.find((r: any) => r.artist.name === 'Cand Nobody');
    assert.deepEqual(nobody.candidates, []);
    assert.equal(nobody.singleExact, false);
    assert.equal(res.body.data.searchFailed, 0);
    assert.ok(!spotifyCalls.some((url) => url.includes('Cand%20Linked')), 'an artist with a Spotify link is not searched');
    assert.deepEqual((await artistRow(alpha.id)).updated_at, before.updated_at, 'the search changed nothing');
    assert.deepEqual((await artistRow(alpha.id)).links, {});
  });

  test('candidates: same-name artists and a Spotify id that another artist holds are never single exact matches', async () => {
    const holder = await createArtist(app, { name: 'Cand Holder', link: `https://open.spotify.com/artist/${id(10)}` });
    const twinA = await createArtist(app, { name: 'Cand Twin' });
    const twinB = await createArtist(app, { name: 'Cand Twin', label: 'UK' });
    const taken = await createArtist(app, { name: 'Cand Taken' });
    await withPool((pool) =>
      seedFestival(pool, {
        id: 'fest-cand-2',
        sets: [twinA, twinB, taken].map((a, i) => ({ id: `cand-2-${i}`, artist: a.name, artists: [elementOf(a)] })),
      }),
    );
    searchTable = { 'Cand Twin': [spotifyArtist(11, 'Cand Twin')], 'Cand Taken': [spotifyArtist(10, 'Cand Taken')] };
    const res = await app.post('/api/v1/admin/artists/spotify-candidates', { festivalId: 'fest-cand-2' }).expect(200);
    const rows = res.body.data.artists;
    assert.equal(rows.length, 3);
    for (const row of rows.filter((r: any) => r.artist.name === 'Cand Twin')) {
      assert.equal(row.singleExact, false, 'a same-name artist is picked by hand');
      assert.equal(row.artist.sameName, true);
    }
    const takenRow = rows.find((r: any) => r.artist.name === 'Cand Taken');
    assert.equal(takenRow.candidates[0].linkedTo, 'Cand Holder');
    assert.equal(takenRow.singleExact, false);
    assert.ok(holder.id);
  });

  test('candidates: a name Spotify refused is counted, and the rest still show', async () => {
    const good = await createArtist(app, { name: 'Cand Good' });
    const bad = await createArtist(app, { name: 'Cand Bad' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-cand-3', sets: [good, bad].map((a, i) => ({ id: `cand-3-${i}`, artist: a.name, artists: [elementOf(a)] })) }),
    );
    searchTable = { 'Cand Good': [spotifyArtist(20, 'Cand Good')], 'Cand Bad': 'fail' };
    const res = await app.post('/api/v1/admin/artists/spotify-candidates', { festivalId: 'fest-cand-3' }).expect(200);
    assert.equal(res.body.data.searchFailed, 1);
    assert.equal(res.body.data.artists.find((r: any) => r.artist.name === 'Cand Good').candidates.length, 1);
  });

  test('candidates: artists in exclude are not searched, so the artists after them can be', async () => {
    const first = await createArtist(app, { name: 'Excl Alpha' });
    const second = await createArtist(app, { name: 'Excl Beta' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-excl', sets: [first, second].map((a, i) => ({ id: `excl-${i}`, artist: a.name, artists: [elementOf(a)] })) }),
    );
    searchTable = { 'Excl Alpha': [], 'Excl Beta': [spotifyArtist(25, 'Excl Beta')] };
    const res = await app.post('/api/v1/admin/artists/spotify-candidates', { festivalId: 'fest-excl', exclude: [first.id] }).expect(200);
    assert.deepEqual(res.body.data.artists.map((r: any) => r.artist.name), ['Excl Beta']);
    assert.equal(res.body.data.notSearched, 0);
    assert.ok(!spotifyCalls.some((url) => url.includes('Excl%20Alpha')), 'an excluded artist is not searched');
    await app.post('/api/v1/admin/artists/spotify-candidates', { festivalId: 'fest-excl', exclude: Array(1001).fill('x') }).expect(400);
  });

  test('picks: store the link and spotify_id, fill an empty photo and genres, and rewrite the festival copy', async () => {
    const artist = await createArtist(app, { name: 'Pick Me' });
    await withPool((pool) => seedFestival(pool, { id: 'fest-pick-1', sets: [{ id: 'pick-1-0', artist: 'Pick Me', artists: [elementOf(artist)] }] }));
    const festivalBefore = await withPool((pool) => festivalRow(pool, 'fest-pick-1'));
    artistTable[id(30)] = spotifyArtist(30, 'Pick Me', 777);
    const res = await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-pick-1', artist, id(30))).expect(200);
    assert.equal(res.body.data.results[0].status, 'saved');
    const row = await artistRow(artist.id);
    assert.equal(row.links.spotify, `https://open.spotify.com/artist/${id(30)}`);
    assert.equal(row.spotify_id, id(30));
    assert.equal(row.photo, 'https://i.scdn.co/image/30');
    assert.deepEqual(row.genres, ['house', 'techno']);
    const set = await withPool((pool) => setRow(pool, 'pick-1-0'));
    assert.equal(set.artists[0].links.spotify, `https://open.spotify.com/artist/${id(30)}`);
    assert.equal(set.artists[0].photo, 'https://i.scdn.co/image/30');
    assert.equal(set.link_url, `https://open.spotify.com/artist/${id(30)}`);
    const festivalAfter = await withPool((pool) => festivalRow(pool, 'fest-pick-1'));
    assert.ok(festivalAfter.updated_at > festivalBefore.updated_at, 'the festival version moved');
    assert.deepEqual(festivalAfter.edited_at, festivalBefore.edited_at, 'a pick is not a festival form edit');
    // The audit entry names every field the pick changed: the link, and the photo and genres it filled.
    let entry: any[] = [];
    for (let attempt = 0; attempt < 50 && !entry.length; attempt++) {
      entry = await withPool(async (pool) =>
        (await pool.query(`SELECT details_json FROM audit_log WHERE action = 'artist.updated' AND target_id = $1`, [artist.id])).rows,
      );
      if (!entry.length) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(entry.length, 1, 'one transactional audit row per pick');
    const details = typeof entry[0].details_json === 'string' ? JSON.parse(entry[0].details_json) : entry[0].details_json;
    assert.equal(details.via, 'spotify-pick');
    assert.deepEqual(details.fields, ['spotify', 'photo', 'genres']);
    assert.equal(details.before.photo, null);
    assert.equal(details.after.photo, 'https://i.scdn.co/image/30');
    assert.deepEqual(details.after.genres, ['house', 'techno']);
  });

  test('picks: a photo and genres the artist already has stay', async () => {
    const artist = await createArtist(app, { name: 'Pick Keep' });
    await withPool((pool) =>
      pool.query(`UPDATE artists SET photo = 'https://example.com/mine.jpg', genres = '["ambient"]'::jsonb WHERE id = $1`, [artist.id]),
    );
    const fresh = (await app.get('/api/v1/admin/artists?q=pick keep').expect(200)).body.data.artists[0];
    await withPool((pool) => seedFestival(pool, { id: 'fest-pick-2', sets: [{ id: 'pick-2-0', artist: 'Pick Keep', artists: [elementOf(fresh)] }] }));
    artistTable[id(31)] = spotifyArtist(31, 'Pick Keep');
    await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-pick-2', fresh, id(31))).expect(200);
    const row = await artistRow(artist.id);
    assert.equal(row.photo, 'https://example.com/mine.jpg');
    assert.deepEqual(row.genres, ['ambient']);
    assert.equal(row.spotify_id, id(31));
  });

  test('picks: an id that Spotify does not know is refused and nothing is written', async () => {
    const artist = await createArtist(app, { name: 'Pick Ghost' });
    await withPool((pool) => seedFestival(pool, { id: 'fest-pick-3', sets: [{ id: 'pick-3-0', artist: 'Pick Ghost', artists: [elementOf(artist)] }] }));
    const res = await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-pick-3', artist, id(32))).expect(200);
    assert.equal(res.body.data.results[0].status, 'unavailable');
    assert.deepEqual((await artistRow(artist.id)).links, {});
  });

  test('picks: a bad Spotify id or an empty list is a 400', async () => {
    const artist = await createArtist(app, { name: 'Pick Bad Id' });
    await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-x', artist, 'not-an-id')).expect(400);
    await app.post('/api/v1/admin/artists/spotify-picks', { festivalId: 'fest-x', picks: [] }).expect(400);
  });

  test('picks: a stale token is reported on its row with the current artist, and the other picks still apply', async () => {
    const stale = await createArtist(app, { name: 'Pick Stale' });
    const fine = await createArtist(app, { name: 'Pick Fine' });
    await withPool((pool) =>
      seedFestival(pool, {
        id: 'fest-pick-4',
        sets: [stale, fine].map((a, i) => ({ id: `pick-4-${i}`, artist: a.name, artists: [elementOf(a)] })),
      }),
    );
    await app.patch(`/api/v1/admin/artists/${stale.id}`, { expectedUpdatedAt: stale.updatedAt, changes: { label: 'moved' } }).expect(200);
    artistTable[id(33)] = spotifyArtist(33, 'Pick Stale');
    artistTable[id(34)] = spotifyArtist(34, 'Pick Fine');
    const res = await app.post('/api/v1/admin/artists/spotify-picks', {
      festivalId: 'fest-pick-4',
      picks: [
        { artistId: stale.id, expectedUpdatedAt: stale.updatedAt, spotifyId: id(33) },
        { artistId: fine.id, expectedUpdatedAt: fine.updatedAt, spotifyId: id(34) },
      ],
    }).expect(200);
    const [first, second] = res.body.data.results;
    assert.equal(first.status, 'changed');
    assert.equal(first.artist.label, 'moved');
    assert.equal(second.status, 'saved');
    assert.deepEqual((await artistRow(stale.id)).links, {});
  });

  test('picks: a Spotify id that another artist holds is reported as taken, naming that artist', async () => {
    await createArtist(app, { name: 'Pick Holder', label: 'NL', link: `https://open.spotify.com/artist/${id(35)}` });
    const artist = await createArtist(app, { name: 'Pick Taker' });
    await withPool((pool) => seedFestival(pool, { id: 'fest-pick-5', sets: [{ id: 'pick-5-0', artist: 'Pick Taker', artists: [elementOf(artist)] }] }));
    artistTable[id(35)] = spotifyArtist(35, 'Pick Holder');
    const res = await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-pick-5', artist, id(35))).expect(200);
    assert.equal(res.body.data.results[0].status, 'taken');
    assert.match(res.body.data.results[0].message, /already linked to 'Pick Holder \(NL\)'/);
    assert.deepEqual((await artistRow(artist.id)).links, {});
  });

  test('picks: an artist that never had a Spotify link keeps another link it has', async () => {
    const artist = await createArtist(app, { name: 'Pick Insta', link: 'https://www.instagram.com/pickinsta' });
    await withPool((pool) => seedFestival(pool, { id: 'fest-pick-6', sets: [{ id: 'pick-6-0', artist: 'Pick Insta', artists: [elementOf(artist)] }] }));
    artistTable[id(36)] = spotifyArtist(36, 'Pick Insta');
    await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-pick-6', artist, id(36))).expect(200);
    const links = (await artistRow(artist.id)).links;
    assert.equal(links.instagram, 'https://www.instagram.com/pickinsta');
    assert.equal(links.spotify, `https://open.spotify.com/artist/${id(36)}`);
  });

  test('picks: an artist on other festivals needs the editor to accept, then every festival follows', async () => {
    const artist = await createArtist(app, { name: 'Pick Shared' });
    const element = elementOf(artist);
    await withPool(async (pool) => {
      await seedFestival(pool, { id: 'fest-shared-a', sets: [{ id: 'shared-a', artist: 'Pick Shared', artists: [element] }] });
      await seedFestival(pool, { id: 'fest-shared-b', date: '2020-01-01', sets: [{ id: 'shared-b', artist: 'Pick Shared', artists: [element] }] });
    });
    artistTable[id(37)] = spotifyArtist(37, 'Pick Shared');
    const refused = await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-shared-a', artist, id(37), 0)).expect(200);
    assert.deepEqual([refused.body.data.results[0].status, refused.body.data.results[0].alsoOn], ['shared', 1]);
    assert.deepEqual((await artistRow(artist.id)).links, {}, 'nothing is written without the editor accepting');
    assert.deepEqual((await withPool((pool) => setRow(pool, 'shared-b'))).artists[0].links, {});

    const accepted = await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-shared-a', artist, id(37), 1)).expect(200);
    assert.equal(accepted.body.data.results[0].status, 'saved');
    assert.equal(accepted.body.data.results[0].festivalsUpdated, 2);
    for (const setId of ['shared-a', 'shared-b']) {
      assert.equal((await withPool((pool) => setRow(pool, setId))).artists[0].links.spotify, `https://open.spotify.com/artist/${id(37)}`, setId);
    }
  });

  test('picks: a pick confirmed for 1 festival is refused when the artist is now on 3, and writes nothing', async () => {
    const artist = await createArtist(app, { name: 'Pick Grown' });
    const element = elementOf(artist);
    await withPool(async (pool) => {
      for (const letter of ['a', 'b', 'c', 'd']) {
        await seedFestival(pool, { id: `fest-grown-${letter}`, sets: [{ id: `grown-${letter}`, artist: 'Pick Grown', artists: [element] }] });
      }
    });
    artistTable[id(39)] = spotifyArtist(39, 'Pick Grown');
    const res = await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-grown-a', artist, id(39), 1)).expect(200);
    assert.deepEqual([res.body.data.results[0].status, res.body.data.results[0].alsoOn], ['shared', 3]);
    assert.deepEqual((await artistRow(artist.id)).links, {});
    assert.deepEqual((await withPool((pool) => setRow(pool, 'grown-d'))).artists[0].links, {});
  });

  test('picks: the shared check runs again under the locks, so a list that was out of date cannot spread a link', async () => {
    const artist = await createArtist(app, { name: 'Pick Race' });
    const element = elementOf(artist);
    await withPool(async (pool) => {
      await seedFestival(pool, { id: 'fest-race-a', sets: [{ id: 'race-a', artist: 'Pick Race', artists: [element] }] });
      await seedFestival(pool, { id: 'fest-race-b', sets: [{ id: 'race-b', artist: 'Pick Race', artists: [] }] });
    });
    artistTable[id(38)] = spotifyArtist(38, 'Pick Race');
    const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    const holder = await pool.connect();
    try {
      // Another save holds the only festival the artist is on, so the pick waits for it.
      await holder.query('BEGIN');
      await lockFestivalAny(holder, 'fest-race-a');
      const pending = app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-race-a', artist, id(38), 0)).then((r: any) => r);
      const untouched = await artistRow(artist.id);
      // Wait until a backend really is blocked on a lock, then check that it wrote nothing while it waited.
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const { rowCount } = await holder.query(
          `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        blocked = (rowCount ?? 0) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(blocked, 'the pick is waiting on the festival lock');
      assert.deepEqual((await artistRow(artist.id)).updated_at, untouched.updated_at, 'nothing was written while the pick waited');
      // Meanwhile the artist is added to a second festival. The pick read only the first before it waited.
      await holder.query(`UPDATE festival_sets SET artists = $1::jsonb WHERE id = 'race-b'`, [JSON.stringify([element])]);
      await holder.query('COMMIT');
      const res = await pending;
      assert.equal(res.status, 200);
      assert.deepEqual([res.body.data.results[0].status, res.body.data.results[0].alsoOn], ['shared', 1]);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
      await pool.end();
    }
    assert.deepEqual((await artistRow(artist.id)).links, {});
    assert.deepEqual((await withPool((p) => setRow(p, 'race-b'))).artists[0].links, {});
  });
});
