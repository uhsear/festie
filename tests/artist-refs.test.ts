import 'dotenv/config';
/**
 * resolveArtistRefs directly in a transaction, and through the festival save, the
 * import commit and the import undo. Needs TEST_DATABASE_URL.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { Pool } from 'pg';
import { resolveArtistRefs } from '../lib/artist-refs';
import { artistNameKey, shownSetName } from '../lib/artist-key';
import { createArtist, dropFestivalCache, formBody, seedFestival, setRow, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';

let app: ArtistServer;
before(async () => {
  if (!skip) app = await startArtistServer();
});
after(async () => {
  if (app) await app.close();
});

/** Runs fn in a transaction that always rolls back, so a case leaves no artist behind. */
async function inRolledBackTx<T>(fn: (client: any) => Promise<T>): Promise<T> {
  return withPool(async (pool: Pool) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
}

const daysOf = (...artists: any[][]) => [{ sets: artists.map((list, i) => ({ id: `set-${i}`, artist: list.map((a) => a.name).join(' b2b '), artists: list })) }];
const run = (client: any, days: any[], extra: Record<string, unknown> = {}) =>
  resolveArtistRefs(client, { festivalId: 'fest-none', days, separator: 'b2b', userId: null, ...extra });

describe('resolveArtistRefs', { skip, concurrency: 1 }, () => {
  test('a sent id is kept and the canonical name, links, photo and genres win', async () => {
    const artist = await createArtist(app, { name: 'Canon Name', link: 'https://soundcloud.com/canon' });
    await withPool((pool) =>
      pool.query(`UPDATE artists SET photo = 'https://i.scdn.co/canon.jpg', genres = '["house"]'::jsonb WHERE id = $1`, [artist.id]),
    );
    await inRolledBackTx(async (client) => {
      const out = await run(client, daysOf([{ id: artist.id, name: 'Old Spelling', links: { soundcloud: 'https://soundcloud.com/other' } }]));
      const element = out.days![0].sets[0].artists[0];
      assert.deepEqual(element, {
        id: artist.id,
        name: 'Canon Name',
        links: { soundcloud: 'https://soundcloud.com/canon' },
        photo: 'https://i.scdn.co/canon.jpg',
        genres: ['house'],
      });
      assert.equal(out.ignoredLinkEdits, 1);
      assert.equal(out.days![0].sets[0].artist, 'Canon Name');
    });
  });

  test('the flat artist uses the separator and link_url follows the first artist\'s Spotify link', async () => {
    const first = await createArtist(app, { name: 'Flat One', link: 'https://open.spotify.com/artist/5Pb27ujIyYb33zBqVysBkj' });
    const second = await createArtist(app, { name: 'Flat Two' });
    await inRolledBackTx(async (client) => {
      const days = daysOf([{ id: first.id, name: 'x', links: {} }, { id: second.id, name: 'y', links: {} }]);
      days[0]!.sets[0]!.artist = 'x x y';
      const out = await run(client, days, { separator: 'x' });
      const set = out.days![0].sets[0];
      assert.equal(set.artist, 'Flat One x Flat Two');
      assert.equal(set.linkUrl, 'https://open.spotify.com/artist/5Pb27ujIyYb33zBqVysBkj');
    });
  });

  test('a custom flat name that differs from the joined names survives; one that equals them is rebuilt', async () => {
    const one = await createArtist(app, { name: 'Custom One' });
    const two = await createArtist(app, { name: 'Custom Two' });
    await inRolledBackTx(async (client) => {
      const days = daysOf([{ id: one.id, name: 'Custom One', links: {} }, { id: two.id, name: 'Custom Two', links: {} }], [{ id: one.id, name: 'Old Spelling', links: {} }]);
      days[0]!.sets[0]!.artist = 'Skull Machine';
      const out = await run(client, days);
      assert.equal(out.days![0].sets[0].artist, 'Skull Machine');
      assert.equal(out.days![0].sets[1].artist, 'Custom One');
    });
  });

  test('an unknown id counts as no id; a new name creates an artist', async () => {
    await inRolledBackTx(async (client) => {
      const out = await run(client, daysOf([{ id: 'art-does-not-exist', name: 'Brand New Act', links: {} }]));
      const element = out.days![0].sets[0].artists[0];
      assert.match(element.id, /^art-/);
      assert.notEqual(element.id, 'art-does-not-exist');
      const { rows } = await client.query('SELECT name, name_key, label FROM artists WHERE id = $1', [element.id]);
      assert.deepEqual(rows[0], { name: 'Brand New Act', name_key: artistNameKey('Brand New Act'), label: '' });
    });
  });

  test('a tombstone id follows merged_into to the survivor', async () => {
    const loser = await createArtist(app, { name: 'Tomb Loser' });
    const survivor = await createArtist(app, { name: 'Tomb Survivor' });
    await withPool((pool) => pool.query('UPDATE artists SET merged_into = $2 WHERE id = $1', [loser.id, survivor.id]));
    await inRolledBackTx(async (client) => {
      const out = await run(client, daysOf([{ id: loser.id, name: 'Tomb Loser', links: {} }]));
      assert.equal(out.days![0].sets[0].artists[0].id, survivor.id);
      assert.equal(out.days![0].sets[0].artists[0].name, 'Tomb Survivor');
    });
  });

  test('no id and one artist with the key: link to it. A Spotify link beats the key.', async () => {
    const one = await createArtist(app, { name: 'Single Key' });
    const bySpotify = await createArtist(app, { name: 'Linked By Spotify', link: 'https://open.spotify.com/artist/7dGJo4pcD2V6oG8kP0tJRR' });
    await inRolledBackTx(async (client) => {
      const out = await run(client, daysOf([{ name: 'SINGLE KEY!', links: {} }, { name: 'Another Spelling', links: { spotify: 'https://open.spotify.com/artist/7dGJo4pcD2V6oG8kP0tJRR' } }]));
      const [a, b] = out.days![0].sets[0].artists;
      assert.equal(a.id, one.id);
      assert.equal(b.id, bySpotify.id);
    });
  });

  test('no id and two artists with the key: saved without an id, never a failure', async () => {
    await createArtist(app, { name: 'Dupe Name' });
    await createArtist(app, { name: 'Dupe Name', label: 'UK' });
    await inRolledBackTx(async (client) => {
      const out = await run(client, daysOf([{ name: 'Dupe Name', links: {} }]));
      const element = out.days![0].sets[0].artists[0];
      assert.equal(element.id, undefined);
      assert.equal(element.name, 'Dupe Name');
      assert.deepEqual(out.ambiguous, ['Dupe Name']);
    });
  });

  test('an unknown id with two artists on the key is stripped and counted as ambiguous', async () => {
    await createArtist(app, { name: 'Dangle Name' });
    await createArtist(app, { name: 'Dangle Name', label: 'UK' });
    await inRolledBackTx(async (client) => {
      const out = await run(client, daysOf([{ id: 'art-does-not-exist', name: 'Dangle Name', links: {} }]));
      const element = out.days![0].sets[0].artists[0];
      assert.equal('id' in element, false);
      assert.deepEqual(out.ambiguous, ['Dangle Name']);
    });
  });

  test('a client that strips ids re-links from the stored set, even when two artists share the name', async () => {
    const plain = await createArtist(app, { name: 'Stored Twin' });
    await createArtist(app, { name: 'Stored Twin', label: 'US' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-refs-stored', sets: [{ id: 'refs-stored-1', artist: 'Stored Twin', artists: [{ id: plain.id, name: 'Stored Twin', links: {} }] }] }),
    );
    await inRolledBackTx(async (client) => {
      const out = await resolveArtistRefs(client, {
        festivalId: 'fest-refs-stored',
        days: [{ sets: [{ id: 'refs-stored-1', artist: 'Stored Twin', artists: [{ name: 'Stored Twin', links: {} }] }] }],
        separator: 'b2b',
        userId: null,
      });
      assert.equal(out.days![0].sets[0].artists[0].id, plain.id);
      assert.deepEqual(out.ambiguous, []);
    });
  });

  test('new artists take cleaned links; a bad link is dropped and counted; a link under the wrong key is refiled', async () => {
    await inRolledBackTx(async (client) => {
      const out = await run(client, daysOf([
        { name: 'Links One', links: { spotify: 'https://soundcloud.com/linksone?si=1' } },
        { name: 'Links Two', links: { instagram: 'https://instagram.com/p/abc' } },
      ]));
      const [one, two] = out.days![0].sets[0].artists;
      assert.deepEqual(one.links, { soundcloud: 'https://soundcloud.com/linksone' });
      assert.deepEqual(two.links, {});
      assert.equal(out.droppedLinks, 1);
    });
  });

  test('fillEmptyLinks returns a link for an empty platform and counts a differing one', async () => {
    const artist = await createArtist(app, { name: 'Fill Me', link: 'https://soundcloud.com/fillme' });
    await inRolledBackTx(async (client) => {
      const out = await run(
        client,
        daysOf(
          [{ id: artist.id, name: 'Fill Me', links: { instagram: 'https://www.instagram.com/fillme' } }],
          [{ id: artist.id, name: 'Fill Me', links: { soundcloud: 'https://soundcloud.com/different' } }],
        ),
        { fillEmptyLinks: true },
      );
      assert.deepEqual(out.linkFills, [{ artistId: artist.id, platform: 'instagram', url: 'https://www.instagram.com/fillme' }]);
      assert.equal(out.ignoredLinkEdits, 1);
    });
  });

  test('two names that new artists share in one save become one artist', async () => {
    await inRolledBackTx(async (client) => {
      const out = await run(client, daysOf([{ name: 'Twice Named', links: {} }], [{ name: 'twice named!', links: {} }]));
      const [a, b] = out.days!.flatMap((d: any) => d.sets.map((s: any) => s.artists[0]));
      assert.equal(a.id, b.id);
    });
  });

  test('a trailing set tag is stripped from the artist, and the set and entry keep the poster text', async () => {
    await inRolledBackTx(async (client) => {
      const days = daysOf([{ name: 'Orrin Vale (DJ Set)', links: {} }], [{ name: 'Orrin Vale', links: {} }], [{ name: 'Sela Dune (UK)', links: {} }]);
      days[0]!.sets.push({ id: 'set-billed', artist: 'Orrin Vale (Live)', artists: [{ name: 'Orrin Vale (Live)', links: {} }], displayName: 'Night Shift' } as any);
      const lineup = [{ artists: [{ name: 'Orrin Vale (Closing Set)', links: {} }], displayName: null }];
      const out = await run(client, days, { lineup });
      const [tagged, plain, uk, billed] = out.days![0].sets;
      assert.equal(tagged.artists[0].name, 'Orrin Vale');
      assert.equal(tagged.artists[0].id, plain.artists[0].id, 'one artist for the tagged and untagged names');
      assert.equal(tagged.displayName, 'Orrin Vale (DJ Set)');
      assert.equal(tagged.artist, 'Orrin Vale');
      assert.equal(plain.displayName, undefined);
      assert.equal(uk.artists[0].name, 'Sela Dune (UK)', 'other parentheses stay');
      assert.equal(uk.displayName, undefined);
      assert.equal(billed.displayName, 'Night Shift', 'an existing display name is kept');
      assert.equal(billed.artists[0].id, plain.artists[0].id);
      assert.equal(out.lineup![0].artists[0].id, plain.artists[0].id);
      assert.equal(out.lineup![0].displayName, 'Orrin Vale (Closing Set)');
      const { rows } = await client.query(`SELECT name FROM artists WHERE name_key LIKE 'orrin vale%'`);
      assert.deepEqual(rows.map((r: any) => r.name), ['Orrin Vale']);
    });
  });
});

describe('festival save keeps and resolves artist ids', { skip, concurrency: 1 }, () => {
  test('flat-only payloads keep the stored ids; a retyped name gets a new artist', async () => {
    const stored = await createArtist(app, { name: 'Keep My Id' });
    await withPool((pool) =>
      seedFestival(pool, { id: 'fest-refs-save', sets: [{ id: 'refs-save-1', artist: 'Keep My Id', artists: [{ id: stored.id, name: 'Keep My Id', links: {} }] }] }),
    );
    await dropFestivalCache(app);
    const festival = { id: 'fest-refs-save' };
    const set = { id: 'refs-save-1', stageId: 'fest-refs-save-main', startTime: '20:00', endTime: '23:00' };

    // An old mobile build sends only the flat name.
    await app.put('/api/v1/admin/festivals/fest-refs-save', formBody(festival, [{ ...set, artist: 'Keep My Id' }])).expect(200);
    await withPool(async (pool) => assert.equal((await setRow(pool, 'refs-save-1')).artists[0].id, stored.id));

    // The editor retypes the name: the id goes with it.
    const typed = await app.put('/api/v1/admin/festivals/fest-refs-save', formBody(festival, [{ ...set, artist: 'Typed Anew' }])).expect(200);
    assert.equal(typed.body.data.artistRefs.droppedLinks, 0);
    await withPool(async (pool) => {
      const row = await setRow(pool, 'refs-save-1');
      assert.equal(row.artists[0].name, 'Typed Anew');
      assert.notEqual(row.artists[0].id, stored.id);
    });
  });

  test('a save with a name that fits two artists succeeds, and the checklist asks for a pick', async () => {
    await createArtist(app, { name: 'Pick Me' });
    await createArtist(app, { name: 'Pick Me', label: 'DE' });
    await withPool((pool) => seedFestival(pool, { id: 'fest-refs-pick', sets: [] }));
    await dropFestivalCache(app);
    const save = await app.put('/api/v1/admin/festivals/fest-refs-pick', formBody({ id: 'fest-refs-pick' }, [
      { id: 'refs-pick-1', artist: 'Pick Me', stageId: 'fest-refs-pick-main', startTime: '20:00', endTime: '23:00' },
    ])).expect(200);
    assert.deepEqual(save.body.data.artistRefs.ambiguous, ['Pick Me']);
    await withPool(async (pool) => assert.equal((await setRow(pool, 'refs-pick-1')).artists[0].id, undefined));
    const loaded = await app.get('/api/v1/admin/festivals/fest-refs-pick').expect(200);
    const item = loaded.body.data.checklist.find((i: any) => i.key === 'artists');
    assert.equal(item.status, 'warn');
    assert.equal(item.label, '1 name matches more than one artist. Pick one.');
  });

  test('a save strips a set tag from the artist and stores the poster text as the display name', async () => {
    await withPool((pool) => seedFestival(pool, { id: 'fest-refs-tag', sets: [] }));
    await dropFestivalCache(app);
    await app.put('/api/v1/admin/festivals/fest-refs-tag', formBody({ id: 'fest-refs-tag' }, [
      { id: 'refs-tag-1', artist: 'Brisa Kell (Sunset Set)', stageId: 'fest-refs-tag-main', startTime: '20:00', endTime: '23:00' },
    ])).expect(200);
    await withPool(async (pool) => {
      const row = await setRow(pool, 'refs-tag-1');
      assert.equal(row.artists[0].name, 'Brisa Kell');
      assert.equal(row.display_name, 'Brisa Kell (Sunset Set)');
      const { rows } = await pool.query(`SELECT name FROM artists WHERE name_key LIKE 'brisa kell%'`);
      assert.deepEqual(rows.map((r: any) => r.name), ['Brisa Kell']);
    });
  });

  test('announced-lineup elements get ids too', async () => {
    await withPool((pool) => seedFestival(pool, { id: 'fest-refs-lineup', sets: [] }));
    await dropFestivalCache(app);
    const form = await app.get('/api/v1/admin/festivals/fest-refs-lineup').expect(200);
    await app.put('/api/v1/admin/festivals/fest-refs-lineup', {
      name: 'fest-refs-lineup',
      stages: [{ id: 'fest-refs-lineup-main', name: 'Main', color: '#ff3366' }],
      lineup: [{ artists: [{ name: 'Lineup Only', links: {} }], displayName: null }],
      expectedUpdatedAt: form.body.data.updatedAt,
    }).expect(200);
    const after1 = await app.get('/api/v1/admin/festivals/fest-refs-lineup').expect(200);
    assert.match(after1.body.data.lineup[0].artists[0].id, /^art-/);
  });
});

describe('import commit and undo', { skip, concurrency: 1 }, () => {
  const importRows = (artist: string, extra: Record<string, unknown> = {}) => [
    { row: 2, artist, stage: 'Main', day: 'Friday', date: '2099-08-21', startTime: '21:00', endTime: '22:00', ...extra },
  ];

  test('an imported set gets artist ids, a link fills an empty platform, a differing link is listed', async () => {
    const existing = await createArtist(app, { name: 'Import Known', link: 'https://soundcloud.com/importknown' });
    await withPool((pool) => seedFestival(pool, { id: 'fest-refs-import', sets: [] }));
    await dropFestivalCache(app);
    const res = await app.post('/api/v1/admin/festivals/fest-refs-import/import-lineup', {
      rows: [
        ...importRows('Import Known', { link: 'https://www.instagram.com/importknown' }),
        { row: 3, artist: 'Import Known', stage: 'Side', day: 'Friday', date: '2099-08-21', startTime: '22:00', endTime: '23:00', link: 'https://soundcloud.com/different' },
        { row: 4, artist: 'Import Fresh', stage: 'Main', day: 'Friday', date: '2099-08-21', startTime: '23:00', endTime: '23:30' },
      ],
      skipSpotify: true,
    }).expect(200);
    assert.equal(res.body.data.committed, true, JSON.stringify(res.body.data.plan?.problems) + JSON.stringify(res.body.data.plan?.rows?.map((r: any) => [r.status, r.errors])));
    const warnings: string[] = res.body.data.result.warnings;
    assert.ok(warnings.some((w) => /1 link differs from the artist's links and was not used\. Change them on the Artists tab\./.test(w)), warnings.join('|'));
    assert.ok(warnings.some((w) => /Add links on the Artists tab/.test(w)));
    await withPool(async (pool) => {
      const { rows } = await pool.query(`SELECT artist, artists FROM festival_sets WHERE festival_id = 'fest-refs-import' ORDER BY artist, start_time`);
      assert.ok(rows.every((r: any) => /^art-/.test(r.artists[0].id)));
      const known = rows.filter((r: any) => r.artists[0].id === existing.id);
      assert.equal(known.length, 2);
      const { rows: artistRow } = await pool.query('SELECT links FROM artists WHERE id = $1', [existing.id]);
      assert.deepEqual(artistRow[0].links, { soundcloud: 'https://soundcloud.com/importknown', instagram: 'https://www.instagram.com/importknown' });
    });
  });

  test('an import strips a set tag and keeps the poster text; undo removes a created set and restores an updated one', async () => {
    await withPool((pool) =>
      seedFestival(pool, {
        id: 'fest-refs-imptag',
        sets: [{ id: 'refs-imptag-1', artist: 'Kestrel Moon (Sunset Set)', artists: [{ name: 'Kestrel Moon (Sunset Set)', links: {} }], start: '20:00' }],
      }),
    );
    await dropFestivalCache(app);
    const commit = await app.post('/api/v1/admin/festivals/fest-refs-imptag/import-lineup', {
      rows: [
        { row: 2, artist: 'Kestrel Moon (Sunset Set)', stage: 'Main', day: 'Friday', date: '2099-08-21', startTime: '21:00', endTime: '22:00' },
        { row: 3, artist: 'Sorrel Bay (Sunset Set)', stage: 'Main', day: 'Friday', date: '2099-08-21', startTime: '22:00', endTime: '23:00' },
      ],
      updateExisting: true,
      skipSpotify: true,
    }).expect(200);
    assert.equal(commit.body.data.committed, true, JSON.stringify(commit.body.data.plan?.problems));
    await withPool(async (pool) => {
      const { rows } = await pool.query(
        `SELECT id, artist, artists, display_name, start_time FROM festival_sets WHERE festival_id = 'fest-refs-imptag' ORDER BY start_time`,
      );
      assert.deepEqual(
        rows.map((r: any) => [r.artists[0].name, r.artist, r.display_name, r.start_time]),
        [
          ['Kestrel Moon', 'Kestrel Moon', 'Kestrel Moon (Sunset Set)', '21:00'],
          ['Sorrel Bay', 'Sorrel Bay', 'Sorrel Bay (Sunset Set)', '22:00'],
        ],
      );
      const { rows: artists } = await pool.query(`SELECT name FROM artists WHERE name_key LIKE 'kestrel moon%' OR name_key LIKE 'sorrel bay%' ORDER BY name`);
      assert.deepEqual(artists.map((r: any) => r.name), ['Kestrel Moon', 'Sorrel Bay']);
    });
    await app.post(`/api/v1/admin/festivals/fest-refs-imptag/imports/${commit.body.data.result.importId}/undo`).expect(200);
    await withPool(async (pool) => {
      const { rows } = await pool.query(`SELECT id, artist, artists, display_name, start_time FROM festival_sets WHERE festival_id = 'fest-refs-imptag'`);
      assert.deepEqual(rows.map((r: any) => r.id), ['refs-imptag-1'], 'the created set is gone');
      assert.equal(rows[0].start_time, '20:00');
      assert.equal(shownSetName({ displayName: rows[0].display_name, artist: rows[0].artist, artists: rows[0].artists }), 'Kestrel Moon (Sunset Set)');
      assert.equal(rows[0].display_name, 'Kestrel Moon (Sunset Set)');
      assert.equal(rows[0].artists[0].name, 'Kestrel Moon');
    });
  });

  test('undo restores canonical copies, and an import older than a backfill run cannot be undone', async () => {
    const artist = await createArtist(app, { name: 'Undo Act' });
    const element = { id: artist.id, name: 'Undo Act', links: {} };
    await withPool((pool) =>
      seedFestival(pool, {
        id: 'fest-refs-undo',
        sets: [{ id: 'refs-undo-1', artist: 'Undo Act', artists: [element], start: '20:00' }],
      }),
    );
    await dropFestivalCache(app);
    const commit = await app.post('/api/v1/admin/festivals/fest-refs-undo/import-lineup', {
      rows: [{ row: 2, artist: 'Undo Act', stage: 'Main', day: 'Friday', date: '2099-08-21', startTime: '21:00', endTime: '22:00' }],
      updateExisting: true,
      createMissing: false,
      skipSpotify: true,
    }).expect(200);
    const importId = commit.body.data.result.importId;
    // The artist is renamed after the import: the undo must not bring the old name back.
    await app.patch(`/api/v1/admin/artists/${artist.id}`, { expectedUpdatedAt: artist.updatedAt, changes: { name: 'Undo Act Renamed' } }).expect(200);
    await app.post(`/api/v1/admin/festivals/fest-refs-undo/imports/${importId}/undo`).expect(200);
    await withPool(async (pool) => {
      const row = await setRow(pool, 'refs-undo-1');
      assert.equal(row.artists[0].name, 'Undo Act Renamed');
      assert.equal(row.artist, 'Undo Act Renamed');
      assert.equal((await pool.query(`SELECT start_time FROM festival_sets WHERE id = 'refs-undo-1'`)).rows[0].start_time, '20:00');
    });

    // A second import, then a backfill run for the festival, then the undo is refused.
    await dropFestivalCache(app);
    const second = await app.post('/api/v1/admin/festivals/fest-refs-undo/import-lineup', {
      rows: [{ row: 2, artist: 'Undo Act Renamed', stage: 'Main', day: 'Friday', date: '2099-08-21', startTime: '21:30', endTime: '22:00' }],
      updateExisting: true,
      createMissing: false,
      skipSpotify: true,
    }).expect(200);
    await withPool((pool) =>
      pool.query(`INSERT INTO artist_backfill_runs (run_id, festival_id, before, created_at) VALUES ('run-test', 'fest-refs-undo', '{}'::jsonb, now() + interval '1 second')`),
    );
    const refused = await app.post(`/api/v1/admin/festivals/fest-refs-undo/imports/${second.body.data.result.importId}/undo`).expect(400);
    assert.equal(refused.body.error.message, 'This import is older than the artist upgrade. Edit the sets by hand instead.');
  });
});

describe('artist id GIN indexes', { skip }, () => {
  test('migration 118 indexes festival_sets.artists and festivals.lineup', async () => {
    await withPool(async (pool: Pool) => {
      const { rows } = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_festival_sets_artists_gin', 'idx_festivals_lineup_gin') ORDER BY indexname`,
      );
      assert.deepEqual(rows.map((r: { indexname: string }) => r.indexname), ['idx_festival_sets_artists_gin', 'idx_festivals_lineup_gin']);
    });
  });
});
