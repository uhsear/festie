import 'dotenv/config';
/**
 * One artist edit rewrites the copy in every festival that lists the artist, and an
 * artist edit never makes an open festival form stale. Needs TEST_DATABASE_URL.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createArtistsStore, isCurrentOrUpcoming, rewriteCopies } from '../lib/db/stores/artists';
import { createArtist, dropFestivalCache, festivalRow, formBody, seedFestival, setRow, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';

const SPOTIFY = 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb';
const SPOTIFY_FORM = 'https://open.spotify.com/artist/0du5cEVh5yTK9QJze8zA0C';
// One id per test below: the artists table allows a Spotify id once, and the tests share a database.
const spotifyArtist = (id: string) => `https://open.spotify.com/artist/${id}`;

let app: ArtistServer;
before(async () => {
  if (!skip) app = await startArtistServer();
});
after(async () => {
  if (app) await app.close();
});

const rename = (artist: any, changes: Record<string, unknown>) =>
  app.patch(`/api/v1/admin/artists/${artist.id}`, { expectedUpdatedAt: artist.updatedAt, changes });

describe('syncArtistCopies', { skip, concurrency: 1 }, () => {
  test('one edit updates two festivals and an archived one, with each festival\'s separator', async () => {
    const alpha = await createArtist(app, { name: 'Sync Alpha' });
    const beta = await createArtist(app, { name: 'Sync Beta' });
    const a = { id: alpha.id, name: 'Sync Alpha', links: {} };
    const b = { id: beta.id, name: 'Sync Beta', links: {} };
    await withPool(async (pool) => {
      await seedFestival(pool, {
        id: 'fest-sync-1',
        separator: 'b2b',
        sets: [
          { id: 'sync-s1', artist: 'Sync Alpha b2b Sync Beta', artists: [a, b] },
          // The flat name differs from the joined names and display_name is set: both are the editor's choice.
          { id: 'sync-s2', artist: 'Poster Name', artists: [a], displayName: 'On the Poster' },
        ],
      });
      await seedFestival(pool, {
        id: 'fest-sync-2',
        separator: 'x',
        published: true,
        sets: [{ id: 'sync-s3', artist: 'Sync Alpha x Sync Beta', artists: [a, b] }],
      });
      await seedFestival(pool, { id: 'fest-sync-3', deleted: true, sets: [{ id: 'sync-s4', artist: 'Sync Alpha', artists: [a] }] });
    });

    const res = await rename(alpha, { name: 'Sync Alpha Renamed', addLink: SPOTIFY }).expect(200);
    assert.equal(res.body.data.festivalsUpdated, 3);

    await withPool(async (pool) => {
      const s1 = await setRow(pool, 'sync-s1');
      assert.equal(s1.artist, 'Sync Alpha Renamed b2b Sync Beta');
      assert.deepEqual(s1.artists.map((e: any) => e.name), ['Sync Alpha Renamed', 'Sync Beta']);
      assert.deepEqual(s1.artists[0].links, { spotify: SPOTIFY });
      assert.equal(s1.artists[0].id, alpha.id);
      assert.equal(s1.link_url, SPOTIFY);

      const s2 = await setRow(pool, 'sync-s2');
      assert.equal(s2.artist, 'Poster Name');
      assert.equal(s2.display_name, 'On the Poster');
      assert.equal(s2.artists[0].name, 'Sync Alpha Renamed');

      assert.equal((await setRow(pool, 'sync-s3')).artist, 'Sync Alpha Renamed x Sync Beta');
      // A soft-deleted festival is rewritten too, so a restore shows current copies.
      const s4 = await setRow(pool, 'sync-s4');
      assert.equal(s4.artist, 'Sync Alpha Renamed');
      assert.deepEqual(s4.artists[0].links, { spotify: SPOTIFY });

      for (const id of ['fest-sync-1', 'fest-sync-2', 'fest-sync-3']) {
        const row = await festivalRow(pool, id);
        assert.ok(new Date(row.updated_at) > new Date('2026-06-01'), `${id} updated_at moves so caches and the list version change`);
        assert.equal(new Date(row.edited_at).toISOString(), '2026-01-01T00:00:00.000Z', `${id} edited_at stays: an open form is not stale`);
      }
    });
  });

  test('the renamed artist shows in the festival document right away', async () => {
    const artist = await createArtist(app, { name: 'Doc Before' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-sync-doc', sets: [{ id: 'sync-doc-1', artist: 'Doc Before', artists: [{ id: artist.id, name: 'Doc Before', links: {} }] }] }),
    );
    const before1 = await app.get('/api/v1/admin/festivals/fest-sync-doc').expect(200);
    assert.equal(before1.body.data.days[0].sets[0].artist, 'Doc Before');
    await rename(artist, { name: 'Doc After' }).expect(200);
    const after1 = await app.get('/api/v1/admin/festivals/fest-sync-doc').expect(200);
    assert.equal(after1.body.data.days[0].sets[0].artist, 'Doc After');
    assert.equal(after1.body.data.days[0].sets[0].artists[0].name, 'Doc After');
  });

  test('an announced-lineup entry follows the rename', async () => {
    const artist = await createArtist(app, { name: 'Lineup Before' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-sync-lineup', lineup: [{ artists: [{ id: artist.id, name: 'Lineup Before', links: {} }], displayName: null }], sets: [] }),
    );
    await rename(artist, { name: 'Lineup After' }).expect(200);
    await withPool(async (pool) => {
      assert.equal((await festivalRow(pool, 'fest-sync-lineup')).lineup[0].artists[0].name, 'Lineup After');
    });
  });

  test('a note-only change rewrites no festival', async () => {
    const artist = await createArtist(app, { name: 'Note Only' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-sync-note', sets: [{ id: 'sync-note-1', artist: 'Note Only', artists: [{ id: artist.id, name: 'Note Only', links: {} }] }] }),
    );
    const res = await rename(artist, { label: 'UK' }).expect(200);
    assert.equal(res.body.data.festivalsUpdated, 0);
  });
});

describe('the Spotify fill and the artist row', { skip, concurrency: 1 }, () => {
  test('an artist on an archived festival counts as shared, so a fill leaves it alone', async () => {
    const artist = await createArtist(app, { name: 'Fill Shared' });
    const element = { id: artist.id, name: 'Fill Shared', links: {} };
    await withPool(async (pool) => {
      await seedFestival(pool, { id: 'fest-fill-live', sets: [{ id: 'fill-s1', artist: 'Fill Shared', artists: [element] }] });
      await seedFestival(pool, { id: 'fest-fill-old', deleted: true, sets: [{ id: 'fill-s2', artist: 'Fill Shared', artists: [element] }] });
      const store = createArtistsStore(pool);
      assert.deepEqual([...(await store.sharedElsewhere('fest-fill-live', [artist.id]))], [artist.id]);
      assert.deepEqual([...(await store.sharedElsewhere('fest-fill-old', [artist.id]))], [artist.id]);
    });
  });

  test('a fill that adds nothing leaves updated_at alone, so an open Artists screen gets no false 409', async () => {
    const artist = await createArtist(app, { name: 'Fill Nothing', link: spotifyArtist('2ZxCvBnMqWeRtYuIoPaSdF') });
    await withPool(async (pool) => {
      const store = createArtistsStore(pool);
      const client = await pool.connect();
      try {
        const out = await store.fillEmpty(client, artist.id, { spotifyUrl: spotifyArtist('9KjHgFdSaQwErTyUiOpLmN') });
        assert.equal(out!.changed, false);
      } finally {
        client.release();
      }
      const { rows } = await pool.query('SELECT updated_at FROM artists WHERE id = $1', [artist.id]);
      assert.equal(new Date(rows[0].updated_at).toISOString(), artist.updatedAt);
    });
  });

  test('a fill, then rewriteCopies, brings the lineup copy and a set the run left out to the row', async () => {
    const artist = await createArtist(app, { name: 'Fill Copies' });
    const element = { id: artist.id, name: 'Fill Copies', links: {} };
    await withPool(async (pool) => {
      await seedFestival(pool, {
        id: 'fest-fill-copies',
        lineup: [{ artists: [element], displayName: null }],
        sets: [{ id: 'fill-copy-s1', artist: 'Fill Copies', artists: [element] }],
      });
      const store = createArtistsStore(pool);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const filled = await store.fillEmpty(client, artist.id, { spotifyUrl: spotifyArtist('5LkJhGfDsAzXcVbNmQwErT') });
        assert.equal(filled!.changed, true);
        await rewriteCopies(client, ['fest-fill-copies'], filled!.artist);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      assert.deepEqual((await festivalRow(pool, 'fest-fill-copies')).lineup[0].artists[0].links, { spotify: spotifyArtist('5LkJhGfDsAzXcVbNmQwErT') });
      const row = await setRow(pool, 'fill-copy-s1');
      assert.deepEqual(row.artists[0].links, { spotify: spotifyArtist('5LkJhGfDsAzXcVbNmQwErT') });
      assert.equal(row.link_url, spotifyArtist('5LkJhGfDsAzXcVbNmQwErT'));
    });
  });
});

describe('an artist edit never makes an open festival form stale', { skip, concurrency: 1 }, () => {
  async function openForm(festivalId: string) {
    await dropFestivalCache(app);
    const res = await app.get(`/api/v1/admin/festivals/${festivalId}`).expect(200);
    return res.body.data;
  }

  test('artist edit, then a festival save from a form opened before: no 409, canonical copy wins', async () => {
    const artist = await createArtist(app, { name: 'Form Old' });
    const element = { id: artist.id, name: 'Form Old', links: {} };
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-form-1', sets: [{ id: 'form-s1', artist: 'Form Old', artists: [element] }] }),
    );
    const form = await openForm('fest-form-1');
    await rename(artist, { name: 'Form New', addLink: SPOTIFY_FORM }).expect(200);

    const save = await app.put('/api/v1/admin/festivals/fest-form-1', formBody({ id: 'fest-form-1' }, [
      { id: 'form-s1', artist: 'Form Old', artists: [element], stageId: 'fest-form-1-main', startTime: '20:00', endTime: '23:00' },
    ], { expectedUpdatedAt: form.updatedAt })).expect(200);
    assert.equal(save.body.data.artistRefs.ignoredLinkEdits, 0);
    await withPool(async (pool) => {
      const row = await setRow(pool, 'form-s1');
      assert.equal(row.artist, 'Form New');
      assert.equal(row.link_url, SPOTIFY_FORM);
      assert.equal(row.artists[0].id, artist.id);
    });
  });

  test('a mobile-shaped save after a rename and a new link: no 409, ids kept, canonical links win', async () => {
    const MOBILE_SPOTIFY = spotifyArtist('8PoIuYtReWqAsDfGhJkLzX');
    const SOUNDCLOUD = 'https://soundcloud.com/mobile-old';
    const artist = await createArtist(app, { name: 'Mobile Old', link: SOUNDCLOUD });
    // The mobile form keeps the artist as loaded and sends it back with the id, the name and the links it holds.
    const loaded = { id: artist.id, name: 'Mobile Old', links: { soundcloud: SOUNDCLOUD } };
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-form-mobile', sets: [{ id: 'form-mobile-s1', artist: 'Mobile Old', artists: [loaded], linkUrl: null }] }),
    );
    const form = await openForm('fest-form-mobile');
    await rename(artist, { name: 'Mobile New', removeLinks: ['soundcloud'], addLink: MOBILE_SPOTIFY }).expect(200);

    const save = await app.put('/api/v1/admin/festivals/fest-form-mobile', formBody({ id: 'fest-form-mobile' }, [
      {
        id: 'form-mobile-s1',
        artist: 'Mobile Old',
        artists: [{ id: artist.id, name: 'Mobile Old', links: { soundcloud: SOUNDCLOUD } }],
        stageId: 'fest-form-mobile-main',
        startTime: '20:00',
        endTime: '23:00',
        linkUrl: null,
      },
    ], { expectedUpdatedAt: form.updatedAt })).expect(200);
    assert.equal(save.body.data.artistRefs.ignoredLinkEdits, 1);
    await withPool(async (pool) => {
      const row = await setRow(pool, 'form-mobile-s1');
      assert.equal(row.artists[0].id, artist.id);
      assert.equal(row.artists[0].name, 'Mobile New');
      assert.deepEqual(row.artists[0].links, { spotify: MOBILE_SPOTIFY });
      assert.equal(row.artist, 'Mobile New');
      assert.equal(row.link_url, MOBILE_SPOTIFY);
    });
  });

  test('artist edit, then a map save (no days): no 409', async () => {
    const artist = await createArtist(app, { name: 'Map Old' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-form-2', sets: [{ id: 'form-s2', artist: 'Map Old', artists: [{ id: artist.id, name: 'Map Old', links: {} }] }] }),
    );
    const form = await openForm('fest-form-2');
    await rename(artist, { name: 'Map New' }).expect(200);
    await app.put('/api/v1/admin/festivals/fest-form-2', {
      name: 'fest-form-2',
      stages: [{ id: 'fest-form-2-main', name: 'Main', color: '#ff3366' }],
      expectedUpdatedAt: form.updatedAt,
    }).expect(200);
    await withPool(async (pool) => assert.equal((await setRow(pool, 'form-s2')).artist, 'Map New'));
  });

  test('publish, then a map save from a form opened before: no 409', async () => {
    const artist = await createArtist(app, { name: 'Publish Act' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-form-3', sets: [{ id: 'form-s3', artist: 'Publish Act', artists: [{ id: artist.id, name: 'Publish Act', links: {} }] }] }),
    );
    const form = await openForm('fest-form-3');
    await app.post('/api/v1/admin/festivals/fest-form-3/publish').expect(200);
    await app.put('/api/v1/admin/festivals/fest-form-3', {
      name: 'fest-form-3',
      stages: [{ id: 'fest-form-3-main', name: 'Main', color: '#ff3366' }],
      expectedUpdatedAt: form.updatedAt,
    }).expect(200);
  });

  test('a real festival save by someone else still gives 409', async () => {
    await withPool((pool) => seedFestival(pool, { id: 'fest-form-4', sets: [] }));
    const form = await openForm('fest-form-4');
    const body = { name: 'fest-form-4', stages: [{ id: 'fest-form-4-main', name: 'Main', color: '#ff3366' }], expectedUpdatedAt: form.updatedAt };
    await app.put('/api/v1/admin/festivals/fest-form-4', body).expect(200);
    const stale = await app.put('/api/v1/admin/festivals/fest-form-4', body).expect(409);
    assert.equal(stale.body.error.code, 'FESTIVAL_CHANGED');
  });
});

describe('isCurrentOrUpcoming', () => {
  const now = new Date('2026-06-02T03:00:00Z'); // 23:00 on June 1 in New York, noon on June 2 in Tokyo
  test('a festival with no dated day counts as upcoming', () => {
    assert.equal(isCurrentOrUpcoming({ timeZone: 'America/New_York', lastDate: null }, now), true);
  });
  test('the last day, in the festival\'s own zone, decides, with one day of grace', () => {
    assert.equal(isCurrentOrUpcoming({ timeZone: 'America/New_York', lastDate: '2026-05-31' }, now), true);
    assert.equal(isCurrentOrUpcoming({ timeZone: 'Asia/Tokyo', lastDate: '2026-05-31' }, now), false);
    assert.equal(isCurrentOrUpcoming({ timeZone: 'Asia/Tokyo', lastDate: '2026-06-01' }, now), true);
    assert.equal(isCurrentOrUpcoming({ timeZone: 'America/New_York', lastDate: '2026-05-30' }, now), false);
  });
});
