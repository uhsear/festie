import 'dotenv/config';
/**
 * Merge two artists: the route is admin only and needs a recent re-auth; a merge moves every set and
 * lineup ref (archived festivals too), rewrites every copy, records the refs on the tombstone,
 * counts the festivals again under the locks, refuses a Spotify clash, and writes one audit row.
 * Needs TEST_DATABASE_URL (a database whose name contains _test).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { resolveArtistRefs } from '../lib/artist-refs';
import { ArtistError, createArtistsStore } from '../lib/db/stores/artists';
import { lockFestivalAny } from '../lib/db/stores/lineup-imports';
import { TEST_DATABASE_URL } from './_integration-helpers';
import { artistNameKey } from '../lib/artist-key';
import { createOpaqueId } from '../lib/helpers';
import { festivalRow, seedFestival, setRow, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';

const ADMIN_PASSWORD = 'test-admin-password';
const spotifyUrl = (n: number) => `https://open.spotify.com/artist/Merge${String(n).padStart(17, '0')}`;
const spotifyId = (n: number) => `Merge${String(n).padStart(17, '0')}`;

let app: ArtistServer;
let pool: Pool;
before(async () => {
  if (skip) return;
  app = await startArtistServer();
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
});
after(async () => {
  if (pool) await pool.end();
  if (app) await app.close();
});


interface SeedArtist {
  label?: string;
  links?: Record<string, string>;
  spotifyId?: string | null;
  photo?: string | null;
  genres?: string[];
}
/** Inserts an artist row directly: the create route is rate limited and these tests make many artists. */
async function createArtist(_app: ArtistServer, input: { name: string } & SeedArtist) {
  const id = createOpaqueId('art');
  const label = input.label ?? '';
  const links = input.links ?? {};
  const { rows } = await pool.query(
    `INSERT INTO artists (id, name, name_key, label, spotify_id, links, photo, genres)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb) RETURNING updated_at`,
    [id, input.name, artistNameKey(input.name), label, input.spotifyId ?? null, JSON.stringify(links), input.photo ?? null, JSON.stringify(input.genres ?? [])],
  );
  return { id, name: input.name, label, links, updatedAt: (rows[0].updated_at as Date).toISOString() };
}
/** The artist as the editor would reload it. */
async function reload(artist: { id: string }) {
  const { rows } = await pool.query('SELECT id, name, label, links, updated_at FROM artists WHERE id = $1', [artist.id]);
  return { id: rows[0].id, name: rows[0].name, label: rows[0].label, links: rows[0].links, updatedAt: (rows[0].updated_at as Date).toISOString() };
}

const element = (artist: any) => ({ id: artist.id, name: artist.name, links: artist.links ?? {} });
const mergePath = (survivor: any) => `/api/v1/admin/artists/${survivor.id}/merge`;
const mergeBody = (survivor: any, loser: any, extra: Record<string, unknown> = {}) => ({
  loserId: loser.id,
  survivorUpdatedAt: survivor.updatedAt,
  loserUpdatedAt: loser.updatedAt,
  acceptedFestivals: 99,
  ...extra,
});
const merge = (survivor: any, loser: any, extra: Record<string, unknown> = {}) => app.post(mergePath(survivor), mergeBody(survivor, loser, extra));
// The route allows 10 merges a minute, so only the route cases call it. The rest call the store.
const mergeStore = (survivor: any, loser: any, extra: Record<string, unknown> = {}) =>
  createArtistsStore(pool).merge({
    survivorId: survivor.id,
    loserId: loser.id,
    survivorUpdatedAt: survivor.updatedAt,
    loserUpdatedAt: loser.updatedAt,
    pick: {},
    acceptedFestivals: 99,
    userId: null,
    ...extra,
  });
const refused = (promise: Promise<unknown>, status: number, message: RegExp, code?: string) =>
  assert.rejects(promise, (error: any) => error instanceof ArtistError && error.status === status && message.test(error.message) && (!code || error.code === code));
const artistRow = async (id: string) =>
  (await pool.query('SELECT name, label, spotify_id, links, photo, genres, merged_into, merge_refs, updated_by, created_by FROM artists WHERE id = $1', [id])).rows[0];
let reauthed = false;
// One re-auth per run: the window is 15 minutes and the reauth route is rate limited.
const reauth = async () => {
  if (reauthed) return;
  await app.post('/api/v1/auth/reauth', { password: ADMIN_PASSWORD }).expect(200);
  reauthed = true;
};

describe('artist merge route', { skip, concurrency: 1 }, () => {
  test('refuses a caller without a session, and an admin without a recent re-auth', async () => {
    const survivor = await createArtist(app, { name: 'Gate Survivor' });
    const loser = await createArtist(app, { name: 'Gate Loser' });
    await app.server.request.post(mergePath(survivor)).send(mergeBody(survivor, loser)).expect(401);
    const refused = await merge(survivor, loser).expect(403);
    assert.equal(refused.body.error.code, 'REAUTH_REQUIRED');
    assert.equal((await artistRow(loser.id)).merged_into, null);
    await reauth();
    await merge(survivor, loser).expect(200);
  });

  test('moves set and lineup refs, rewrites every copy, keeps archived festivals, and records the refs on the tombstone', async () => {
    await reauth();
    const survivor = await createArtist(app, { name: 'Move Survivor', links: { instagram: 'https://www.instagram.com/movesurvivor' } });
    const loser = await createArtist(app, { name: 'Move Loser', links: { spotify: spotifyUrl(1) }, spotifyId: spotifyId(1), photo: 'https://i.scdn.co/image/move', genres: ['house'] });
    const other = await createArtist(app, { name: 'Move Other' });
    const older = await createArtist(app, { name: 'Move Older Tombstone' });
    await merge(loser, older).expect(200);
    const loserNow = await reload(loser);

    await withPool(async (p) => {
      await seedFestival(p, { id: 'mg-move-1', published: true, sets: [{ id: 'mg-move-1-s', artist: 'Move Loser', artists: [element(loserNow)] }] });
      await seedFestival(p, {
        id: 'mg-move-2',
        deleted: true,
        sets: [{ id: 'mg-move-2-s', artist: 'Move Other b2b Move Loser', artists: [element(other), element(loserNow)] }],
      });
      await seedFestival(p, { id: 'mg-move-3', sets: [], lineup: [{ artists: [element(loserNow)], displayName: null }] });
      await seedFestival(p, { id: 'mg-move-4', sets: [{ id: 'mg-move-4-s', artist: 'Move Survivor', artists: [element(survivor)] }] });
    });
    const before4 = await withPool((p) => festivalRow(p, 'mg-move-4'));

    const res = await merge(survivor, loserNow, { acceptedFestivals: 4 }).expect(200);
    assert.deepEqual(res.body.data.counts, { festivals: 4, sets: 2, lineupEntries: 1 });
    assert.equal(res.body.data.loserId, loser.id);

    await withPool(async (p) => {
      const one = await setRow(p, 'mg-move-1-s');
      assert.equal(one.artists[0].id, survivor.id);
      assert.equal(one.artists[0].name, 'Move Survivor');
      assert.equal(one.artist, 'Move Survivor');
      assert.equal(one.artists[0].links.spotify, spotifyUrl(1), 'the survivor took the loser link it lacked');
      assert.equal(one.link_url, spotifyUrl(1));
      assert.equal(one.artists[0].photo, 'https://i.scdn.co/image/move');
      const two = await setRow(p, 'mg-move-2-s');
      assert.deepEqual(two.artists.map((a: any) => a.id), [other.id, survivor.id]);
      assert.equal(two.artist, 'Move Other b2b Move Survivor');
      const three = await festivalRow(p, 'mg-move-3');
      assert.equal(three.lineup[0].artists[0].id, survivor.id);
      assert.equal(three.lineup[0].artists[0].name, 'Move Survivor');
      assert.ok(new Date((await festivalRow(p, 'mg-move-4')).updated_at) > new Date(before4.updated_at), 'a festival that lists the survivor refreshes too');
    });

    const tomb = await artistRow(loser.id);
    assert.equal(tomb.merged_into, survivor.id);
    assert.equal(tomb.spotify_id, null, 'the Spotify id moved to the survivor');
    assert.equal(tomb.merge_refs.survivorId, survivor.id);
    assert.deepEqual(tomb.merge_refs.sets, [
      { festivalId: 'mg-move-1', setId: 'mg-move-1-s', index: 0 },
      { festivalId: 'mg-move-2', setId: 'mg-move-2-s', index: 1 },
    ]);
    assert.deepEqual(tomb.merge_refs.lineup, [{ festivalId: 'mg-move-3', entry: 0, index: 0 }]);
    assert.equal(tomb.merge_refs.before.name, 'Move Loser');
    assert.equal(tomb.merge_refs.before.spotifyId, spotifyId(1));
    const live = await artistRow(survivor.id);
    assert.equal(live.spotify_id, spotifyId(1));
    assert.equal(live.merged_into, null);
    assert.equal((await artistRow(older.id)).merged_into, survivor.id, 'an older tombstone follows the loser to the survivor');
  });

  test('writes one audit row with the actor and the ip, in the merge transaction', async () => {
    await reauth();
    const survivor = await createArtist(app, { name: 'Audit Survivor' });
    const loser = await createArtist(app, { name: 'Audit Loser' });
    await withPool((p) => seedFestival(p, { id: 'mg-audit-1', sets: [{ id: 'mg-audit-1-s', artist: 'Audit Loser', artists: [element(loser)] }] }));
    await merge(survivor, loser, { acceptedFestivals: 1 }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { rows } = await pool.query("SELECT actor_id, actor_type, ip, details_json FROM audit_log WHERE target_id = $1 AND action <> 'artist.created'", [survivor.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_type, 'admin');
    assert.equal(rows[0].actor_id, (await artistRow(survivor.id)).updated_by);
    const { rows: roles } = await pool.query("SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.name = 'admin'", [rows[0].actor_id]);
    assert.equal(roles.length, 1, 'the actor is the admin who merged');
    assert.ok(rows[0].ip);
    const details = typeof rows[0].details_json === 'string' ? JSON.parse(rows[0].details_json) : rows[0].details_json;
    assert.equal(details.loserId, loser.id);
    assert.equal(details.festivals, 1);
    assert.equal(details.setsMoved, 1);
    assert.equal(details.survivorBefore.name, 'Audit Survivor');
    assert.equal(details.survivorAfter.name, 'Audit Survivor');
    assert.deepEqual(details.survivorBefore.links, {});
    const action = (await pool.query("SELECT action FROM audit_log WHERE target_id = $1 AND action <> 'artist.created'", [survivor.id])).rows[0].action;
    assert.equal(action, 'artist.merged');
  });

  test('refuses a pair that plays together in one set or lineup entry', async () => {
    await reauth();
    const a = await createArtist(app, { name: 'Together A' });
    const b = await createArtist(app, { name: 'Together B' });
    await withPool(async (p) => {
      await seedFestival(p, { id: 'mg-together-1', sets: [{ id: 'mg-together-1-s', artist: 'Together A b2b Together B', artists: [element(a), element(b)] }] });
    });
    const sets = await merge(a, b).expect(409);
    assert.match(sets.body.error.message, /Both artists play together in 'Together A b2b Together B'/);

    const c = await createArtist(app, { name: 'Lineup C' });
    const d = await createArtist(app, { name: 'Lineup D' });
    await withPool((p) => seedFestival(p, { id: 'mg-together-2', sets: [], lineup: [{ artists: [element(c), element(d)], displayName: null }] }));
    const lineup = await merge(c, d).expect(409);
    assert.match(lineup.body.error.message, /Both artists play together in 'Lineup C b2b Lineup D'/);
    for (const artist of [a, b, c, d]) assert.equal((await artistRow(artist.id)).merged_into, null);
  });

  test('refuses a tombstone on either side, and a stale token', async () => {
    await reauth();
    const survivor = await createArtist(app, { name: 'Tomb Survivor' });
    const loser = await createArtist(app, { name: 'Tomb Loser' });
    const third = await createArtist(app, { name: 'Tomb Third' });
    await mergeStore(survivor, loser);
    await refused(mergeStore(third, loser), 409, /already merged into Tomb Survivor/);
    await refused(mergeStore(loser, third), 409, /already merged into Tomb Survivor/);

    const stale = await createArtist(app, { name: 'Stale One' });
    const other = await createArtist(app, { name: 'Stale Two' });
    await pool.query("UPDATE artists SET links = '{\"instagram\":\"https://www.instagram.com/stale\"}'::jsonb, updated_at = now() + interval '1 second' WHERE id = $1", [other.id]);
    await refused(mergeStore(stale, other), 409, /Someone changed one of these artists/, 'ARTIST_CHANGED');
    assert.equal((await artistRow(other.id)).merged_into, null);
  });

  test('refuses to merge an artist into itself and an unknown artist', async () => {
    await reauth();
    const one = await createArtist(app, { name: 'Self Merge' });
    await refused(mergeStore(one, one), 400, /two different artists/);
    await refused(mergeStore(one, { id: 'art-does-not-exist', updatedAt: one.updatedAt }), 404, /not found/);
  });

  test('counts the festivals again: a merge that moves more festivals than the editor saw is refused', async () => {
    await reauth();
    const survivor = await createArtist(app, { name: 'Consent Survivor' });
    const loser = await createArtist(app, { name: 'Consent Loser' });
    await withPool(async (p) => {
      await seedFestival(p, { id: 'mg-consent-1', sets: [{ id: 'mg-consent-1-s', artist: 'Consent Loser', artists: [element(loser)] }] });
      await seedFestival(p, { id: 'mg-consent-2', sets: [{ id: 'mg-consent-2-s', artist: 'Consent Survivor', artists: [element(survivor)] }] });
    });
    const refused = await merge(survivor, loser, { acceptedFestivals: 1 }).expect(409);
    assert.equal(refused.body.error.code, 'ARTIST_CHANGED');
    assert.equal(refused.body.error.festivals, 2);
    assert.equal((await artistRow(loser.id)).merged_into, null);
    assert.equal((await withPool((p) => setRow(p, 'mg-consent-1-s'))).artists[0].id, loser.id);
    await merge(survivor, loser, { acceptedFestivals: 2 }).expect(200);
  });

  test('a Spotify id that a third artist holds refuses the merge and writes nothing', async () => {
    await reauth();
    const survivor = await createArtist(app, { name: 'Clash Survivor' });
    // A link kept by the backfill with no spotify_id column: the merge would put its id on the survivor.
    const loser = await createArtist(app, { name: 'Clash Loser', links: { spotify: spotifyUrl(7) } });
    const holder = await createArtist(app, { name: 'Clash Holder', links: { spotify: spotifyUrl(7) }, spotifyId: spotifyId(7) });
    await refused(mergeStore(survivor, loser), 409, /Clash Holder/, 'ARTIST_EXISTS');
    assert.equal((await artistRow(loser.id)).merged_into, null);
    assert.equal((await artistRow(survivor.id)).spotify_id, null);
    assert.equal((await artistRow(holder.id)).spotify_id, spotifyId(7));
  });

  test('two different Spotify ids: the picked link and id end up on the survivor', async () => {
    await reauth();
    const survivor = await createArtist(app, { name: 'Two Spotify Survivor', links: { spotify: spotifyUrl(11) }, spotifyId: spotifyId(11) });
    const loser = await createArtist(app, { name: 'Two Spotify Loser', links: { spotify: spotifyUrl(12) }, spotifyId: spotifyId(12) });
    await mergeStore(survivor, loser, { pick: { links: { spotify: 'loser' }, name: 'loser' } });
    const live = await artistRow(survivor.id);
    assert.equal(live.spotify_id, spotifyId(12));
    assert.equal(live.name, 'Two Spotify Loser');
    assert.equal(live.links.spotify, spotifyUrl(12));
    const tomb = await artistRow(loser.id);
    assert.equal(tomb.spotify_id, null);
    assert.equal(tomb.merge_refs.before.links.spotify, spotifyUrl(12));
    assert.equal((await artistRow(survivor.id)).merged_into, null);
  });

  test('two same-name artists with notes merge, and the picked note stays', async () => {
    await reauth();
    const uk = await createArtist(app, { name: 'Twin Act', label: 'UK' });
    const us = await createArtist(app, { name: 'Twin Act', label: 'US' });
    await mergeStore(uk, us, { pick: { label: 'loser' } });
    assert.equal((await artistRow(uk.id)).label, 'US');
  });

  test('"Possible duplicates" lists same-key pairs and keys one character apart, each pair together with its partner ids', async () => {
    // The first pair: the unlinked artist sorts apart from the linked one if links decide the order.
    const a = await createArtist(app, { name: 'Dupe Quartz Harbor', links: { instagram: 'https://www.instagram.com/dupeq' } });
    const b = await createArtist(app, { name: 'Dupe Quartz Harbour' });
    const c = await createArtist(app, { name: 'Dupe Quartz Harbor', label: 'UK' });
    const solo = await createArtist(app, { name: 'Dupe Lonely Planet Unmatched' });
    const res = await app.get('/api/v1/admin/artists?duplicates=true&limit=1000').expect(200);
    const list: any[] = res.body.data.artists;
    const ids = list.map((row) => row.id);
    for (const artist of [a, b, c]) assert.ok(ids.includes(artist.id), artist.name);
    assert.equal(ids.includes(solo.id), false);
    assert.deepEqual(list.find((row) => row.id === b.id).duplicateOf.sort(), [a.id, c.id].sort());
    const at = [a, b, c].map((artist) => ids.indexOf(artist.id)).sort((x, y) => x - y);
    assert.equal(at[2]! - at[0]!, 2, 'the three rows sit next to each other');
  });
});

describe('artist merge races a festival save', { skip, concurrency: 1 }, () => {
  async function seedRace(tag: string) {
    const survivor = await createArtist(app, { name: `Race Survivor ${tag}` });
    const loser = await createArtist(app, { name: `Race Loser ${tag}` });
    await withPool(async (p) => {
      await seedFestival(p, { id: `mg-race-${tag}-known`, sets: [{ id: `mg-race-${tag}-known-s`, artist: loser.name, artists: [element(loser)] }] });
      await seedFestival(p, { id: `mg-race-${tag}-new`, sets: [] });
    });
    // Client A: a festival save in flight. It holds the festival lock and has read the loser.
    const a = await pool.connect();
    await a.query('BEGIN');
    await lockFestivalAny(a, `mg-race-${tag}-new`);
    const resolved = await resolveArtistRefs(a, {
      festivalId: `mg-race-${tag}-new`,
      days: [{ sets: [{ id: `mg-race-${tag}-new-s`, artist: loser.name, artists: [element(loser)] }] }],
      separator: 'b2b',
      userId: null,
    });
    const commitSave = async () => {
      const set = resolved.days![0].sets[0];
      await a.query(
        `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists)
         VALUES ($1, $2, 0, $3, $4, '20:00', '23:00', 0, $5::jsonb)`,
        [`mg-race-${tag}-new-s`, `mg-race-${tag}-new`, set.artist, `mg-race-${tag}-new-main`, JSON.stringify(set.artists)],
      );
      await a.query('COMMIT');
      a.release();
    };
    return { survivor, loser, commitSave };
  }
  const settled = (promise: Promise<unknown>) =>
    Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 600))]);
  const input = (survivor: any, loser: any, accepted: number) => ({
    survivorId: survivor.id,
    loserId: loser.id,
    survivorUpdatedAt: survivor.updatedAt,
    loserUpdatedAt: loser.updatedAt,
    pick: {},
    acceptedFestivals: accepted,
    userId: null,
  });

  test('a festival that saves the loser mid-merge makes the merge start over and move that set too', async () => {
    const { survivor, loser, commitSave } = await seedRace('retry');
    const store = createArtistsStore(pool);
    const merging = store.merge(input(survivor, loser, 2));
    assert.equal(await settled(merging), false, 'the merge waits for the save instead of overtaking it');
    await commitSave();
    const result = await merging;
    assert.deepEqual(result.counts, { festivals: 2, sets: 2, lineupEntries: 0 });
    await withPool(async (p) => {
      for (const id of ['mg-race-retry-known-s', 'mg-race-retry-new-s']) {
        const row = await setRow(p, id);
        assert.equal(row.artists[0].id, survivor.id, id);
        assert.equal(row.artists[0].name, survivor.name, id);
        assert.equal(row.artist, survivor.name, id);
      }
    });
  });

  test('the consent count is checked on the restart: the festival the editor never saw refuses the merge', async () => {
    const { survivor, loser, commitSave } = await seedRace('consent');
    const store = createArtistsStore(pool);
    const merging = store.merge(input(survivor, loser, 1));
    assert.equal(await settled(merging), false);
    await commitSave();
    await assert.rejects(merging, (error: any) => error instanceof ArtistError && error.status === 409 && error.details?.festivals === 2);
    assert.equal((await artistRow(loser.id)).merged_into, null);
    assert.equal((await withPool((p) => setRow(p, 'mg-race-consent-new-s'))).artists[0].id, loser.id);
  });
});
