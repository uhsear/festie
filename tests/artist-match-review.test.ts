import 'dotenv/config';
/**
 * The admin artist review queue: batch import (validated, idempotent), paging, admin-only access, and an approval
 * that applies a link, a rename or a merge through the artist store in one transaction with the item.
 * Needs TEST_DATABASE_URL (a database whose name contains _test).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { artistNameKey } from '../lib/artist-key';
import { createOpaqueId } from '../lib/helpers';
import { createArtistMatchReviewStore } from '../lib/db/stores/artist-match-review';
import { createArtistsStore } from '../lib/db/stores/artists';
import { schemas } from '../lib/schemas';
import { TEST_DATABASE_URL } from './_integration-helpers';
import { as, makeUser } from './_organizer-helpers';
import { seedFestival, skip, startArtistServer, type ArtistServer } from './_artist-helpers';

const ADMIN_PASSWORD = 'test-admin-password';
const REVIEW = '/api/v1/admin/artists/review';
const stamp = Date.now().toString(36);
const spotifyId = (n: number) => `Rev${String(n).padStart(19, '0')}`;
const spotifyUrl = (n: number) => `https://open.spotify.com/artist/${spotifyId(n)}`;

let app: ArtistServer;
let pool: Pool;
let userToken: string;
before(async () => {
  if (skip) return;
  app = await startArtistServer();
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  userToken = (await makeUser(app.server, `revuser${stamp}`)).token;
});
after(async () => {
  if (pool) await pool.end();
  if (app) await app.close();
});

let counter = 0;
async function seedArtist(name: string, extra: { spotifyId?: string; links?: Record<string, string>; label?: string } = {}) {
  const id = createOpaqueId('art');
  await pool.query(
    `INSERT INTO artists (id, name, name_key, spotify_id, links, label) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [id, name, artistNameKey(name), extra.spotifyId ?? null, JSON.stringify(extra.links ?? {}), extra.label ?? ''],
  );
  return id;
}
const artistRow = async (id: string) => (await pool.query('SELECT * FROM artists WHERE id = $1', [id])).rows[0];
const reviewRow = async (id: string) => (await pool.query('SELECT * FROM artist_match_reviews WHERE id = $1', [id])).rows[0];

/** The route writes its audit row after the response, so wait for it. */
async function auditRows(where: string, params: unknown[]) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const { rows } = await pool.query(`SELECT action, details_json FROM audit_log WHERE ${where} ORDER BY created_at`, params);
    if (rows.some((row: any) => row.action === 'artist.review.decided') || !where.includes('review')) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}

const candidate = (n: number, confidence = 'high') => ({ spotifyUrl: spotifyUrl(n), otherUrls: ['https://linktr.ee/x'], confidence, evidence: '<b>bold</b> evidence' });
const item = (over: Record<string, unknown> = {}) => ({
  kind: 'link',
  artistName: `Rev Artist ${stamp}-${++counter}`,
  festival: 'rev-fest',
  artistIds: [],
  candidates: [],
  proposed: { from: '', to: '' },
  note: '',
  ...over,
});
const importItems = (items: unknown[]) => app.post(`${REVIEW}/import`, { generatedAt: '2026-11-21', items });
/** Imports one item through the store (the route allows 10 imports a minute) and returns its review id. */
async function queue(over: Record<string, unknown>) {
  const parsed = schemas.artistReviewImport.parse({ generatedAt: '2026-11-21', items: [item(over)] });
  await createArtistMatchReviewStore(pool, createArtistsStore(pool)).importBatch(parsed, null);
  const { rows } = await pool.query('SELECT id FROM artist_match_reviews WHERE artist_name = $1', [parsed.items[0]!.artistName]);
  return rows[0].id as string;
}

describe('artist review queue', { skip, concurrency: 1 }, () => {
  test('import: validates the shape, rejects unknown kinds and non-https urls', async () => {
    const rejects = (over: Record<string, unknown>, what: string) =>
      assert.equal(schemas.artistReviewImport.safeParse({ generatedAt: '2026-11-21', items: [item(over)] }).success, false, what);
    rejects({ kind: 'delete' }, 'unknown kind');
    rejects({ candidates: [{ ...candidate(1), spotifyUrl: 'http://open.spotify.com/artist/x' }] }, 'http spotify');
    rejects({ candidates: [{ ...candidate(1), spotifyUrl: 'https://example.com/artist/x' }] }, 'spotify on another host');
    rejects({ candidates: [{ ...candidate(1), otherUrls: ['javascript:alert(1)'] }] }, 'javascript url');
    rejects({ candidates: [{ ...candidate(1), otherUrls: ['http://example.com'] }] }, 'http url');
    rejects({ candidates: [{ ...candidate(1), otherUrls: ['not a url'] }] }, 'malformed url');
    rejects({ candidates: [{ ...candidate(1), confidence: 'certain' }] }, 'unknown confidence');
    rejects({ artistName: '' }, 'empty name');
    assert.equal(schemas.artistReviewImport.safeParse({ generatedAt: '2026-11-21', items: [item({ kind: 'rename', candidates: [{ ...candidate(1), spotifyUrl: '' }] })] }).success, true);
    // The route answers the same refusals with a 400.
    const unknownKind = await importItems([item({ kind: 'delete' })]);
    assert.equal(unknownKind.status, 400);
    assert.equal(unknownKind.body.error.code, 'VALIDATION_ERROR');
    assert.equal((await app.post(`${REVIEW}/import`, { generatedAt: '2026-11-21', items: [] })).status, 400);
  });

  test('access: no session is 401 and a signed-in non-admin is 403 on every route', async () => {
    const user = as(app.server, userToken);
    const anon = as(app.server);
    for (const [label, call] of [
      ['list', (who: any) => who.get(REVIEW)],
      ['import', (who: any) => who.post(`${REVIEW}/import`, { generatedAt: 'x', items: [item()] })],
      ['approve', (who: any) => who.post(`${REVIEW}/rev-none/approve`, {})],
      ['reject', (who: any) => who.post(`${REVIEW}/rev-none/reject`, {})],
    ] as const) {
      assert.equal((await call(anon)).status, 401, `${label} without a session`);
      assert.equal((await call(user)).status, 403, `${label} as a non-admin`);
    }
  });

  test('import is idempotent, keeps batch order, pages and filters by status', async () => {
    const items = [1, 2, 3].map((n) => item({ artistName: `Idem ${stamp} ${n}`, festival: `idem-${stamp}`, candidates: [candidate(n)] }));
    const first = await importItems(items).expect(200);
    assert.deepEqual(first.body.data, { added: 3, refined: 0, skipped: 0, total: 3 });
    const again = await importItems([...items, items[0]]).expect(200);
    assert.deepEqual(again.body.data, { added: 0, refined: 0, skipped: 4, total: 4 });

    // A pending item takes refined candidates and a new note; a decided item does not.
    const refinedItem = { ...items[0]!, candidates: [candidate(9, 'low')], note: 'second pass' };
    const refined = await importItems([refinedItem]).expect(200);
    assert.deepEqual(refined.body.data, { added: 0, refined: 1, skipped: 0, total: 1 });
    const refinedRow = (await pool.query('SELECT candidates, note FROM artist_match_reviews WHERE artist_name = $1', [items[0]!.artistName])).rows[0];
    assert.equal(refinedRow.note, 'second pass');
    assert.equal(refinedRow.candidates[0].spotifyUrl, spotifyUrl(9));
    assert.equal((await importItems([refinedItem]).expect(200)).body.data.refined, 0);
    await pool.query(`UPDATE artist_match_reviews SET status = 'rejected' WHERE artist_name = $1`, [items[0]!.artistName]);
    assert.deepEqual((await importItems([items[0]]).expect(200)).body.data, { added: 0, refined: 0, skipped: 1, total: 1 });
    await pool.query(`UPDATE artist_match_reviews SET status = 'pending' WHERE artist_name = $1`, [items[0]!.artistName]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM artist_match_reviews WHERE festival = $1', [`idem-${stamp}`]);
    assert.equal(rows[0].n, 3);

    const all = await app.get(`${REVIEW}?status=pending&limit=100`).expect(200);
    const mine = all.body.data.items.filter((entry: any) => entry.festival === `idem-${stamp}`);
    assert.deepEqual(mine.map((entry: any) => entry.artistName), [1, 2, 3].map((n) => `Idem ${stamp} ${n}`));
    assert.equal(mine[0].status, 'pending');
    assert.equal(mine[0].candidates[0].evidence, '<b>bold</b> evidence');
    const total: number = all.body.data.total;
    const page = await app.get(`${REVIEW}?status=pending&limit=1&offset=1`).expect(200);
    assert.equal(page.body.data.items.length, 1);
    assert.equal(page.body.data.items[0].id, all.body.data.items[1].id);
    assert.equal(page.body.data.total, total);
    assert.equal((await app.get(`${REVIEW}?status=approved&limit=100`).expect(200)).body.data.items.every((entry: any) => entry.status === 'approved'), true);
    assert.equal((await app.get(`${REVIEW}?limit=0`)).status, 400);
  });

  test('approve a link: the artist and every festival copy get it, the item closes, and audit rows exist', async () => {
    const name = `Link Artist ${stamp}`;
    const artistId = await seedArtist(name);
    await seedFestival(pool, { id: `rev-link-${stamp}`, sets: [{ id: `rev-link-set-${stamp}`, artist: name, artists: [{ id: artistId, name, links: {} }] }] });
    const reviewId = await queue({ artistName: name, artistIds: [artistId], candidates: [candidate(11, 'low'), candidate(12)] });

    const res = await app.post(`${REVIEW}/${reviewId}/approve`, { candidateIndex: 1 }).expect(200);
    assert.deepEqual(res.body.data, { status: 'approved', artistId, festivalsUpdated: 1 });
    const artist = await artistRow(artistId);
    assert.equal(artist.spotify_id, spotifyId(12));
    assert.equal(artist.links.spotify, spotifyUrl(12));
    const copy = (await pool.query('SELECT artists FROM festival_sets WHERE id = $1', [`rev-link-set-${stamp}`])).rows[0].artists[0];
    assert.equal(copy.links.spotify, spotifyUrl(12));
    const row = await reviewRow(reviewId);
    assert.equal(row.status, 'approved');
    assert.equal(row.chosen_url, spotifyUrl(12));
    assert.ok(row.decided_at && row.decided_by);

    const audits = { rows: await auditRows('target_id = ANY($1::text[]) /* review */', [[artistId, reviewId]]) };
    const actions = audits.rows.map((audit: any) => audit.action);
    assert.ok(actions.includes('artist.updated'), 'the store wrote the edit audit row');
    assert.ok(actions.includes('artist.review.decided'), 'the route wrote the decision audit row');
    const edit = audits.rows.find((audit: any) => audit.action === 'artist.updated');
    assert.equal(edit.details_json.reviewId, reviewId);

    const second = await app.post(`${REVIEW}/${reviewId}/approve`, { candidateIndex: 1 }).expect(409);
    assert.match(second.body.error.message, /already decided/);
    await app.post(`${REVIEW}/${reviewId}/reject`, {}).expect(409);
  });

  test('approve a link: a typed link replaces the candidate, and an item with no ids is found by its name', async () => {
    const name = `Typed Artist ${stamp}`;
    const artistId = await seedArtist(name);
    const reviewId = await queue({ artistName: name, candidates: [candidate(21)] });
    await app.post(`${REVIEW}/${reviewId}/approve`, { url: spotifyUrl(22) }).expect(200);
    assert.equal((await artistRow(artistId)).spotify_id, spotifyId(22));
    assert.equal((await reviewRow(reviewId)).chosen_url, spotifyUrl(22));

    const noCandidate = await queue({ artistName: `Nothing Artist ${stamp}`, candidates: [] });
    const missing = await app.post(`${REVIEW}/${noCandidate}/approve`, {}).expect(400);
    assert.match(missing.body.error.message, /Pick a candidate or type a link/);
    assert.equal((await reviewRow(noCandidate)).status, 'pending');
  });

  test('approve refuses and stays pending: an unknown name, two same-name artists, a bad link', async () => {
    const stays = async (reviewId: string) => assert.equal((await reviewRow(reviewId)).status, 'pending');

    const none = await queue({ artistName: `Ghost ${stamp}`, candidates: [candidate(31)] });
    assert.match((await app.post(`${REVIEW}/${none}/approve`, {}).expect(409)).body.error.message, /No artist is named/);
    await stays(none);

    const twin = `Twin ${stamp}`;
    const a = await seedArtist(twin);
    await seedArtist(twin, { label: 'two' });
    const ambiguous = await queue({ artistName: twin, candidates: [candidate(32)] });
    assert.match((await app.post(`${REVIEW}/${ambiguous}/approve`, {}).expect(409)).body.error.message, /2 artists are named/);
    await stays(ambiguous);
    assert.equal((await artistRow(a)).spotify_id, null);

    const named = `Track ${stamp}`;
    const artistId = await seedArtist(named);
    const bad = await queue({ artistName: named, artistIds: [artistId], candidates: [{ ...candidate(33), spotifyUrl: 'https://open.spotify.com/track/4Z8W4fKeB5YxbusRsdQVPb' }] });
    assert.match((await app.post(`${REVIEW}/${bad}/approve`, {}).expect(400)).body.error.message, /Spotify track link/);
    await stays(bad);
    assert.equal((await artistRow(artistId)).spotify_id, null);
  });

  test('approve a rename: the artist and its festival copy take the new name', async () => {
    const from = `MODAL ${stamp}`;
    const to = `Modal ${stamp}`;
    const artistId = await seedArtist(from);
    await seedFestival(pool, { id: `rev-rename-${stamp}`, sets: [{ id: `rev-rename-set-${stamp}`, artist: from, artists: [{ id: artistId, name: from, links: {} }] }] });
    const reviewId = await queue({ kind: 'rename', artistName: from, artistIds: [artistId], proposed: { from, to }, candidates: [{ ...candidate(41), spotifyUrl: '' }] });
    await app.post(`${REVIEW}/${reviewId}/approve`, {}).expect(200);
    assert.equal((await artistRow(artistId)).name, to);
    const copy = (await pool.query('SELECT artists FROM festival_sets WHERE id = $1', [`rev-rename-set-${stamp}`])).rows[0].artists[0];
    assert.equal(copy.name, to);

    const clashFrom = `Clash ${stamp}`;
    const clashId = await seedArtist(clashFrom);
    const blocker = await seedArtist(`Taken ${stamp}`);
    const blocked = await queue({ kind: 'rename', artistName: clashFrom, artistIds: [clashId], proposed: { from: clashFrom, to: `Taken ${stamp}` } });
    await app.post(`${REVIEW}/${blocked}/approve`, {}).expect(409);
    assert.equal((await reviewRow(blocked)).status, 'pending');
    assert.equal((await artistRow(clashId)).name, clashFrom);
    assert.equal((await artistRow(blocker)).name, `Taken ${stamp}`);
  });

  test('approve a merge: needs a recent re-auth and the reviewed festival count, then merges into the Spotify holder', async () => {
    const name = `YDG ${stamp}`;
    const loserId = await seedArtist(name);
    const survivorId = await seedArtist(`${name} (survivor)`, { spotifyId: spotifyId(51), links: { spotify: spotifyUrl(51) } });
    await seedFestival(pool, { id: `rev-merge-${stamp}`, sets: [{ id: `rev-merge-set-${stamp}`, artist: name, artists: [{ id: loserId, name, links: {} }] }] });
    const reviewId = await queue({ kind: 'merge', artistName: name, artistIds: [loserId], candidates: [candidate(51, 'medium')] });

    const listed = (await app.get(`${REVIEW}?limit=100`).expect(200)).body.data.items.find((entry: any) => entry.id === reviewId);
    assert.equal(listed.festivalCount, 1);
    assert.deepEqual(listed.merge, { loserId, loserName: name, survivorId, survivorName: `${name} (survivor)` });

    const noAuth = await app.post(`${REVIEW}/${reviewId}/approve`, { acceptedFestivals: 1, expectedSurvivorId: survivorId }).expect(403);
    assert.equal(noAuth.body.error.code, 'REAUTH_REQUIRED');
    await app.post('/api/v1/auth/reauth', { password: ADMIN_PASSWORD }).expect(200);

    const noCount = await app.post(`${REVIEW}/${reviewId}/approve`, {}).expect(400);
    assert.match(noCount.body.error.message, /acceptedFestivals/);
    assert.equal((await reviewRow(reviewId)).status, 'pending');
    assert.equal((await artistRow(loserId)).merged_into, null);

    const noSurvivor = await app.post(`${REVIEW}/${reviewId}/approve`, { acceptedFestivals: 1 }).expect(400);
    assert.match(noSurvivor.body.error.message, /expectedSurvivorId/);
    const wrongSurvivor = await app.post(`${REVIEW}/${reviewId}/approve`, { acceptedFestivals: 1, expectedSurvivorId: loserId }).expect(409);
    assert.match(wrongSurvivor.body.error.message, /not the one you reviewed/);
    assert.equal((await reviewRow(reviewId)).status, 'pending');
    assert.equal((await artistRow(loserId)).merged_into, null);

    const res = await app.post(`${REVIEW}/${reviewId}/approve`, { acceptedFestivals: 1, expectedSurvivorId: survivorId }).expect(200);
    assert.equal(res.body.data.artistId, survivorId);
    assert.equal((await artistRow(loserId)).merged_into, survivorId);
    assert.equal((await reviewRow(reviewId)).status, 'approved');
    const copy = (await pool.query('SELECT artists FROM festival_sets WHERE id = $1', [`rev-merge-set-${stamp}`])).rows[0].artists[0];
    assert.equal(copy.id, survivorId);
    const merged = await pool.query(`SELECT details_json FROM audit_log WHERE action = 'artist.merged' AND target_id = $1`, [survivorId]);
    assert.equal(merged.rowCount, 1);
    assert.equal(merged.rows[0].details_json.reviewId, reviewId);
    assert.equal(merged.rows[0].details_json.via, 'artist-review');
    const decided = await auditRows(`action = 'artist.review.decided' AND target_id = $1`, [reviewId]);
    // The route's own audit rows store their details as a JSON string.
    const decidedDetails = JSON.parse(decided[0].details_json);
    assert.equal(decidedDetails.loserId, loserId);
    assert.equal(decidedDetails.survivorId, survivorId);

    const lonely = await queue({ kind: 'merge', artistName: `Lonely ${stamp}`, artistIds: [await seedArtist(`Lonely ${stamp}`)], candidates: [candidate(52)] });
    const lonelyList = (await app.get(`${REVIEW}?limit=100`).expect(200)).body.data.items.find((entry: any) => entry.id === lonely);
    assert.equal(lonelyList.merge, null);
    assert.match((await app.post(`${REVIEW}/${lonely}/approve`, { acceptedFestivals: 0, expectedSurvivorId: 'x' }).expect(409)).body.error.message, /merge target is unknown/);
  });

  test('a merge whose loser already holds the Spotify link says so, and a merge keeps its id order', async () => {
    const name = `Holder ${stamp}`;
    const loserId = await seedArtist(name, { spotifyId: spotifyId(53), links: { spotify: spotifyUrl(53) } });
    const reviewId = await queue({ kind: 'merge', artistName: name, artistIds: [loserId], candidates: [candidate(53)] });
    const listed = (await app.get(`${REVIEW}?limit=100`).expect(200)).body.data.items.find((entry: any) => entry.id === reviewId);
    assert.equal(listed.merge, null);
    const refused = await app.post(`${REVIEW}/${reviewId}/approve`, { acceptedFestivals: 0, expectedSurvivorId: loserId }).expect(409);
    assert.match(refused.body.error.message, /already holds this Spotify link/);
    assert.equal((await reviewRow(reviewId)).status, 'pending');

    const a = await seedArtist(`Order A ${stamp}`);
    const b = await seedArtist(`Order B ${stamp}`);
    const forward = { kind: 'merge', artistName: `Order ${stamp}`, festival: 'order', artistIds: [a, b] };
    const result = await importItems([forward, { ...forward, artistIds: [b, a] }]).expect(200);
    assert.equal(result.body.data.added, 2);
  });

  test('a link or rename refuses an artist that was renamed since the batch, and the row shows the current link', async () => {
    const name = `Moved ${stamp}`;
    const artistId = await seedArtist(name, { spotifyId: spotifyId(54), links: { spotify: spotifyUrl(54) } });
    const linkId = await queue({ artistName: name, artistIds: [artistId], candidates: [candidate(55)] });
    const renameId = await queue({ kind: 'rename', artistName: name, artistIds: [artistId], proposed: { from: name, to: `${name} Renamed` } });
    const listed = (await app.get(`${REVIEW}?limit=100`).expect(200)).body.data.items;
    assert.deepEqual(listed.find((entry: any) => entry.id === linkId).current, { name, spotifyUrl: spotifyUrl(54) });

    await pool.query('UPDATE artists SET name = $2, name_key = $3 WHERE id = $1', [artistId, `Someone Else ${stamp}`, artistNameKey(`Someone Else ${stamp}`)]);
    for (const id of [linkId, renameId]) {
      const refused = await app.post(`${REVIEW}/${id}/approve`, {}).expect(409);
      assert.match(refused.body.error.message, /is now named Someone Else/);
      assert.equal((await reviewRow(id)).status, 'pending');
    }
    const row = await artistRow(artistId);
    assert.equal(row.name, `Someone Else ${stamp}`);
    assert.equal(row.spotify_id, spotifyId(54));
  });

  test('a merge that sees more festivals than the admin reviewed is refused and stays pending', async () => {
    const name = `Count ${stamp}`;
    const loserId = await seedArtist(name);
    const survivorId = await seedArtist(`${name} two`);
    await seedFestival(pool, { id: `rev-count-${stamp}`, sets: [{ id: `rev-count-set-${stamp}`, artist: name, artists: [{ id: loserId, name, links: {} }] }] });
    const reviewId = await queue({ kind: 'merge', artistName: name, artistIds: [loserId, survivorId] });
    const refused = await app.post(`${REVIEW}/${reviewId}/approve`, { acceptedFestivals: 0, expectedSurvivorId: survivorId }).expect(409);
    assert.match(refused.body.error.message, /more than the 0 you reviewed/);
    assert.equal((await reviewRow(reviewId)).status, 'pending');
    assert.equal((await artistRow(loserId)).merged_into, null);
  });

  test('reject: closes the item with a note, changes nothing else, and cannot be repeated', async () => {
    const name = `Reject ${stamp}`;
    const artistId = await seedArtist(name);
    const reviewId = await queue({ artistName: name, artistIds: [artistId], candidates: [candidate(61)] });
    await app.post(`${REVIEW}/${reviewId}/reject`, { note: 'wrong act' }).expect(200);
    const row = await reviewRow(reviewId);
    assert.equal(row.status, 'rejected');
    assert.equal(row.decision_note, 'wrong act');
    assert.equal((await artistRow(artistId)).spotify_id, null);
    await app.post(`${REVIEW}/${reviewId}/reject`, {}).expect(409);
    await app.post(`${REVIEW}/${reviewId}/approve`, {}).expect(409);
    await app.post(`${REVIEW}/rev-missing/reject`, {}).expect(404);
    await app.post(`${REVIEW}/rev-missing/approve`, {}).expect(404);
    const audited = await auditRows(`action = 'artist.review.decided' AND target_id = $1`, [reviewId]);
    assert.equal(audited.length, 1);
  });

  test('approving merges is limited to 10 a minute, as the Artists tab merge is, while links are not', async () => {
    // Runs last: it spends the merge bucket. Refused for the missing re-auth or not, each call counts.
    const merges = await Promise.all(Array.from({ length: 12 }, () => queue({ kind: 'merge' })));
    const statuses: number[] = [];
    for (const id of merges) statuses.push((await app.post(`${REVIEW}/${id}/approve`, {})).status);
    assert.ok(statuses.includes(429), `a merge approval was rate limited: ${statuses.join(',')}`);
    assert.ok(statuses.indexOf(429) <= 10, 'the limit is 10, not 60');

    const link = await queue({ kind: 'link', artistName: `Unlimited ${stamp}`, candidates: [] });
    assert.notEqual((await app.post(`${REVIEW}/${link}/approve`, {})).status, 429);
  });
});
