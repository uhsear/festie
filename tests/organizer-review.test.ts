import 'dotenv/config';
/**
 * Review, publish requests and held alerts for organizations (plan-v3 4.3, 5.9, 6.1 to 6.3, master plan C10).
 * Runs the real app on the throwaway test database.
 *
 * Covers: submit for review with names only (C10) while publish still needs dated days; who may submit,
 * withdraw, publish; the admin decline with a note and the approve; the review queue and the release and
 * discard of held alerts; no organizer reaches a route that sends to attendees; the URL allowlists;
 * the 409 for a second editor with a display name instead of a username.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { TEST_DATABASE_URL, skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

const MANAGE = '/api/v1/manage/festivals';
const ADMIN = '/api/v1/admin/festivals';
const QUEUE = '/api/v1/admin/organizations';
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

async function boot() {
  const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
  servers.push(server);
  const users = await o.seedScenario(server);
  const adminToken = await h.loginAdmin(server);
  return { server, users, adminToken };
}

const namesOnly = (organizationId: string, name = 'Names Fest') => ({
  organizationId,
  name,
  location: 'Orlando, FL',
  timeZone: 'America/New_York',
  lineup: [{ artists: [{ name: 'Alpha' }] }, { artists: [{ name: 'Beta' }] }],
});

const dated = (organizationId: string, name = 'Dated Fest') => ({
  organizationId,
  name,
  location: 'Orlando, FL',
  timeZone: 'America/New_York',
  stages: [{ id: 'main', name: 'Main' }],
  days: [{ label: 'Friday', date: '2027-06-04', sets: [{ id: 'set-alpha', artist: 'Alpha', stageId: 'main', startTime: '20:00', endTime: '21:00' }] }],
});

async function create(server: any, token: string, body: unknown) {
  const res = await o.as(server, token).post(MANAGE, body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.id as string;
}

const row = async (server: any, id: string) =>
  (await o.sql(server, 'SELECT published_at, publish_requested_at, publish_review_note FROM festivals WHERE id = $1', [id])).rows[0];
const auditRows = async (server: any, action: string, id: string) =>
  (await o.sql(server, 'SELECT actor_type, organization_id, details_json FROM audit_log WHERE action = $1 AND target_id = $2', [action, id])).rows;

describe('submit for review', { skip }, () => {
  test('names only goes to review (C10), and publish still refuses until the days are dated', async () => {
    const { server, users, adminToken } = await boot();
    const id = await create(server, users.ownerA.token, namesOnly('org-a'));
    const submitted = await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish-request`);
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.ok(submitted.body.data.requestedAt);
    assert.equal(submitted.body.data.checklist.find((item: any) => item.key === 'days').status, 'todo');
    assert.ok((await row(server, id)).publish_requested_at);

    const publish = await o.as(server, adminToken).post(`${ADMIN}/${id}/publish`);
    assert.equal(publish.status, 409);
    assert.equal(publish.body.error.code, 'PUBLISH_BLOCKED');
    assert.equal((await row(server, id)).published_at, null);

    // A second submit keeps the first time and writes no second audit row.
    const again = await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish-request`);
    assert.equal(again.body.data.requestedAt, submitted.body.data.requestedAt);
    const audits = await auditRows(server, 'festival.publish_requested', id);
    assert.equal(audits.length, 1);
    assert.deepEqual([audits[0].actor_type, audits[0].organization_id], ['organizer', 'org-a']);
  });

  test('a festival with no time zone cannot be submitted, and nothing is marked', async () => {
    const { server, users } = await boot();
    const res = await o.as(server, users.ownerA.token).post(`${MANAGE}/f-a/publish-request`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PUBLISH_BLOCKED');
    assert.equal((await row(server, 'f-a')).publish_requested_at, null);
  });

  test('only an owner of an active organization submits; a live festival and another tenant are refused', async () => {
    const { server, users } = await boot();
    const cells: Array<[string, string, number]> = [
      ['editorA', 'f-a', 403],
      ['viewerA', 'f-a', 403],
      ['ownerB', 'f-a', 404],
      ['stranger', 'f-a', 404],
      ['unconfirmed', 'f-a', 404],
      ['ownerP', 'f-p', 403],
      ['ownerS', 'f-s', 403],
      ['ownerA', 'f-a-live', 409],
      ['ownerA', 'f-b', 404],
      ['ownerA', 'f-plat', 404],
    ];
    const problems: string[] = [];
    for (const [who, festival, want] of cells) {
      const res = await o.as(server, (users as any)[who].token).post(`${MANAGE}/${festival}/publish-request`);
      if (res.status !== want) problems.push(`${who} ${festival}: got ${res.status}, want ${want}`);
    }
    assert.deepEqual(problems, []);
    assert.equal((await o.as(server, users.ownerA.token).post(`${MANAGE}/f-a/publish-request`).set('x-user-token', '')).status, 401);
  });

  test('withdraw: an owner takes a waiting request back once; nothing waiting is 409', async () => {
    const { server, users } = await boot();
    const id = await create(server, users.ownerA.token, namesOnly('org-a'));
    await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish-request`).expect(200);
    assert.equal((await o.as(server, users.editorA.token).delete(`${MANAGE}/${id}/publish-request`)).status, 403);
    assert.equal((await o.as(server, users.ownerB.token).delete(`${MANAGE}/${id}/publish-request`)).status, 404);
    assert.equal((await o.as(server, users.ownerA.token).delete(`${MANAGE}/${id}/publish-request`)).status, 200);
    assert.equal((await row(server, id)).publish_requested_at, null);
    assert.equal((await o.as(server, users.ownerA.token).delete(`${MANAGE}/${id}/publish-request`)).status, 409);
    assert.equal((await auditRows(server, 'festival.publish_withdrawn', id)).length, 1);
  });
});

describe('the admin decision', { skip }, () => {
  test('decline keeps the draft, stores the note for the owners, and a new submit clears it', async () => {
    const { server, users, adminToken } = await boot();
    const id = await create(server, users.ownerA.token, namesOnly('org-a'));
    assert.equal((await o.as(server, adminToken).post(`${ADMIN}/${id}/publish/decline`, { note: 'Add the venue address' })).status, 409, 'no request is waiting yet');
    await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish-request`).expect(200);

    assert.equal((await o.as(server, adminToken).post(`${ADMIN}/${id}/publish/decline`, {})).status, 400, 'a note is required');
    assert.equal((await o.as(server, users.ownerA.token).post(`${ADMIN}/${id}/publish/decline`, { note: 'x' })).status, 403);
    assert.equal((await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish/decline`, { note: 'x' })).status, 404);

    const declined = await o.as(server, adminToken).post(`${ADMIN}/${id}/publish/decline`, { note: 'Add the venue address' });
    assert.equal(declined.status, 200);
    const state = await row(server, id);
    assert.deepEqual([state.published_at, state.publish_requested_at, state.publish_review_note], [null, null, 'Add the venue address']);
    const [audit] = await auditRows(server, 'festival.publish_declined', id);
    assert.equal(audit.actor_type, 'admin');

    const seen = await o.as(server, users.ownerA.token).get(`${MANAGE}/${id}`);
    assert.equal(seen.body.data.publishReviewNote, 'Add the venue address');
    assert.equal(seen.body.data.publishRequestedAt, null);
    const listed = (await o.as(server, users.ownerA.token).get(MANAGE)).body.data.find((f: any) => f.id === id);
    assert.equal(listed.publishReviewNote, 'Add the venue address');
    assert.equal((await o.as(server, adminToken).post(`${ADMIN}/${id}/publish/decline`, { note: 'again' })).status, 409, 'one decision per request');

    await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish-request`).expect(200);
    const resubmitted = await row(server, id);
    assert.equal(resubmitted.publish_review_note, null);
    assert.ok(resubmitted.publish_requested_at);
  });

  test('approve: the admin publishes a request, which clears it and goes live', async () => {
    const { server, users, adminToken } = await boot();
    const id = await create(server, users.ownerA.token, dated('org-a'));
    await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish-request`).expect(200);
    const queue = (await o.as(server, adminToken).get(`${QUEUE}/review-queue`)).body.data;
    assert.deepEqual(queue.requests.map((r: any) => [r.festivalId, r.organizationName, r.verified]), [[id, 'Org org-a', false]]);

    const published = await o.as(server, adminToken).post(`${ADMIN}/${id}/publish`);
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const state = await row(server, id);
    assert.ok(state.published_at);
    assert.deepEqual([state.publish_requested_at, state.publish_review_note], [null, null]);
    assert.equal((await o.as(server, adminToken).get(`${QUEUE}/review-queue`)).body.data.requests.length, 0);
    assert.equal((await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish-request`)).status, 409, 'live now');
  });

  test('unverified organizations cannot publish directly, verified ones can, editors never', async () => {
    const { server, users } = await boot();
    const id = await create(server, users.ownerA.token, dated('org-a'));
    const refused = await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish`);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error.message, /Submit this festival for review/);
    assert.equal((await row(server, id)).published_at, null);
    assert.equal((await o.as(server, users.editorA.token).post(`${MANAGE}/${id}/publish`)).status, 403);

    // The owner marks the organization verified; its owner now publishes without review.
    await o.sql(server, "UPDATE organizations SET verified_at = NOW() WHERE id = 'org-a'");
    assert.equal((await o.as(server, users.editorA.token).post(`${MANAGE}/${id}/publish`)).status, 403, 'an editor still cannot');
    const direct = await o.as(server, users.ownerA.token).post(`${MANAGE}/${id}/publish`);
    assert.equal(direct.status, 200, JSON.stringify(direct.body));
    assert.ok((await row(server, id)).published_at);
    const [audit] = await auditRows(server, 'festival.published', id);
    assert.deepEqual([audit.actor_type, audit.organization_id], ['organizer', 'org-a']);

    // Direct publish still needs dated days.
    const undated = await create(server, users.ownerA.token, namesOnly('org-a', 'Undated'));
    assert.equal((await o.as(server, users.ownerA.token).post(`${MANAGE}/${undated}/publish`)).status, 409);
  });

  test('a pending or suspended organization cannot publish even if it is verified', async () => {
    const { server, users } = await boot();
    await o.sql(server, "UPDATE organizations SET verified_at = NOW() WHERE id IN ('org-p', 'org-s')");
    assert.equal((await o.as(server, users.ownerP.token).post(`${MANAGE}/f-p/publish`)).status, 403);
    assert.equal((await o.as(server, users.ownerS.token).post(`${MANAGE}/f-s/publish`)).status, 403);
  });
});

describe('held alerts: the review queue, release and discard', { skip }, () => {
  const hold = (server: any, festival: string, setId: string, people: string[]) =>
    o.sql(
      server,
      `INSERT INTO festival_held_schedule_changes (festival_id, set_id, kind, artist, before_slot, after_slot, picker_ids)
       VALUES ($1, $2, 'moved', 'Alpha', '{"dayKey":"d","dayLabel":"D","startTime":"20:00","endTime":null,"stageId":null,"stageName":null}',
               '{"dayKey":"d","dayLabel":"D","startTime":"21:00","endTime":null,"stageId":null,"stageName":null}', $3::text[])`,
      [festival, setId, people],
    );

  test('the queue lists what is held, release sends once and empties it, discard drops it', async () => {
    const { server, users, adminToken } = await boot();
    await hold(server, 'f-a-live', 's1', ['u1', 'u2']);
    await hold(server, 'f-a-live', 's2', ['u2']);
    await hold(server, 'f-b', 's3', ['u9']);
    const queue = (await o.as(server, adminToken).get(`${QUEUE}/review-queue`)).body.data;
    assert.deepEqual(
      queue.held.map((r: any) => [r.festivalId, r.organizationName, r.changes, r.people]).sort(),
      [['f-a-live', 'Org org-a', 2, 2], ['f-b', 'Org org-b', 1, 1]],
    );

    // An organizer, an owner among them, reaches neither list nor release.
    for (const who of ['ownerA', 'editorA', 'stranger']) {
      const token = (users as any)[who].token;
      assert.equal((await o.as(server, token).get(`${QUEUE}/review-queue`)).status, 403, who);
      assert.equal((await o.as(server, token).post(`${QUEUE}/held-alerts/f-a-live/release`)).status, 403, who);
      assert.equal((await o.as(server, token).delete(`${QUEUE}/held-alerts/f-a-live`)).status, 403, who);
      assert.equal((await o.as(server, token).post(`/api/v1/manage/held-alerts/f-a-live/release`)).status, 404, who);
    }

    const released = await o.as(server, adminToken).post(`${QUEUE}/held-alerts/f-a-live/release`);
    assert.equal(released.status, 200, JSON.stringify(released.body));
    assert.deepEqual(released.body.data, { released: 2, people: 2 });
    assert.equal((await o.as(server, adminToken).post(`${QUEUE}/held-alerts/f-a-live/release`)).status, 404, 'a second press sends nothing');
    const [audit] = await auditRows(server, 'festival.alert_released', 'f-a-live');
    assert.deepEqual([audit.actor_type, audit.organization_id], ['admin', 'org-a']);

    const discarded = await o.as(server, adminToken).delete(`${QUEUE}/held-alerts/f-b`);
    assert.deepEqual(discarded.body.data, { discarded: 1 });
    assert.equal((await o.sql(server, 'SELECT 1 FROM festival_held_schedule_changes')).rowCount, 0);
    assert.equal((await auditRows(server, 'festival.alert_discarded', 'f-b')).length, 1);
  });
});

describe('which routes that send to attendees an organizer reaches', { skip }, () => {
  test('no organizer key to the admin mount, the days alert or the set-time releases; the trust-tier routes follow role and verification', async () => {
    const { server, users } = await boot();
    await o.sql(server, "UPDATE organizations SET verified_at = NOW() WHERE id = 'org-a'");
    const routes: Array<[string, string]> = [
      ['POST', 'announcements'],
      ['POST', 'lineup-announcement'],
      ['GET', 'lineup-announcement'],
      ['POST', 'days-announcement'],
      ['POST', 'time-releases'],
      ['GET', 'time-releases'],
    ];
    // The set-time and days alerts are Festie's alone: 404 on manage for everyone, verified or not.
    const staysAdmin = new Set(['days-announcement', 'time-releases']);
    // A verified owner reaches the rest: an empty announcement is a 400, the lineup count is a 200 and a send with
    // nobody to tell is a 400. An editor has the role for none of them.
    const ownerOnManage: Record<string, number> = { 'POST announcements': 400, 'POST lineup-announcement': 400, 'GET lineup-announcement': 200 };
    const problems: string[] = [];
    for (const who of ['ownerA', 'editorA']) {
      const caller = o.as(server, (users as any)[who].token);
      for (const [method, path] of routes) {
        const call = (url: string) => (method === 'GET' ? caller.get(url) : caller.post(url, {}));
        const onAdmin = await call(`${ADMIN}/f-a-live/${path}`);
        const onManage = await call(`${MANAGE}/f-a-live/${path}`);
        const want = staysAdmin.has(path) ? 404 : who === 'editorA' ? 403 : ownerOnManage[`${method} ${path}`];
        if (onAdmin.status !== 403) problems.push(`${who} ${method} admin ${path}: ${onAdmin.status}`);
        if (onManage.status !== want) problems.push(`${who} ${method} manage ${path}: ${onManage.status}, want ${want}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});

describe('links, hosting and live edits', { skip }, () => {
  const put = (server: any, token: string, id: string, body: any) => o.as(server, token).put(`${MANAGE}/${id}`, { expectedUpdatedAt: FAR_FUTURE, ...body });
  const withArtist = (links: Record<string, string>) => ({
    stages: [{ id: 'main', name: 'Main' }],
    days: [{ label: 'Fri', date: '2027-06-04', sets: [{ id: 'set-alpha', artist: 'Alpha', artists: [{ name: 'Alpha', links }], stageId: 'main' }] }],
  });
  const rejected = (res: any, path: RegExp) => {
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.error.issues.some((issue: any) => path.test(issue.path)), JSON.stringify(res.body.error.issues));
  };

  test('an organizer link must be a profile on its platform over https; an admin save keeps the wider rule', async () => {
    const { server, users, adminToken } = await boot();
    const ok = await put(server, users.editorA.token, 'f-a', withArtist({ instagram: 'https://www.instagram.com/alpha' }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    rejected(await put(server, users.editorA.token, 'f-a', withArtist({ instagram: 'https://evil.example/alpha' })), /artists\.0\.links\.instagram/);
    rejected(await put(server, users.editorA.token, 'f-a', withArtist({ spotify: 'https://open.spotify.com/track/abc' })), /links\.spotify/);
    rejected(await put(server, users.editorA.token, 'f-a', withArtist({ website: 'https://www.instagram.com/alpha' })), /links\.website/);
    // The same body from an admin is not rejected by these rules.
    const admin = await o.as(server, adminToken).put(`/api/v1/admin/festivals/f-a`, withArtist({ instagram: 'https://evil.example/alpha' }));
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
  });

  test('the legacy set linkUrl follows the same https and platform rule for an organizer', async () => {
    const { server, users, adminToken } = await boot();
    const withLinkUrl = (linkUrl: string) => ({
      stages: [{ id: 'main', name: 'Main' }],
      days: [{ label: 'Fri', date: '2027-06-04', sets: [{ id: 'set-alpha', artist: 'Alpha', linkUrl, stageId: 'main' }] }],
    });
    rejected(await put(server, users.editorA.token, 'f-a', withLinkUrl('javascript:alert(1)')), /sets\.0\.linkUrl/);
    rejected(await put(server, users.editorA.token, 'f-a', withLinkUrl('http://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb')), /sets\.0\.linkUrl/);
    rejected(await put(server, users.editorA.token, 'f-a', withLinkUrl('https://evil.example/alpha')), /sets\.0\.linkUrl/);
    const ok = await put(server, users.editorA.token, 'f-a', withLinkUrl('https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb'));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // New festival: the create route runs the same rules.
    const created = await o.as(server, users.ownerA.token).post(MANAGE, { ...dated('org-a', 'Linked'), days: withLinkUrl('http://evil.example/x').days });
    rejected(created, /sets\.0\.linkUrl/);
    // An admin save keeps the wider rule.
    const admin = await o.as(server, adminToken).put(`/api/v1/admin/festivals/f-a`, withLinkUrl('https://evil.example/alpha'));
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
  });

  test('the offline map and the site plan must be files Festie hosts', async () => {
    const { server, users } = await boot();
    const map = (extra: object) => ({ mapConfig: { version: 1, ...extra } });
    rejected(await put(server, users.editorA.token, 'f-a', map({ offlineBasemap: { pmtilesUrl: 'https://cdn.example/a.pmtiles' } })), /pmtilesUrl/);
    rejected(await put(server, users.editorA.token, 'f-a', map({ offlineBasemap: { pmtilesUrl: 'https://festie.us/uploads/basemaps/../../secret.pmtiles' } })), /pmtilesUrl/);
    const plan = { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], opacity: 1 };
    rejected(await put(server, users.editorA.token, 'f-a', map({ siteplan: { imageUrl: 'https://evil.example/plan.webp', ...plan } })), /imageUrl/);
    const hosted = await put(server, users.editorA.token, 'f-a', map({ offlineBasemap: { pmtilesUrl: 'https://festie.us/uploads/basemaps/fest.pmtiles' }, siteplan: { imageUrl: 'https://festie.us/uploads/siteplans/p.webp', ...plan } }));
    assert.equal(hosted.status, 200, JSON.stringify(hosted.body));
  });

  test('create applies the same rules, and the set-link route takes only a Spotify artist link', async () => {
    const { server, users } = await boot();
    const bad = await o.as(server, users.ownerA.token).post(MANAGE, { ...namesOnly('org-a'), lineup: [{ artists: [{ name: 'Alpha', links: { soundcloud: 'https://evil.example/a' } }] }] });
    rejected(bad, /lineup\.0\.artists\.0\.links\.soundcloud/);
    const link = (url: string) => o.as(server, users.editorA.token).put(`${MANAGE}/f-a/sets/x1/link`, { linkUrl: url });
    assert.equal((await link('https://evil.example/a')).status, 400);
    assert.equal((await link('https://open.spotify.com/album/abc')).status, 400);
    assert.equal((await link('https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg')).status, 404, 'past the rule, the set does not exist');
  });

  test('an organizer Spotify link on a set artist is a suggestion, whoever else lists the artist', async () => {
    const { server, users, adminToken } = await boot();
    const festival = (setId: string, artist: string) => ({
      stages: [{ id: 'main', name: 'Main' }],
      days: [{ label: 'Fri', date: '2027-06-04', sets: [{ id: setId, artist, artists: [{ name: artist, links: {} }], stageId: 'main' }] }],
    });
    const link = { linkUrl: 'https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg' };
    // The admin puts one artist on a festival of A and on a festival of B, so one artists row backs both sets.
    await o.as(server, adminToken).put(`${ADMIN}/f-a`, festival('sa-shared', 'Shared Act')).expect(200);
    await o.as(server, adminToken).put(`${ADMIN}/f-b`, festival('sb-shared', 'Shared Act')).expect(200);
    const ids = await o.sql(server, "SELECT DISTINCT artists->0->>'id' AS id FROM festival_sets WHERE id = ANY($1)", [['sa-shared', 'sb-shared']]);
    assert.equal(ids.rows.length, 1, 'both sets carry the same artist id');
    const artistId = ids.rows[0].id;

    const shared = await o.as(server, users.editorA.token).put(`${MANAGE}/f-a/sets/sa-shared/link`, link);
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.equal(shared.body.data.suggested, true);

    // Once only festivals of A list the artist, the Spotify link is still a suggestion: only an admin writes it.
    await o.as(server, adminToken).put(`${ADMIN}/f-b`, festival('sb-other', 'Other Act')).expect(200);
    const sole = await o.as(server, users.editorA.token).put(`${MANAGE}/f-a/sets/sa-shared/link`, link);
    assert.equal(sole.status, 200, JSON.stringify(sole.body));
    assert.equal(sole.body.data.suggested, true);
    const stored = await o.sql(server, 'SELECT links, spotify_id FROM artists WHERE id = $1', [artistId]);
    assert.deepEqual([stored.rows[0].links, stored.rows[0].spotify_id], [{}, null], 'the artist row is untouched');
    const pending = await o.sql(server, "SELECT organization_id FROM artist_suggestions WHERE artist_id = $1 AND status = 'pending'", [artistId]);
    assert.deepEqual(pending.rows.map((r: any) => r.organization_id), ['org-a']);
  });

  test('a live festival keeps its name and place until the organization is verified', async () => {
    const { server, users } = await boot();
    const rename = (token: string) => put(server, token, 'f-a-live', { name: 'Brand New Name' });
    const refused = await rename(users.ownerA.token);
    assert.equal(refused.status, 403);
    assert.match(refused.body.error.message, /Ask Festie/);
    const typo = await put(server, users.editorA.token, 'f-a-live', { stages: [{ id: 'main', name: 'Main Stage' }] });
    assert.equal(typo.status, 200, 'stage and artist names stay editable');
    await o.sql(server, "UPDATE organizations SET verified_at = NOW() WHERE id = 'org-a'");
    assert.equal((await rename(users.ownerA.token)).status, 200);
  });
});

describe('two editors at once, and names in organizer-visible lists', { skip }, () => {
  test('a save with no version is 400; the second save of a pair is 409 with the first editor display name and time', async () => {
    const { server, users } = await boot();
    await o.sql(server, "UPDATE users SET display_name = 'Alex' WHERE id = $1", [users.editorA.id]);
    const opened = (await o.as(server, users.ownerA.token).get(`${MANAGE}/f-a`)).body.data;
    assert.equal((await o.as(server, users.ownerA.token).put(`${MANAGE}/f-a`, { stages: [] })).status, 400);

    await o.as(server, users.editorA.token).put(`${MANAGE}/f-a`, { stages: [{ id: 'main', name: 'Main' }], expectedUpdatedAt: opened.updatedAt }).expect(200);
    const stale = await o.as(server, users.ownerA.token).put(`${MANAGE}/f-a`, { stages: [{ id: 'side', name: 'Side' }], expectedUpdatedAt: opened.updatedAt });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'FESTIVAL_CHANGED');
    assert.equal(stale.body.error.updatedBy, 'Alex at Org org-a');
    assert.ok(new Date(stale.body.error.updatedAt).getTime() > new Date(opened.updatedAt).getTime());
    assert.doesNotMatch(JSON.stringify(stale.body), new RegExp(users.editorA.username));
  });

  test('no organizer response shows an attendee username: teammates read as a display name, anyone else as Festie support', async () => {
    const { server, users, adminToken } = await boot();
    await o.sql(server, "UPDATE users SET display_name = 'Alex' WHERE id = $1", [users.editorA.id]);
    const opened = (await o.as(server, users.ownerA.token).get(`${MANAGE}/f-a`)).body.data;
    await o.as(server, users.editorA.token).put(`${MANAGE}/f-a`, { stages: [{ id: 'main', name: 'Main' }], expectedUpdatedAt: opened.updatedAt }).expect(200);
    const afterEditor = await o.as(server, users.ownerA.token).get(`${MANAGE}/f-a`);
    assert.equal(afterEditor.body.data.updatedByUsername, 'Alex at Org org-a');

    await o.as(server, adminToken).put(`${ADMIN}/f-a`, { stages: [{ id: 'main', name: 'Main' }] }).expect(200);
    const afterAdmin = await o.as(server, users.ownerA.token).get(`${MANAGE}/f-a`);
    assert.equal(afterAdmin.body.data.updatedByUsername, 'Festie support');

    // A teammate with no display name is "A teammate", never the handle.
    await o.sql(server, 'UPDATE users SET display_name = NULL WHERE id = $1', [users.editorA.id]);
    const fresh = (await o.as(server, users.ownerA.token).get(`${MANAGE}/f-a`)).body.data;
    await o.as(server, users.editorA.token).put(`${MANAGE}/f-a`, { stages: [{ id: 'main', name: 'Main 2' }], expectedUpdatedAt: fresh.updatedAt }).expect(200);
    const unnamed = await o.as(server, users.ownerA.token).get(`${MANAGE}/f-a`);
    assert.equal(unnamed.body.data.updatedByUsername, 'A teammate at Org org-a');
    for (const text of [JSON.stringify(unnamed.body), JSON.stringify(afterAdmin.body), JSON.stringify(afterEditor.body)]) {
      assert.doesNotMatch(text, new RegExp(users.editorA.username));
      assert.doesNotMatch(text, /"admin"/);
    }
  });

  test('import history reads the same: a teammate as a display name, an admin as Festie support', async () => {
    const { server, users, adminToken } = await boot();
    await o.sql(server, "UPDATE users SET display_name = 'Alex' WHERE id = $1", [users.editorA.id]);
    const rows = (artist: string) => ({ rows: [{ row: 2, artist }], skipSpotify: true });
    const mine = await o.as(server, users.editorA.token).post(`${MANAGE}/f-a/import-lineup`, rows('Mira'));
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    const theirs = await o.as(server, adminToken).post(`${ADMIN}/f-a/import-lineup`, rows('Kai'));
    assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
    const seen = (await o.as(server, users.ownerA.token).get(`${MANAGE}/f-a/imports`)).body.data.imports.map((i: any) => i.createdBy).sort();
    assert.deepEqual(seen, ['Alex at Org org-a', 'Festie support']);
    const asAdmin = (await o.as(server, adminToken).get(`${ADMIN}/f-a/imports`)).body.data.imports.map((i: any) => i.createdBy);
    assert.ok(asAdmin.includes(users.editorA.username), 'an admin still sees the account name');
  });
});
