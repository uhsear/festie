import 'dotenv/config';
/**
 * The admin artist routes: match, create, list, impact and the per-row PATCH with its token.
 * Needs TEST_DATABASE_URL (a database whose name contains _test).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createArtist, seedFestival, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';

const SPOTIFY_A = 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb';
const SPOTIFY_B = 'https://open.spotify.com/artist/1Xyo4u8uXC1ZmMpatF05PJ';

let app: ArtistServer;
before(async () => {
  if (!skip) app = await startArtistServer();
});
after(async () => {
  if (app) await app.close();
});

describe('artist routes', { skip, concurrency: 1 }, () => {
  test('refuse a caller without an admin session', async () => {
    await app.server.request.get('/api/v1/admin/artists').expect(401);
    await app.server.request.post('/api/v1/admin/artists/match').send({ items: [{ name: 'X' }] }).expect(401);
  });

  test('create: detects the platform from the link and returns an updatedAt token', async () => {
    const artist = await createArtist(app, { name: 'Create Me', link: 'https://soundcloud.com/createme?utm_source=x' });
    assert.equal(artist.name, 'Create Me');
    assert.equal(artist.label, '');
    assert.deepEqual(artist.links, { soundcloud: 'https://soundcloud.com/createme' });
    assert.match(artist.updatedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  });

  test('create: a bad link is a 400 with the platform message', async () => {
    const res = await app.post('/api/v1/admin/artists', { name: 'Bad Link', link: 'https://open.spotify.com/track/4Z8W4fKeB5YxbusRsdQVPb' }).expect(400);
    assert.match(res.body.error.message, /Spotify track link/);
  });

  test('create: a second live artist with the same key needs a note, and the note must differ', async () => {
    await createArtist(app, { name: 'HOL' });
    const noNote = await app.post('/api/v1/admin/artists', { name: 'HOL!' }).expect(400);
    assert.match(noNote.body.error.message, /There is already an artist named HOL\. Add a note to tell them apart/);
    const uk = await createArtist(app, { name: 'HOL', label: '  UK ' });
    assert.equal(uk.label, 'UK');
    const clash = await app.post('/api/v1/admin/artists', { name: 'hol', label: 'uk' }).expect(409);
    assert.equal(clash.body.error.code, 'ARTIST_EXISTS');
    assert.match(clash.body.error.message, /HOL \(UK\) already exists\. Pick that artist, or use a different note\./);
    assert.doesNotMatch(clash.body.error.message, /festival/i);
  });

  test('create: a Spotify id that another artist holds is a 409 that names that artist', async () => {
    await createArtist(app, { name: 'Avello', label: 'NL', link: SPOTIFY_A });
    const res = await app.post('/api/v1/admin/artists', { name: 'Avello Two', link: SPOTIFY_A }).expect(409);
    assert.equal(res.body.error.code, 'ARTIST_EXISTS');
    assert.match(res.body.error.message, /already linked to 'Avello \(NL\)'/);
    assert.doesNotMatch(res.body.error.message, /festival/i);
  });

  test('patch: adds and removes links, cleans them and moves the token', async () => {
    const artist = await createArtist(app, { name: 'Patch Me' });
    const added = await app.patch(`/api/v1/admin/artists/${artist.id}`, {
      expectedUpdatedAt: artist.updatedAt,
      changes: { addLink: 'https://www.instagram.com/patchme/?igshid=abc' },
    }).expect(200);
    assert.deepEqual(added.body.data.artist.links, { instagram: 'https://www.instagram.com/patchme' });
    assert.notEqual(added.body.data.artist.updatedAt, artist.updatedAt);

    const removed = await app.patch(`/api/v1/admin/artists/${artist.id}`, {
      expectedUpdatedAt: added.body.data.artist.updatedAt,
      changes: { removeLinks: ['instagram'], addLink: 'https://music.apple.com/us/artist/patch-me/123456' },
    }).expect(200);
    assert.deepEqual(removed.body.data.artist.links, { apple_music: 'https://music.apple.com/us/artist/patch-me/123456' });
  });

  test('patch: a stale token is a 409 ARTIST_CHANGED that carries the current version', async () => {
    const artist = await createArtist(app, { name: 'Stale Token' });
    await app.patch(`/api/v1/admin/artists/${artist.id}`, { expectedUpdatedAt: artist.updatedAt, changes: { label: 'one' } }).expect(200);
    const stale = await app.patch(`/api/v1/admin/artists/${artist.id}`, { expectedUpdatedAt: artist.updatedAt, changes: { label: 'two' } }).expect(409);
    assert.equal(stale.body.error.code, 'ARTIST_CHANGED');
    assert.equal(stale.body.error.artist.label, 'one');
  });

  test('patch: a bad link, a long note and a missing artist are refused with a message', async () => {
    const artist = await createArtist(app, { name: 'Refuse Me' });
    const base = { expectedUpdatedAt: artist.updatedAt };
    const track = await app.patch(`/api/v1/admin/artists/${artist.id}`, { ...base, changes: { addLink: 'https://instagram.com/p/abc' } }).expect(400);
    assert.match(track.body.error.message, /post/i);
    const longNote = await app.patch(`/api/v1/admin/artists/${artist.id}`, { ...base, changes: { label: 'x'.repeat(41) } }).expect(400);
    assert.match(longNote.body.error.message, /at most 40/);
    await app.patch('/api/v1/admin/artists/art-missing', { ...base, changes: { label: 'x' } }).expect(404);
  });

  test('patch: a rename or note that takes another artist\'s key and note is a 409', async () => {
    await createArtist(app, { name: 'Twin' });
    const other = await createArtist(app, { name: 'Twin', label: 'US' });
    const rename = await app.patch(`/api/v1/admin/artists/${other.id}`, { expectedUpdatedAt: other.updatedAt, changes: { label: '' } }).expect(409);
    assert.equal(rename.body.error.code, 'ARTIST_EXISTS');
    assert.match(rename.body.error.message, /Twin already exists/);
    assert.doesNotMatch(rename.body.error.message, /festival/i);
  });

  test('patch: a link whose Spotify id another artist holds is a 409 that says who has it', async () => {
    await createArtist(app, { name: 'Holder', link: SPOTIFY_B });
    const taker = await createArtist(app, { name: 'Taker' });
    const res = await app.patch(`/api/v1/admin/artists/${taker.id}`, { expectedUpdatedAt: taker.updatedAt, changes: { addLink: SPOTIFY_B } }).expect(409);
    assert.match(res.body.error.message, /already linked to 'Holder'\. Use that artist instead|already linked to 'Holder'\. Use that artist, or ask an admin to merge them\./);
  });

  test('match: one artist is "linked", two are "pick", none is "new", and a Spotify link wins', async () => {
    const solo = await createArtist(app, { name: 'Solo Match' });
    await createArtist(app, { name: 'Pair Match' });
    await createArtist(app, { name: 'Pair Match', label: 'UK' });
    const withSpotify = await createArtist(app, { name: 'Spot Match', link: 'https://open.spotify.com/artist/0du5cEVh5yTK9QJze8zA0C' });
    const res = await app.post('/api/v1/admin/artists/match', {
      items: [
        { name: 'solo match!' },
        { name: 'Pair Match' },
        { name: 'Nobody Here' },
        { name: 'Different Spelling', spotify: 'https://open.spotify.com/artist/0du5cEVh5yTK9QJze8zA0C' },
      ],
    }).expect(200);
    const [linked, pick, fresh, bySpotify] = res.body.data.results;
    assert.equal(linked.outcome, 'linked');
    assert.equal(linked.candidates[0].id, solo.id);
    assert.equal(pick.outcome, 'pick');
    assert.deepEqual(pick.candidates.map((c: any) => c.label).sort(), ['', 'UK']);
    assert.equal(fresh.outcome, 'new');
    assert.equal(bySpotify.outcome, 'linked');
    assert.equal(bySpotify.candidates[0].id, withSpotify.id);
  });

  test('match: more than 500 names is a 400', async () => {
    const items = Array.from({ length: 501 }, (_, i) => ({ name: `n${i}` }));
    await app.post('/api/v1/admin/artists/match', { items }).expect(400);
  });

  test('impact and list: show the festivals that list an artist, archived ones marked', async () => {
    const artist = await createArtist(app, { name: 'Impact Act' });
    const element = { id: artist.id, name: artist.name, links: {} };
    await withPool(async (pool) => {
      await seedFestival(pool, { id: 'fest-impact-a', published: true, sets: [{ id: 'imp-a', artist: 'Impact Act', artists: [element] }] });
      await seedFestival(pool, { id: 'fest-impact-b', deleted: true, sets: [{ id: 'imp-b', artist: 'Impact Act', artists: [element] }] });
      await seedFestival(pool, { id: 'fest-impact-c', lineup: [{ artists: [element], displayName: null }], sets: [] });
      await seedFestival(pool, { id: 'fest-impact-d', date: '2020-01-01', lineup: [{ artists: [element], displayName: null }], sets: [] });
    });
    const impact = await app.get(`/api/v1/admin/artists/${artist.id}/impact`).expect(200);
    const byId = new Map(impact.body.data.festivals.map((f: any) => [f.id, f]));
    assert.equal(byId.size, 4);
    assert.deepEqual(impact.body.data.counts, { past: 1, current: 0, upcoming: 2, archived: 1, sets: 2, lineupEntries: 2 });
    assert.equal((byId.get('fest-impact-a') as any).published, true);
    assert.equal((byId.get('fest-impact-b') as any).archived, true);
    assert.equal((byId.get('fest-impact-c') as any).archived, false);

    const list = await app.get('/api/v1/admin/artists?festivalId=fest-impact-a').expect(200);
    assert.deepEqual(list.body.data.artists.map((a: any) => a.id), [artist.id]);
    assert.equal(list.body.data.artists[0].alsoOn, 2);
    const all = await app.get('/api/v1/admin/artists?q=impact').expect(200);
    assert.ok(all.body.data.artists.some((a: any) => a.id === artist.id));
  });
});
