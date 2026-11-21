import 'dotenv/config';
/**
 * Artist rules for organizations (master plan M7 slice 5, artist plan section 8, conflict rows C5 and C6).
 * Runs the real app on the throwaway test database, with ORGANIZER_PLATFORM_ENABLED on.
 *
 * Covers: which artists an organizer sees (published, own festivals, created by its organization) and that a
 * hidden artist changes no answer; create (unverified, neutral automatic note on a hidden clash); direct edit,
 * the flagged fill carve-out and the suggestion path; what a draft of another tenant never reveals; the admin
 * decision of a suggestion; the festival save and the lineup import resolving names the same way.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { artistNameKey } from '../lib/artist-key';
import createUsersStore from '../lib/db/stores/users';
import createUtils from '../lib/db/utils';
import { skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

const ARTISTS = '/api/v1/manage/artists';
const ADMIN_ARTISTS = '/api/v1/admin/artists';
const MANAGE = '/api/v1/manage/festivals';
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';
const INSTAGRAM = 'https://www.instagram.com/tenancy_one';
const SOUNDCLOUD = 'https://soundcloud.com/tenancy-one';
const SPOTIFY = 'https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg';

type Server = any;
let server: Server;
let users: any;
let adminToken: string;
let counter = 0;

before(async () => {
  if (skip) return;
  server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
  users = await o.seedScenario(server);
  adminToken = await h.loginAdmin(server);
});
after(async () => {
  if (server) await server.close();
});

const as = (who: string) => o.as(server, who === 'admin' ? adminToken : users[who].token);
const sql = (text: string, params: unknown[] = []) => o.sql(server, text, params);

async function seedArtist(a: { name: string; label?: string; links?: Record<string, string>; verified?: boolean; createdBy?: string | null }) {
  const id = `ten-${++counter}-${Date.now()}`;
  await sql(
    `INSERT INTO artists (id, name, name_key, label, links, verified, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [id, a.name, artistNameKey(a.name), a.label ?? '', JSON.stringify(a.links ?? {}), a.verified ?? true, a.createdBy ?? null],
  );
  return id;
}

/** A festival of `org` (null: admin only) whose announced lineup lists the artists. */
async function festival(id: string, org: string | null, published: boolean, artists: Array<{ id: string; name: string }> = []) {
  await o.seedFestival(server, id, org, published);
  await sql('UPDATE festivals SET lineup = $2::jsonb WHERE id = $1', [id, JSON.stringify(artists.map((a) => ({ artists: [{ id: a.id, name: a.name, links: {} }], displayName: null })))]);
}

const artistRow = async (id: string) => (await sql('SELECT * FROM artists WHERE id = $1', [id])).rows[0];
const lineupNames = async (festivalId: string) =>
  ((await sql('SELECT lineup FROM festivals WHERE id = $1', [festivalId])).rows[0].lineup as any[]).flatMap((entry) => entry.artists.map((a: any) => a.name));
const tokenOf = async (id: string) => new Date((await artistRow(id)).updated_at).toISOString();
const suggestions = async (artistId: string) => (await sql('SELECT * FROM artist_suggestions WHERE artist_id = $1 ORDER BY created_at', [artistId])).rows;
const patch = async (who: string, id: string, changes: object, extra: object = {}) =>
  as(who).patch(`${ARTISTS}/${id}`, { expectedUpdatedAt: await tokenOf(id), changes, ...extra });

describe('what an organizer sees', { skip }, () => {
  test('published, own and own-created artists are visible; another tenant draft and an admin-only draft are not', async () => {
    const own = await seedArtist({ name: 'Vis Own' });
    await festival('fv-own', 'org-a', false, [{ id: own, name: 'Vis Own' }]);
    const draftOfB = await seedArtist({ name: 'Vis Draft' });
    await festival('fv-b', 'org-b', false, [{ id: draftOfB, name: 'Vis Draft' }]);
    const adminOnly = await seedArtist({ name: 'Vis Platform' });
    await festival('fv-plat', null, false, [{ id: adminOnly, name: 'Vis Platform' }]);
    const live = await seedArtist({ name: 'Vis Live' });
    await festival('fv-live', 'org-b', true, [{ id: live, name: 'Vis Live' }]);
    await seedArtist({ name: 'Vis Teammate', createdBy: users.ownerA.id });
    await seedArtist({ name: 'Vis Stranger', createdBy: users.ownerB.id });

    const names = ['Vis Own', 'Vis Draft', 'Vis Platform', 'Vis Live', 'Vis Teammate', 'Vis Stranger'];
    const match = await as('editorA').post(`${ARTISTS}/match`, { items: names.map((name) => ({ name })) });
    assert.equal(match.status, 200, JSON.stringify(match.body));
    assert.deepEqual(
      match.body.data.results.map((r: any) => [r.name, r.outcome]),
      [['Vis Own', 'linked'], ['Vis Draft', 'new'], ['Vis Platform', 'new'], ['Vis Live', 'linked'], ['Vis Teammate', 'linked'], ['Vis Stranger', 'new']],
    );
    // A hidden artist answers exactly like a name nobody has.
    const nobody = await as('editorA').post(`${ARTISTS}/match`, { items: [{ name: 'Vis Nobody Has This' }] });
    assert.deepEqual({ ...match.body.data.results[1], name: '' }, { ...nobody.body.data.results[0], name: '' });

    const list = await as('editorA').get(`${ARTISTS}?q=Vis`);
    assert.deepEqual(list.body.data.artists.map((a: any) => a.name).sort(), ['Vis Live', 'Vis Own', 'Vis Teammate']);

    assert.equal((await as('editorA').get(`${ARTISTS}/${own}/impact`)).status, 200);
    for (const hidden of [draftOfB, adminOnly]) assert.equal((await as('editorA').get(`${ARTISTS}/${hidden}/impact`)).status, 404);
    assert.equal((await as('editorA').get(`${ARTISTS}/ten-no-such-artist/impact`)).status, 404);
    // The viewer role reads too; a stranger with no organization does not.
    assert.equal((await as('viewerA').get(`${ARTISTS}?q=Vis`)).status, 200);
    assert.equal((await as('stranger').get(`${ARTISTS}?q=Vis`)).status, 403);
  });

  test('a stranger draft is neither named nor counted in the impact line, and a live festival is', async () => {
    const shared = await seedArtist({ name: 'Usage Shared' });
    const element = { id: shared, name: 'Usage Shared' };
    await festival('fu-a', 'org-a', false, [element]);
    await festival('fu-b', 'org-b', false, [element]);
    await festival('fu-plat', null, false, [element]);
    await festival('fu-live', 'org-b', true, [element]);

    const impact = await as('editorA').get(`${ARTISTS}/${shared}/impact`);
    assert.equal(impact.status, 200);
    assert.deepEqual(impact.body.data.festivals.map((f: any) => f.id).sort(), ['fu-a', 'fu-live']);
    assert.equal(impact.body.data.counts.lineupEntries, 2);
    assert.doesNotMatch(JSON.stringify(impact.body), /fu-b|fu-plat/);
    const list = await as('editorA').get(`${ARTISTS}?q=Usage Shared`);
    assert.equal(list.body.data.artists[0].alsoOn, 2, 'the own draft and the live festival count; the other drafts do not');
    // The admin sees everything.
    const adminView = await as('admin').get(`${ADMIN_ARTISTS}/${shared}/impact`);
    assert.equal(adminView.body.data.festivals.length, 4);
  });
});

describe('creating artists', { skip }, () => {
  test('an owner or editor creates an unverified artist; a viewer, a stranger and a suspended organization cannot', async () => {
    const created = await as('editorA').post(ARTISTS, { name: 'Create Fresh' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.artist.verified, false);
    assert.equal(created.body.data.artist.labelAuto, undefined, 'the automatic-note flag is never sent to an organizer');
    const row = await artistRow(created.body.data.artist.id);
    assert.deepEqual([row.verified, row.label_auto, row.created_by], [false, false, users.editorA.id]);
    assert.equal((await as('ownerP').post(ARTISTS, { name: 'Create Pending Org' })).status, 201, 'a pending organization may create');
    assert.equal((await as('viewerA').post(ARTISTS, { name: 'Create Viewer' })).status, 403);
    assert.equal((await as('stranger').post(ARTISTS, { name: 'Create Stranger' })).status, 403);
    assert.equal((await as('ownerS').post(ARTISTS, { name: 'Create Suspended' })).status, 403);
    assert.equal((await as('editorA').post(ARTISTS, { name: 'Create Other Org', organizationId: 'org-b' })).status, 404);
    const spotify = await as('editorA').post(ARTISTS, { name: 'Create Spotify', link: SPOTIFY });
    assert.equal(spotify.status, 400);
    assert.match(spotify.body.error.message, /suggest the link/);
    const audits = await sql(`SELECT actor_type, organization_id FROM audit_log WHERE action = 'artist.created' AND target_id = $1`, [created.body.data.artist.id]);
    assert.deepEqual([audits.rows[0].actor_type, audits.rows[0].organization_id], ['organizer', 'org-a']);
    // An admin-created artist is verified.
    const byAdmin = await as('admin').post(ADMIN_ARTISTS, { name: 'Create By Admin' });
    assert.equal(byAdmin.body.data.artist.verified, true);
  });

  test('a name that clashes with a hidden artist gets a neutral note and the same answer as a free name', async () => {
    const hidden = await seedArtist({ name: 'Clash Name' });
    await festival('fc-b', 'org-b', false, [{ id: hidden, name: 'Clash Name' }]);
    const clash = await as('editorA').post(ARTISTS, { name: 'Clash Name' });
    const free = await as('editorA').post(ARTISTS, { name: 'Clash Free Name' });
    assert.equal(clash.status, 201, JSON.stringify(clash.body));
    assert.deepEqual(Object.keys(clash.body.data.artist).sort(), Object.keys(free.body.data.artist).sort());
    assert.equal(clash.body.data.artist.label, '');
    const row = await artistRow(clash.body.data.artist.id);
    assert.deepEqual([row.label, row.label_auto, row.verified], ['unnamed 1', true, false]);
    assert.notEqual(row.id, hidden);

    // Now the artist is the caller's own, so a second one needs a note, and the message names only visible artists.
    const again = await as('editorA').post(ARTISTS, { name: 'Clash Name' });
    assert.equal(again.status, 400);
    assert.deepEqual(again.body.error.existingIds, [row.id]);
    assert.equal((await as('editorA').post(ARTISTS, { name: 'Clash Name', label: 'UK' })).status, 201);
  });
});

describe('editing an artist', { skip }, () => {
  test('an artist only the organization uses is edited at once, and every festival copy follows', async () => {
    const id = await seedArtist({ name: 'Own Only', createdBy: users.editorA.id });
    await festival('fe-own', 'org-a', false, [{ id, name: 'Own Only' }]);
    await festival('fe-own-2', 'org-a', false, [{ id, name: 'Own Only' }]);
    const res = await patch('editorA', id, { name: 'Own Only Renamed' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.data.status, res.body.data.flagged, res.body.data.festivalsUpdated], ['saved', false, 2]);
    assert.equal((await artistRow(id)).name, 'Own Only Renamed');
    assert.deepEqual([await lineupNames('fe-own'), await lineupNames('fe-own-2')], [['Own Only Renamed'], ['Own Only Renamed']]);
    // Another organization has no way in, and the answer is the one for a missing artist.
    assert.equal((await patch('ownerB', id, { name: 'Hijack' })).status, 404);
    assert.equal((await artistRow(id)).name, 'Own Only Renamed');
    // A viewer may not write.
    assert.equal((await patch('viewerA', id, { name: 'Viewer Edit' })).status, 403);
  });

  test('every organizer Spotify change is a suggestion, even on an artist only the organization uses', async () => {
    const id = await seedArtist({ name: 'Spotify Own', createdBy: users.editorA.id });
    await festival('fe-spot', 'org-a', false, [{ id, name: 'Spotify Own' }]);
    const res = await patch('editorA', id, { addLink: SPOTIFY });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'suggested');
    assert.match(res.body.data.message, /Sent for review/);
    assert.deepEqual((await artistRow(id)).links, {});
    const rows = await suggestions(id);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].status, rows[0].organization_id, rows[0].created_by, rows[0].changes], ['pending', 'org-a', users.editorA.id, { addLink: SPOTIFY }]);
    // The same change again is the same suggestion.
    const again = await patch('editorA', id, { addLink: SPOTIFY });
    assert.equal(again.body.data.suggestionId, res.body.data.suggestionId);
    assert.equal((await suggestions(id)).length, 1);
  });

  test('an artist that another tenant or the platform also uses: a fill saves at once and is flagged, anything else is a suggestion', async () => {
    const id = await seedArtist({ name: 'Shared Act', links: { soundcloud: SOUNDCLOUD } });
    await festival('fe-sh-a', 'org-a', false, [{ id, name: 'Shared Act' }]);
    await festival('fe-sh-b', 'org-b', false, [{ id, name: 'Shared Act' }]);

    const fill = await patch('editorA', id, { addLink: INSTAGRAM });
    assert.equal(fill.status, 200, JSON.stringify(fill.body));
    assert.deepEqual([fill.body.data.status, fill.body.data.flagged], ['saved', true]);
    assert.deepEqual((await artistRow(id)).links, { soundcloud: SOUNDCLOUD, instagram: INSTAGRAM });
    const audit = await sql(`SELECT actor_type, organization_id, details_json FROM audit_log WHERE action = 'artist.updated' AND target_id = $1`, [id]);
    assert.equal(audit.rows.length, 1);
    assert.deepEqual([audit.rows[0].actor_type, audit.rows[0].organization_id], ['organizer', 'org-a']);
    assert.deepEqual([audit.rows[0].details_json.via, audit.rows[0].details_json.flagged], ['organizer-fill', true]);

    const suggested: Array<[string, object]> = [
      ['a rename', { name: 'Shared Act Renamed' }],
      ['a new note', { label: 'Berlin' }],
      ['a link that replaces a filled one', { addLink: 'https://www.instagram.com/other_handle' }],
      ['a removed link', { removeLinks: ['soundcloud'] }],
      ['a fill together with a rename', { name: 'Shared Act 2', addLink: 'https://www.facebook.com/sharedact' }],
      ['a Spotify link', { addLink: SPOTIFY }],
    ];
    for (const [what, changes] of suggested) {
      const res = await patch('editorA', id, changes);
      assert.equal(res.status, 202, `${what}: ${JSON.stringify(res.body)}`);
    }
    const row = await artistRow(id);
    assert.deepEqual([row.name, row.label, row.links], ['Shared Act', '', { soundcloud: SOUNDCLOUD, instagram: INSTAGRAM }], 'a suggestion changes nothing');
    assert.equal((await suggestions(id)).length, suggested.length);
    assert.deepEqual(await lineupNames('fe-sh-b'), ['Shared Act'], 'the other tenant festival is untouched');
  });

  test('only the acting organization counts as own: a viewer seat or a suspended organization elsewhere gives no direct edit', async () => {
    const dual = await o.makeUser(server, `dual-${Date.now()}`);
    await o.addMember(server, 'org-a', dual.id, 'editor');
    await o.addMember(server, 'org-b', dual.id, 'viewer');
    await o.addMember(server, 'org-s', dual.id, 'owner');
    const viaViewerSeat = await seedArtist({ name: 'Seat Viewer' });
    await festival('fe-seat-b', 'org-b', false, [{ id: viaViewerSeat, name: 'Seat Viewer' }]);
    const viaSuspended = await seedArtist({ name: 'Seat Suspended' });
    await festival('fe-seat-s', 'org-s', false, [{ id: viaSuspended, name: 'Seat Suspended' }]);
    const own = await seedArtist({ name: 'Seat Own' });
    await festival('fe-seat-a', 'org-a', false, [{ id: own, name: 'Seat Own' }]);
    const edit = async (id: string, changes: object) =>
      o.as(server, dual.token).patch(`${ARTISTS}/${id}`, { expectedUpdatedAt: await tokenOf(id), changes });
    // The artist is visible through the other seat, but a write for organization A is a suggestion.
    for (const id of [viaViewerSeat, viaSuspended]) {
      const res = await edit(id, { name: 'Seat Rename' });
      assert.equal(res.status, 202, JSON.stringify(res.body));
      assert.notEqual((await artistRow(id)).name, 'Seat Rename');
    }
    assert.equal((await edit(own, { name: 'Seat Own Renamed' })).status, 200);
  });

  test('a hidden merged artist is a 404 that never names its survivor; a visible one still names it', async () => {
    const survivor = await seedArtist({ name: 'Merge Survivor Secret' });
    const hidden = await seedArtist({ name: 'Merge Hidden Loser' });
    await festival('fe-mg-b', 'org-b', false, [{ id: hidden, name: 'Merge Hidden Loser' }, { id: survivor, name: 'Merge Survivor Secret' }]);
    await sql('UPDATE artists SET merged_into = $2 WHERE id = $1', [hidden, survivor]);
    const res = await patch('editorA', hidden, { name: 'Probe' });
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.ok(!JSON.stringify(res.body).includes('Merge Survivor Secret'));
    // Its own merged artist: visible to organization A, so the 409 may name the survivor when A can see that too.
    const mine = await seedArtist({ name: 'Merge Mine Loser' });
    const mineSurvivor = await seedArtist({ name: 'Merge Mine Survivor' });
    await festival('fe-mg-a', 'org-a', false, [{ id: mine, name: 'Merge Mine Loser' }, { id: mineSurvivor, name: 'Merge Mine Survivor' }]);
    await sql('UPDATE artists SET merged_into = $2 WHERE id = $1', [mine, mineSurvivor]);
    const own = await patch('editorA', mine, { name: 'Probe' });
    assert.equal(own.status, 409, JSON.stringify(own.body));
    assert.match(own.body.error.message, /Merge Mine Survivor/);
    // Visible loser, hidden survivor: the survivor stays unnamed.
    const loser2 = await seedArtist({ name: 'Merge Mine Loser Two' });
    const hiddenSurvivor = await seedArtist({ name: 'Merge Survivor Hidden Two' });
    await festival('fe-mg-a2', 'org-a', false, [{ id: loser2, name: 'Merge Mine Loser Two' }]);
    await festival('fe-mg-b2', 'org-b', false, [{ id: hiddenSurvivor, name: 'Merge Survivor Hidden Two' }]);
    await sql('UPDATE artists SET merged_into = $2 WHERE id = $1', [loser2, hiddenSurvivor]);
    const partial = await patch('editorA', loser2, { name: 'Probe' });
    assert.equal(partial.status, 409);
    assert.ok(!JSON.stringify(partial.body).includes('Merge Survivor Hidden Two'));
  });

  test('an admin-only festival counts as another user, and a stale token is a 409', async () => {
    const id = await seedArtist({ name: 'Platform Shared' });
    await festival('fe-pl-a', 'org-a', false, [{ id, name: 'Platform Shared' }]);
    await festival('fe-pl-plat', null, false, [{ id, name: 'Platform Shared' }]);
    assert.equal((await patch('ownerA', id, { label: 'Live' })).status, 202);
    const stale = await as('ownerA').patch(`${ARTISTS}/${id}`, { expectedUpdatedAt: '2001-01-01T00:00:00.000Z', changes: { addLink: INSTAGRAM } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'ARTIST_CHANGED');
  });

  test('a soft-deleted festival of another tenant still counts for permission and is never named', async () => {
    const id = await seedArtist({ name: 'Archived Shared' });
    await festival('fe-ar-a', 'org-a', false, [{ id, name: 'Archived Shared' }]);
    await festival('fe-ar-b', 'org-b', true, [{ id, name: 'Archived Shared' }]);
    await sql('UPDATE festivals SET deleted_at = NOW() WHERE id = $1', ['fe-ar-b']);
    assert.equal((await patch('ownerA', id, { name: 'Archived Renamed' })).status, 202);
    const impact = await as('ownerA').get(`${ARTISTS}/${id}/impact`);
    assert.deepEqual(impact.body.data.festivals.map((f: any) => f.id), ['fe-ar-a']);
  });
});

describe('deciding suggestions', { skip }, () => {
  async function suggest(name: string, changes: object) {
    const id = await seedArtist({ name });
    await festival(`fd-${id}-a`, 'org-a', false, [{ id, name }]);
    await festival(`fd-${id}-b`, 'org-b', false, [{ id, name }]);
    const res = await patch('editorA', id, changes);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    return { id, suggestionId: res.body.data.suggestionId as string, festivals: [`fd-${id}-a`, `fd-${id}-b`] };
  }

  test('the admin list shows the author and the organization, never an email; accept applies the change everywhere', async () => {
    const { id, suggestionId, festivals } = await suggest('Decide Accept', { name: 'Decide Accepted' });
    const list = await as('admin').get(`${ADMIN_ARTISTS}/suggestions`);
    assert.equal(list.status, 200);
    const mine = list.body.data.suggestions.find((s: any) => s.id === suggestionId);
    assert.deepEqual(
      [mine.status, mine.artist.name, mine.organization, mine.createdBy, mine.changes, mine.festivalCount],
      ['pending', 'Decide Accept', { id: 'org-a', name: 'Org org-a' }, users.editorA.username, { name: 'Decide Accepted' }, 2],
    );
    assert.doesNotMatch(JSON.stringify(list.body), /@example\.com/);

    const accepted = await as('admin').post(`${ADMIN_ARTISTS}/suggestions/${suggestionId}/decision`, { decision: 'accept' });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.deepEqual([accepted.body.data.status, accepted.body.data.festivalsUpdated], ['accepted', 2]);
    assert.equal((await artistRow(id)).name, 'Decide Accepted');
    assert.deepEqual([await lineupNames(festivals[0]!), await lineupNames(festivals[1]!)], [['Decide Accepted'], ['Decide Accepted']]);
    const audits = await sql(`SELECT action, details_json FROM audit_log WHERE target_id = $1 ORDER BY created_at`, [id]);
    assert.ok(audits.rows.some((a: any) => a.action === 'artist.suggestion.decided'));
    assert.ok(audits.rows.some((a: any) => a.action === 'artist.updated' && a.details_json.suggestionId === suggestionId));
    assert.equal((await as('admin').post(`${ADMIN_ARTISTS}/suggestions/${suggestionId}/decision`, { decision: 'reject' })).status, 409, 'a decided suggestion stays decided');
    const own = await as('ownerA').get(`${ARTISTS}/suggestions`);
    assert.equal(own.body.data.suggestions.find((s: any) => s.id === suggestionId).status, 'accepted');
  });

  test('reject keeps the artist and shows the organization the note', async () => {
    const { id, suggestionId } = await suggest('Decide Reject', { label: 'Nope' });
    const rejected = await as('admin').post(`${ADMIN_ARTISTS}/suggestions/${suggestionId}/decision`, { decision: 'reject', note: 'Not the same artist.' });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal((await artistRow(id)).label, '');
    const own = (await as('ownerA').get(`${ARTISTS}/suggestions`)).body.data.suggestions.find((s: any) => s.id === suggestionId);
    assert.deepEqual([own.status, own.note], ['rejected', 'Not the same artist.']);
    assert.equal((await as('ownerB').get(`${ARTISTS}/suggestions`)).body.data.suggestions.some((s: any) => s.id === suggestionId), false);
    const pending = await as('admin').get(`${ADMIN_ARTISTS}/suggestions`);
    assert.equal(pending.body.data.suggestions.some((s: any) => s.id === suggestionId), false, 'the default list is the pending ones');
  });

  test('an accept that now clashes is refused and the suggestion stays pending', async () => {
    const { id, suggestionId } = await suggest('Decide Clash', { name: 'Decide Taken' });
    await seedArtist({ name: 'Decide Taken' });
    const res = await as('admin').post(`${ADMIN_ARTISTS}/suggestions/${suggestionId}/decision`, { decision: 'accept' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ARTIST_EXISTS');
    assert.equal((await artistRow(id)).name, 'Decide Clash');
    assert.equal((await suggestions(id))[0].status, 'pending');
  });

  test('only an admin reads or decides, and a merge closes the pending suggestions of the artist it removes', async () => {
    const { id, suggestionId } = await suggest('Decide Merge Loser', { name: 'Decide Merge Loser Two' });
    assert.equal((await as('editorA').get(`${ADMIN_ARTISTS}/suggestions`)).status, 403);
    assert.equal((await as('editorA').post(`${ADMIN_ARTISTS}/suggestions/${suggestionId}/decision`, { decision: 'accept' })).status, 403);
    assert.equal((await as('editorA').post(`${ADMIN_ARTISTS}/${id}/verify`)).status, 403);
    const survivor = await seedArtist({ name: 'Decide Merge Survivor' });
    await o.reauth(server, adminToken, o.ADMIN_PASSWORD);
    const merged = await as('admin').post(`${ADMIN_ARTISTS}/${survivor}/merge`, {
      loserId: id,
      survivorUpdatedAt: await tokenOf(survivor),
      loserUpdatedAt: await tokenOf(id),
      acceptedFestivals: 2,
    });
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    const row = (await suggestions(id))[0];
    assert.deepEqual([row.status, row.note], ['rejected', 'The artist was merged into another artist.']);
  });

  test('verify marks an artist verified without moving its edit token', async () => {
    const id = await seedArtist({ name: 'Verify Me', verified: false });
    const before = await tokenOf(id);
    const res = await as('admin').post(`${ADMIN_ARTISTS}/${id}/verify`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await artistRow(id)).verified, true);
    assert.equal(await tokenOf(id), before);
    assert.equal((await as('admin').post(`${ADMIN_ARTISTS}/ten-no-such/verify`)).status, 404);
  });
});

describe('a festival save and a lineup import resolve names for an organizer', { skip }, () => {
  const put = (token: string, id: string, body: object) => o.as(server, token).put(`${MANAGE}/${id}`, { expectedUpdatedAt: FAR_FUTURE, ...body });
  const day = (sets: Array<{ id: string; artists: object[] }>) => ({
    stages: [{ id: 'main', name: 'Main' }],
    days: [{ label: 'Fri', date: '2027-06-04', sets: sets.map((s) => ({ ...s, artist: s.artists.map((a: any) => a.name).join(' b2b '), stageId: 'main' })) }],
  });
  const savedSets = async (festivalId: string) =>
    (await sql('SELECT id, artists FROM festival_sets WHERE festival_id = $1', [festivalId])).rows as Array<{ id: string; artists: any[] }>;
  // A member's save renames the set ids it did not hold, so a saved element is found by its name.
  const element = (rows: Array<{ id: string; artists: any[] }>, name: string) => rows.flatMap((r) => r.artists).find((a) => a.name === name);

  test('a save links what the organizer may see, never a hidden artist, and gives a clashing new name a neutral note', async () => {
    const hidden = await seedArtist({ name: 'Save Hidden' });
    await festival('fs-b', 'org-b', false, [{ id: hidden, name: 'Save Hidden' }]);
    const verified = await seedArtist({ name: 'Save Verified' });
    const unverified = await seedArtist({ name: 'Save Unverified', verified: false });
    await festival('fs-live', 'org-b', true, [{ id: verified, name: 'Save Verified' }, { id: unverified, name: 'Save Unverified' }]);

    const res = await put(users.editorA.token, 'f-a', day([
      { id: 'sv-1', artists: [{ name: 'Save Hidden' }] },
      { id: 'sv-2', artists: [{ name: 'Save Verified' }] },
      { id: 'sv-3', artists: [{ name: 'Save Unverified' }] },
      { id: 'sv-4', artists: [{ name: 'Save Brand New' }] },
      { id: 'sv-5', artists: [{ id: hidden, name: 'Other Name' }] },
    ]));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = await savedSets('f-a');
    const first = element(rows, 'Save Hidden');
    assert.ok(first.id && first.id !== hidden, 'a hidden artist is not linked');
    const fresh = await artistRow(first.id);
    assert.deepEqual([fresh.name, fresh.label, fresh.label_auto, fresh.verified, fresh.created_by], ['Save Hidden', 'unnamed 1', true, false, users.editorA.id]);
    assert.equal(element(rows, 'Save Verified').id, verified, 'a verified visible artist links by name');
    assert.equal(element(rows, 'Save Unverified').id, undefined, 'a visible unverified artist of another tenant is picked by hand');
    const brandNew = await artistRow(element(rows, 'Save Brand New').id);
    assert.deepEqual([brandNew.verified, brandNew.label, brandNew.label_auto], [false, '', false]);
    const spoofed = element(rows, 'Other Name');
    assert.ok(spoofed.id && spoofed.id !== hidden && spoofed.name === 'Other Name', 'a sent id of a hidden artist is unknown');
    const hiddenUse = await sql(`SELECT count(*)::int AS n FROM festival_sets WHERE artists @> $1::jsonb`, [JSON.stringify([{ id: hidden }])]);
    assert.equal(hiddenUse.rows[0].n, 0);

    // The checklist counts the name to pick; picking it by id links it.
    const view = await as('editorA').get(`${MANAGE}/f-a`);
    assert.equal(view.body.data.checklist.find((item: any) => item.key === 'artists').status, 'warn');
    const picked = await put(users.editorA.token, 'f-a', day([{ id: 'sv-3', artists: [{ id: unverified, name: 'Save Unverified' }] }]));
    assert.equal(picked.status, 200, JSON.stringify(picked.body));
    assert.equal(element(await savedSets('f-a'), 'Save Unverified').id, unverified);
  });

  test('once an admin verifies the artist, a name links to it', async () => {
    const id = await seedArtist({ name: 'Verify Then Link', verified: false });
    await festival('fs-vl', 'org-b', true, [{ id, name: 'Verify Then Link' }]);
    const body = day([{ id: 'sv-vl', artists: [{ name: 'Verify Then Link' }] }]);
    await put(users.editorA.token, 'f-a', body);
    assert.equal(element(await savedSets('f-a'), 'Verify Then Link').id, undefined);
    assert.equal((await as('admin').post(`${ADMIN_ARTISTS}/${id}/verify`)).status, 200);
    await put(users.editorA.token, 'f-a', body);
    assert.equal(element(await savedSets('f-a'), 'Verify Then Link').id, id);
  });

  test('a new festival drops artist ids from the client, so a draft never lands on another tenant artist', async () => {
    const hidden = await seedArtist({ name: 'Strip Hidden' });
    await festival('fs-strip', 'org-b', false, [{ id: hidden, name: 'Strip Hidden' }]);
    const res = await as('ownerA').post(MANAGE, {
      organizationId: 'org-a',
      name: 'Strip Fest',
      location: 'Orlando, FL',
      timeZone: 'America/New_York',
      lineup: [{ artists: [{ id: hidden, name: 'Strip Hidden' }] }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const stored = (await sql('SELECT lineup FROM festivals WHERE id = $1', [res.body.data.id])).rows[0].lineup;
    assert.equal(stored[0].artists[0].id, undefined);
    const users_ = await sql(`SELECT count(*)::int AS n FROM festivals WHERE lineup @> $1::jsonb`, [JSON.stringify([{ artists: [{ id: hidden }] }])]);
    assert.equal(users_.rows[0].n, 1, 'only the tenant that owns the artist lists it');
  });

  test('the lineup import preview and commit use the same visibility', async () => {
    const hidden = await seedArtist({ name: 'Import Hidden' });
    await festival('fi-b', 'org-b', false, [{ id: hidden, name: 'Import Hidden' }]);
    const unverified = await seedArtist({ name: 'Import Unverified', verified: false });
    const verified = await seedArtist({ name: 'Import Verified' });
    await festival('fi-live', 'org-b', true, [{ id: unverified, name: 'Import Unverified' }, { id: verified, name: 'Import Verified' }]);

    const rows = ['Import Hidden', 'Import Unverified', 'Import Verified'].map((artist, index) => ({
      row: index + 1, artist, day: 'Friday', date: '2027-06-04', stage: 'Main', startTime: `1${index}:00`, endTime: `1${index}:45`,
    }));
    const preview = await as('editorA').post(`${MANAGE}/f-a/import-lineup/preview`, { rows, skipSpotify: true });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(
      preview.body.data.rows.map((r: any) => r.resolutions[0].outcome),
      ['new', 'needs_choice', 'existing'],
    );
    assert.doesNotMatch(JSON.stringify(preview.body), new RegExp(hidden));

    const commit = await as('editorA').post(`${MANAGE}/f-a/import-lineup`, { rows: [rows[0]!, rows[2]!], skipSpotify: true });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    assert.equal(commit.body.data.committed, true, JSON.stringify(commit.body));
    const sets = (await sql(`SELECT artists FROM festival_sets WHERE festival_id = 'f-a' AND artist IN ('Import Hidden', 'Import Verified')`)).rows;
    const ids = sets.map((s: any) => s.artists[0].id);
    assert.ok(ids.includes(verified) && !ids.includes(hidden));
    const own = await artistRow(ids.find((id: string) => id !== verified));
    assert.deepEqual([own.label, own.label_auto, own.verified], ['unnamed 1', true, false]);
  });

  test('the set link route sends a member Spotify link to review and leaves the artist alone', async () => {
    const id = await seedArtist({ name: 'Setlink Act', createdBy: users.editorA.id });
    await sql(`UPDATE festivals SET lineup = '[]'::jsonb WHERE id = 'f-a'`);
    const saved = await put(users.editorA.token, 'f-a', day([{ id: 'sv-link', artists: [{ id, name: 'Setlink Act' }] }]));
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const setId = (await sql(`SELECT id FROM festival_sets WHERE festival_id = 'f-a' LIMIT 1`)).rows[0].id;
    const res = await as('editorA').put(`${MANAGE}/f-a/sets/${setId}/link`, { linkUrl: SPOTIFY });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.suggested, true);
    assert.deepEqual((await artistRow(id)).links, {});
    assert.equal((await suggestions(id)).length, 1);
    assert.deepEqual((await suggestions(id))[0].changes, { spotifyLink: SPOTIFY });
  });
});

describe('rows of the new tables when a festival or a user goes away', { skip }, () => {
  test('a purged festival takes its suggestions, and a deleted user leaves them with no author', async () => {
    const id = await seedArtist({ name: 'Purge Artist' });
    await festival('fp-gone', 'org-a', false, [{ id, name: 'Purge Artist' }]);
    const author = await o.makeUser(server, `purge-author-${Date.now()}`);
    const insert = (suggestionId: string, festivalId: string | null) =>
      sql(`INSERT INTO artist_suggestions (id, artist_id, festival_id, organization_id, changes, created_by) VALUES ($1, $2, $3, 'org-a', '{"label":"x"}'::jsonb, $4)`, [suggestionId, id, festivalId, author.id]);
    await insert('sug-purge-1', 'fp-gone');
    await insert('sug-purge-2', null);
    await sql('DELETE FROM festivals WHERE id = $1', ['fp-gone']);
    assert.deepEqual((await suggestions(id)).map((row: any) => row.id), ['sug-purge-2']);
    // The account hard delete the retention job and the admin delete use.
    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      await createUsersStore(pool, createUtils(pool)).hardDelete(author.id);
    } finally {
      await pool.end();
    }
    assert.equal((await suggestions(id))[0].created_by, null);
    // The artist outlives its suggestions: no hard delete of an artist with one.
    await assert.rejects(sql('DELETE FROM artists WHERE id = $1', [id]), /foreign key|violates/i);
  });
});
