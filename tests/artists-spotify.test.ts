import 'dotenv/config';
/**
 * "Find Spotify links": the candidates route writes nothing, and the picks route stores only a Spotify
 * artist the editor chose, reads the photo and genres from Spotify, and checks "on other festivals"
 * again under the locks. Spotify is a fetch mock. Needs TEST_DATABASE_URL (a database whose name contains _test).
 */
process.env.SPOTIFY_CLIENT_ID = 'test-client-id';
process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret';
// The file creates more artists than the per-minute route limit allows; a 1 s window keeps the limits from leaking between tests.
process.env.RATE_LIMIT_WINDOW = '1000';

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

  test('replacing a Spotify link drops the old Spotify photo and genres, so the next pick fills them', async () => {
    const artist = await createArtist(app, { name: 'Swap Me' });
    await withPool((pool) => seedFestival(pool, { id: 'fest-swap-1', sets: [{ id: 'swap-1-0', artist: 'Swap Me', artists: [elementOf(artist)] }] }));
    artistTable[id(40)] = spotifyArtist(40, 'Swap Me');
    await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-swap-1', artist, id(40))).expect(200);
    const picked = (await app.get('/api/v1/admin/artists?q=swap me').expect(200)).body.data.artists[0];
    assert.equal(picked.photo, 'https://i.scdn.co/image/40');
    await app.patch(`/api/v1/admin/artists/${artist.id}`, { expectedUpdatedAt: picked.updatedAt, changes: { removeLinks: ['spotify'] } }).expect(200);
    const row = await artistRow(artist.id);
    assert.equal(row.spotify_id, null);
    assert.equal(row.photo, null);
    assert.deepEqual(row.genres, []);
    const set = await withPool((pool) => setRow(pool, 'swap-1-0'));
    assert.equal(set.artists[0].photo, undefined, 'the festival copy loses the old photo too');
    const fresh = (await app.get('/api/v1/admin/artists?q=swap me').expect(200)).body.data.artists[0];
    artistTable[id(41)] = spotifyArtist(41, 'Swap Me');
    await app.post('/api/v1/admin/artists/spotify-picks', pickBody('fest-swap-1', fresh, id(41))).expect(200);
    assert.equal((await artistRow(artist.id)).photo, 'https://i.scdn.co/image/41');
  });

  test('a photo that did not come from Spotify stays when the Spotify link goes', async () => {
    const artist = await createArtist(app, { name: 'Swap Keep', link: `https://open.spotify.com/artist/${id(42)}` });
    await withPool((pool) => pool.query(`UPDATE artists SET photo = 'https://example.com/mine.jpg' WHERE id = $1`, [artist.id]));
    const fresh = (await app.get('/api/v1/admin/artists?q=swap keep').expect(200)).body.data.artists[0];
    await app.patch(`/api/v1/admin/artists/${artist.id}`, { expectedUpdatedAt: fresh.updatedAt, changes: { removeLinks: ['spotify'] } }).expect(200);
    assert.equal((await artistRow(artist.id)).photo, 'https://example.com/mine.jpg');
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

describe('spotify refresh', { skip, concurrency: 1 }, () => {
  const link = (n: number) => `https://open.spotify.com/artist/${id(n)}`;
  const auditRows = (artistId: string) =>
    withPool(async (pool) =>
      (await pool.query(`SELECT details_json FROM audit_log WHERE action = 'artist.updated' AND target_id = $1`, [artistId])).rows.map((r: any) =>
        typeof r.details_json === 'string' ? JSON.parse(r.details_json) : r.details_json,
      ),
    );

  test('refresh: refuses a caller without an admin session and a body without a festival', async () => {
    await app.server.request.post('/api/v1/admin/artists/spotify-refresh').send({ festivalId: 'x' }).expect(401);
    await app.post('/api/v1/admin/artists/spotify-refresh', {}).expect(400);
  });

  test('refresh: fills an empty photo and genres, in the sets and the lineup, and audits it', async () => {
    const artist = await createArtist(app, { name: 'Refresh Me', link: link(60) });
    const element = elementOf(artist);
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-ref-1', lineup: [{ id: 'l1', artists: [element] }], sets: [{ id: 'ref-1-0', artist: 'Refresh Me', artists: [element] }] }),
    );
    artistTable[id(60)] = spotifyArtist(60, 'Refresh Me');
    const res = await app.post('/api/v1/admin/artists/spotify-refresh', { festivalId: 'fest-ref-1' }).expect(200);
    assert.deepEqual([res.body.data.updated, res.body.data.skipped, res.body.data.unavailable], [1, 0, 0]);
    assert.deepEqual(res.body.data.results, [{ artistId: artist.id, status: 'updated' }]);
    const row = await artistRow(artist.id);
    assert.equal(row.photo, 'https://i.scdn.co/image/60');
    assert.deepEqual(row.genres, ['house', 'techno']);
    assert.equal(row.spotify_id, id(60));
    const set = await withPool((pool) => setRow(pool, 'ref-1-0'));
    assert.equal(set.artists[0].photo, 'https://i.scdn.co/image/60');
    const festival = await withPool((pool) => festivalRow(pool, 'fest-ref-1'));
    assert.equal(festival.lineup[0].artists[0].photo, 'https://i.scdn.co/image/60');
    let entries: any[] = [];
    for (let attempt = 0; attempt < 50 && entries.length < 2; attempt++) {
      entries = await auditRows(artist.id);
      if (entries.length < 2) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const refresh = entries.find((entry) => entry.via === 'spotify-refresh');
    assert.deepEqual(refresh?.fields, ['photo', 'genres']);
  });

  test('refresh: never overwrites a photo or genres an admin set, and skips an artist without a Spotify link', async () => {
    const kept = await createArtist(app, { name: 'Refresh Kept', link: link(61) });
    const bare = await createArtist(app, { name: 'Refresh Bare' });
    await withPool((pool) =>
      pool.query(`UPDATE artists SET photo = 'https://example.com/mine.jpg', genres = '["ambient"]'::jsonb WHERE id = $1`, [kept.id]),
    );
    const fresh = (await app.get('/api/v1/admin/artists?q=refresh kept').expect(200)).body.data.artists[0];
    await withPool((pool) =>
      seedFestival(pool, {
        id: 'fest-ref-2',
        sets: [
          { id: 'ref-2-0', artist: 'Refresh Kept', artists: [elementOf(fresh)] },
          { id: 'ref-2-1', artist: 'Refresh Bare', artists: [elementOf(bare)] },
        ],
      }),
    );
    artistTable[id(61)] = spotifyArtist(61, 'Refresh Kept');
    const res = await app.post('/api/v1/admin/artists/spotify-refresh', { festivalId: 'fest-ref-2' }).expect(200);
    assert.deepEqual([res.body.data.updated, res.body.data.skipped, res.body.data.unavailable, res.body.data.results.length], [0, 0, 0, 0]);
    const row = await artistRow(kept.id);
    assert.equal(row.photo, 'https://example.com/mine.jpg');
    assert.deepEqual(row.genres, ['ambient']);
    assert.equal((await artistRow(bare.id)).photo, null);
  });

  test('refresh: an artist with a photo but no genres reaches the store, which fills only the genres', async () => {
    const part = await createArtist(app, { name: 'Refresh Part', link: link(64) });
    await withPool((pool) => pool.query(`UPDATE artists SET photo = 'https://example.com/mine.jpg' WHERE id = $1`, [part.id]));
    const fresh = (await app.get('/api/v1/admin/artists?q=refresh part').expect(200)).body.data.artists[0];
    await withPool((pool) => seedFestival(pool, { id: 'fest-ref-5', sets: [{ id: 'ref-5-0', artist: 'Refresh Part', artists: [elementOf(fresh)] }] }));
    artistTable[id(64)] = spotifyArtist(64, 'Refresh Part');
    const res = await app.post('/api/v1/admin/artists/spotify-refresh', { festivalId: 'fest-ref-5' }).expect(200);
    assert.deepEqual(res.body.data.results, [{ artistId: part.id, status: 'updated' }]);
    const row = await artistRow(part.id);
    assert.equal(row.photo, 'https://example.com/mine.jpg');
    assert.deepEqual(row.genres, ['house', 'techno']);
    let entries: any[] = [];
    for (let attempt = 0; attempt < 50 && !entries.some((entry) => entry.via === 'spotify-refresh'); attempt++) {
      entries = await auditRows(part.id);
      if (!entries.some((entry) => entry.via === 'spotify-refresh')) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual(entries.find((entry) => entry.via === 'spotify-refresh')?.fields, ['genres']);
  });

  test('refresh: reports unavailable when Spotify returns nothing, and writes nothing', async () => {
    const artist = await createArtist(app, { name: 'Refresh Ghost', link: link(62) });
    await withPool((pool) => seedFestival(pool, { id: 'fest-ref-3', sets: [{ id: 'ref-3-0', artist: 'Refresh Ghost', artists: [elementOf(artist)] }] }));
    const res = await app.post('/api/v1/admin/artists/spotify-refresh', { festivalId: 'fest-ref-3' }).expect(200);
    assert.deepEqual([res.body.data.updated, res.body.data.unavailable], [0, 1]);
    assert.deepEqual(res.body.data.results, [{ artistId: artist.id, status: 'unavailable' }]);
    assert.equal((await artistRow(artist.id)).photo, null);
  });

  test('refresh: an artist on another festival is filled and every festival copy follows', async () => {
    const artist = await createArtist(app, { name: 'Refresh Shared', link: link(63) });
    const element = elementOf(artist);
    await withPool(async (pool) => {
      await seedFestival(pool, { id: 'fest-ref-4a', sets: [{ id: 'ref-4a', artist: 'Refresh Shared', artists: [element] }] });
      await seedFestival(pool, { id: 'fest-ref-4b', date: '2020-01-01', sets: [{ id: 'ref-4b', artist: 'Refresh Shared', artists: [element] }] });
    });
    artistTable[id(63)] = spotifyArtist(63, 'Refresh Shared');
    await app.post('/api/v1/admin/artists/spotify-refresh', { festivalId: 'fest-ref-4a' }).expect(200);
    for (const setId of ['ref-4a', 'ref-4b']) {
      assert.equal((await withPool((pool) => setRow(pool, setId))).artists[0].photo, 'https://i.scdn.co/image/63', setId);
    }
  });
});

describe('spotify stale refresh (30-day limit)', { skip, concurrency: 1 }, () => {
  const link = (n: number) => `https://open.spotify.com/artist/${id(n)}`;
  const state = (artistId: string) =>
    withPool(async (pool) => (await pool.query('SELECT photo, genres, spotify_fetched_at, updated_at FROM artists WHERE id = $1', [artistId])).rows[0]);
  const ageFetched = (artistId: string, days: number | null) =>
    withPool((pool) =>
      pool.query(`UPDATE artists SET spotify_fetched_at = ${days === null ? 'NULL' : `now() - make_interval(days => ${days})`} WHERE id = $1`, [artistId]),
    );
  const asked = (n: number) => spotifyCalls.some((url) => url.includes(`/v1/artists/${id(n)}`));

  test('refuses a caller without an admin session', async () => {
    await app.server.request.post('/api/v1/admin/artists/spotify-refresh-stale').send({}).expect(401);
  });

  test('re-reads an artist never read or read 31 days ago, overwrites photo and genres, follows the festival copies and stamps it', async () => {
    const never = await createArtist(app, { name: 'Stale Never', link: link(80) });
    const old = await createArtist(app, { name: 'Stale Old', link: link(81) });
    await withPool(async (pool) => {
      await pool.query(`UPDATE artists SET photo = 'https://i.scdn.co/image/old', genres = '["old genre"]'::jsonb WHERE id = ANY($1)`, [[never.id, old.id]]);
      await seedFestival(pool, {
        id: 'fest-stale-1',
        sets: [
          { id: 'stale-1-0', artist: 'Stale Never', artists: [elementOf(never)] },
          { id: 'stale-1-1', artist: 'Stale Old', artists: [elementOf(old)] },
        ],
      });
    });
    await ageFetched(never.id, null);
    await ageFetched(old.id, 31);
    artistTable[id(80)] = spotifyArtist(80, 'Stale Never');
    artistTable[id(81)] = spotifyArtist(81, 'Stale Old');
    const res = await app.post('/api/v1/admin/artists/spotify-refresh-stale', {}).expect(200);
    assert.ok(res.body.data.updated >= 2);
    for (const [artist, n] of [[never, 80], [old, 81]] as const) {
      const row = await state(artist.id);
      assert.equal(row.photo, `https://i.scdn.co/image/${n}`);
      assert.deepEqual(row.genres, ['house', 'techno']);
      assert.ok(Date.now() - new Date(row.spotify_fetched_at).getTime() < 60_000, 'stamped now');
    }
    assert.equal((await withPool((pool) => setRow(pool, 'stale-1-0'))).artists[0].photo, 'https://i.scdn.co/image/80');
    assert.equal((await withPool((pool) => setRow(pool, 'stale-1-1'))).artists[0].photo, 'https://i.scdn.co/image/81');
  });

  test('leaves an artist read 5 days ago alone and never asks Spotify about it', async () => {
    const fresh = await createArtist(app, { name: 'Stale Fresh', link: link(82) });
    await withPool((pool) => pool.query(`UPDATE artists SET photo = 'https://i.scdn.co/image/keep' WHERE id = $1`, [fresh.id]));
    await ageFetched(fresh.id, 5);
    artistTable[id(82)] = spotifyArtist(82, 'Stale Fresh');
    await app.post('/api/v1/admin/artists/spotify-refresh-stale', {}).expect(200);
    assert.equal(asked(82), false);
    assert.equal((await state(fresh.id)).photo, 'https://i.scdn.co/image/keep');
  });

  test('clears a photo Spotify no longer returns, and stamps an unchanged artist without touching updated_at', async () => {
    const dropped = await createArtist(app, { name: 'Stale Dropped', link: link(83) });
    const same = await createArtist(app, { name: 'Stale Same', link: link(84) });
    await withPool((pool) =>
      pool.query(`UPDATE artists SET photo = 'https://i.scdn.co/image/gone', genres = '["old"]'::jsonb WHERE id = $1`, [dropped.id]),
    );
    await withPool((pool) =>
      pool.query(`UPDATE artists SET photo = 'https://i.scdn.co/image/84', genres = '["house","techno"]'::jsonb WHERE id = $1`, [same.id]),
    );
    const before = await state(same.id);
    artistTable[id(83)] = { ...spotifyArtist(83, 'Stale Dropped'), images: [], genres: [] };
    artistTable[id(84)] = spotifyArtist(84, 'Stale Same');
    await app.post('/api/v1/admin/artists/spotify-refresh-stale', {}).expect(200);
    const gone = await state(dropped.id);
    assert.equal(gone.photo, null);
    assert.deepEqual(gone.genres, []);
    const unchanged = await state(same.id);
    assert.ok(unchanged.spotify_fetched_at, 'stamped');
    assert.equal(unchanged.updated_at.getTime(), before.updated_at.getTime(), 'an unchanged artist keeps its edit token');
  });

  test('an artist Spotify does not answer for keeps its data and is not stamped, so it is tried again', async () => {
    const ghost = await createArtist(app, { name: 'Stale Ghost', link: link(85) });
    await withPool((pool) => pool.query(`UPDATE artists SET photo = 'https://i.scdn.co/image/ghost' WHERE id = $1`, [ghost.id]));
    const res = await app.post('/api/v1/admin/artists/spotify-refresh-stale', {}).expect(200);
    assert.ok(res.body.data.unavailable >= 1);
    const row = await state(ghost.id);
    assert.equal(row.photo, 'https://i.scdn.co/image/ghost');
    assert.equal(row.spotify_fetched_at, null);
  });

  test('the cron function stops at the limit and reports a missing Spotify key without reading anything', async () => {
    const { refreshStaleSpotifyArtists } = await import('../lib/spotify-refresh');
    const { createArtistsStore } = await import('../lib/db/stores/artists');
    await withPool(async (pool) => {
      const stores = { artists: createArtistsStore(pool) };
      const log = { info() {}, warn() {}, error() {} };
      const unconfigured = await refreshStaleSpotifyArtists({ stores, config: {}, log });
      assert.equal(unconfigured.skipped, 'spotify_not_configured');
      assert.equal(unconfigured.checked, 0);
      const asks: string[][] = [];
      const lookup = async (ids: string[]) => (asks.push(ids), new Map());
      const config = { SPOTIFY_CLIENT_ID: 'x', SPOTIFY_CLIENT_SECRET: 'y' };
      const limited = await refreshStaleSpotifyArtists({ stores, config, log, limit: 2, lookup });
      assert.equal(limited.checked, 2);
      assert.equal(asks.flat().length <= 2, true);
      assert.equal(limited.unavailable, 2, 'a stub lookup that knows nobody leaves both untouched');
    });
  });
});
