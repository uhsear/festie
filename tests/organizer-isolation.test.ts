import 'dotenv/config';
/**
 * Tenant isolation on the /manage mount: a member of organization A never reads or writes organization B or a
 * platform festival, through any listed route or any list endpoint, and never learns an admin's username.
 * Needs TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});
after(() => {
  if (skip) console.log('organizer-isolation: skipped (TEST_DATABASE_URL not set)');
});

const MANAGE = '/api/v1/manage';
// A member's save names the version it started from. A far-future token is never stale.
const FAR_FUTURE = '2999-01-01T00:00:00.000Z';

async function boot() {
  const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
  servers.push(server);
  const users = await o.seedScenario(server);
  const adminToken = await h.loginAdmin(server);
  const adminName = (await o.sql(server, "SELECT u.username FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'")).rows[0].username;
  // Organization B and the platform each hold a festival with a set, so a leak has something to show.
  for (const [festivalId, setId, artist] of [['f-b', 's-b1', 'Secret B Act'], ['f-plat', 's-plat1', 'Secret Platform Act']]) {
    await o.sql(server, "INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, 'main', 'Main', '#ff3366', 0)", [festivalId]);
    await o.sql(server, "INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, 0, 'Friday', '2026-06-05')", [festivalId]);
    await o.sql(
      server,
      "INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, $2, 0, $3, 'main', '10:00', '11:00', 0)",
      [setId, festivalId, artist],
    );
  }
  return { server, users, adminToken, adminName };
}

const SECRETS = ['f-b', 'f-plat', 'Secret B Act', 'Secret Platform Act', 'org-b', 'Org org-b', 's-b1', 's-plat1'];
// Match a secret only as a whole token: a plain substring check finds 'f-b' inside random UUIDs
// (a segment ending in f followed by one starting with b) and fails the test by chance.
// SECRETS hold only letters, digits, spaces and dashes, so they need no regex escaping.
const holdsToken = (text: string, token: string) => new RegExp(`(?<![0-9A-Za-z])${token}(?![0-9A-Za-z])`).test(text);
assert.equal(holdsToken('{"id":"1a2f-b3c4"}', 'f-b'), false);
assert.equal(holdsToken('{"festivalId":"f-b"}', 'f-b'), true);

describe('organizer isolation', { skip }, () => {
  test('an editor of A reads only A: no response of any listed GET holds B or platform data', async () => {
    const { server, users, adminToken } = await boot();
    const editor = o.as(server, users.editorA.token);
    const gets = [
      `${MANAGE}/me`,
      `${MANAGE}/festivals`,
      `${MANAGE}/festivals/f-a`,
      `${MANAGE}/festivals/f-a/imports`,
      `${MANAGE}/festivals/f-a/sets/links`,
      `${MANAGE}/festivals/f-a/impact`,
      `${MANAGE}/festivals/f-b`,
      `${MANAGE}/festivals/f-plat`,
      `${MANAGE}/festivals/f-b/imports`,
      `${MANAGE}/festivals/f-plat/sets/links`,
      `${MANAGE}/festivals/f-b/impact`,
      '/api/v1/auth/me',
      '/api/v1/festivals',
      '/api/v1/festivals/f-b',
      '/api/v1/festivals/f-plat',
    ];
    const problems: string[] = [];
    for (const url of gets) {
      const res = await editor.get(url);
      const text = JSON.stringify(res.body);
      for (const secret of SECRETS) if (holdsToken(text, secret) && !url.includes(secret)) problems.push(`${url} leaks "${secret}"`);
    }
    assert.deepEqual(problems, []);
    // The admin does see them, so the check above can fail.
    assert.match(JSON.stringify((await o.as(server, adminToken).get('/api/v1/admin/festivals')).body), /f-b/);
    assert.match(JSON.stringify((await o.as(server, adminToken).get(`${MANAGE}/festivals/f-b`)).body), /Secret B Act/);
  });

  test('a member of A cannot write B or the platform festival through any listed route, and nothing changes', async () => {
    const { server, users } = await boot();
    const owner = o.as(server, users.ownerA.token);
    await o.reauth(server, users.ownerA.token);
    const attempts: Array<[string, string, unknown?]> = [
      ['put', `${MANAGE}/festivals/f-b`, { name: 'Hijacked' }],
      ['put', `${MANAGE}/festivals/f-plat`, { name: 'Hijacked' }],
      ['delete', `${MANAGE}/festivals/f-b`],
      ['delete', `${MANAGE}/festivals/f-plat`],
      ['post', `${MANAGE}/festivals/f-b/import-lineup`, { rows: [{ row: 1, artist: 'Planted', day: 'Friday', date: '2026-06-05', stage: 'Main' }] }],
      ['post', `${MANAGE}/festivals/f-plat/import-lineup/preview`, { rows: [{ row: 1, artist: 'Planted' }] }],
      ['post', `${MANAGE}/festivals/f-b/imports/x1/undo`, {}],
      ['put', `${MANAGE}/festivals/f-b/sets/s-b1/link`, { linkUrl: 'https://open.spotify.com/artist/abc' }],
      ['post', `${MANAGE}/festivals/f-b/siteplan-image`, {}],
      ['post', `${MANAGE}/festivals/f-b/publish`, {}],
      ['post', `${MANAGE}/festivals`, { organizationId: 'org-b', name: 'Planted' }],
    ];
    for (const [method, url, body] of attempts) {
      const res = await (owner as any)[method](url, ...(body === undefined ? [] : [body]));
      assert.equal(res.status, 404, `${method} ${url} answered ${res.status}`);
    }
    const rows = (await o.sql(server, "SELECT id, name, deleted_at FROM festivals WHERE id = ANY('{f-b,f-plat}') ORDER BY id")).rows;
    assert.deepEqual(rows.map((r: any) => [r.id, r.name, r.deleted_at]), [['f-b', 'Fest f-b', null], ['f-plat', 'Fest f-plat', null]]);
    assert.equal((await o.sql(server, "SELECT 1 FROM festival_sets WHERE festival_id = ANY('{f-b,f-plat}')")).rowCount, 2);
    assert.equal((await o.sql(server, "SELECT 1 FROM festivals WHERE organization_id = 'org-b'")).rowCount, 1, 'no festival was planted in B');
  });

  test('a set id that belongs to another festival is replaced for a member, and the other festival keeps its set', async () => {
    const { server, users, adminToken } = await boot();
    const payload = {
      name: 'Mine',
      expectedUpdatedAt: FAR_FUTURE,
      stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
      days: [{ label: 'Friday', date: '2026-06-05', sets: [{ id: 's-b1', artist: 'Mine', stageId: 'main', startTime: '12:00', endTime: '13:00' }] }],
    };
    const res = await o.as(server, users.editorA.token).put(`${MANAGE}/festivals/f-a`, payload);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const mine = (await o.sql(server, "SELECT id FROM festival_sets WHERE festival_id = 'f-a'")).rows;
    assert.equal(mine.length, 1);
    assert.notEqual(mine[0].id, 's-b1');
    const theirs = (await o.sql(server, "SELECT artist FROM festival_sets WHERE id = 's-b1'")).rows;
    assert.deepEqual(theirs.map((r: any) => r.artist), ['Secret B Act']);

    // An admin keeps today's behavior: the store refuses a set id that another festival holds, so the save fails.
    const admin = await o.as(server, adminToken).put('/api/v1/admin/festivals/f-a', {
      ...payload,
      days: [{ label: 'Friday', date: '2026-06-05', sets: [{ id: 's-b1', artist: 'Mine', stageId: 'main', startTime: '12:00', endTime: '13:00' }] }],
    });
    assert.notEqual(admin.status, 200);
    assert.deepEqual((await o.sql(server, "SELECT artist FROM festival_sets WHERE id = 's-b1'")).rows.map((r: any) => r.artist), ['Secret B Act']);
  });

  test('a member save that moves a picked set alerts nobody, where an admin save alerts the picker', async () => {
    const { server, users, adminToken } = await boot();
    await o.sql(server, "INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ('f-a-live', 'main', 'Main', '#ff3366', 0)");
    await o.sql(server, "INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ('f-a-live', 0, 'Friday', '2026-06-05')");
    await o.sql(server, "INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ('s-live', 'f-a-live', 0, 'Live Act', 'main', '10:00', '11:00', 0)");
    const profile = await h.joinFestivalProfile(server, users.stranger.token, 'f-a-live');
    await o.sql(server, "INSERT INTO festival_profile_picks (profile_id, set_id) VALUES ($1, 's-live')", [profile.id]);

    const move = (start: string, end: string) => ({
      notify: true,
      expectedUpdatedAt: FAR_FUTURE,
      stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
      days: [{ label: 'Friday', date: '2026-06-05', sets: [{ id: 's-live', artist: 'Live Act', stageId: 'main', startTime: start, endTime: end }] }],
    });
    const member = await o.as(server, users.ownerA.token).put(`${MANAGE}/festivals/f-a-live`, move('12:00', '13:00'));
    assert.equal(member.status, 200, JSON.stringify(member.body));
    // One picker is under the 20-person floor, so the organizer's notice carries no count.
    assert.deepEqual(member.body.data.scheduleNotice, { changes: 1, notified: false, held: true });
    // The alert waits in the review queue: one held row, with the picker, until an admin releases it.
    const held = (await o.sql(server, "SELECT set_id, kind, picker_ids FROM festival_held_schedule_changes WHERE festival_id = 'f-a-live'")).rows;
    assert.deepEqual(held.map((r: any) => [r.set_id, r.kind, r.picker_ids.length]), [['s-live', 'moved', 1]]);

    const admin = await o.as(server, adminToken).put('/api/v1/admin/festivals/f-a-live', move('14:00', '15:00'));
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    assert.deepEqual([admin.body.data.scheduleNotice.people, admin.body.data.scheduleNotice.notified], [1, true]);
  });

  test('usernames: a member sees teammates by name, and an admin as "Festie support", in the editor line and the import history', async () => {
    const { server, users, adminToken, adminName } = await boot();
    const row = { row: 1, artist: 'Imported Act', day: 'Friday', date: '2026-06-05', stage: 'Main', startTime: '10:00', endTime: '11:00' };
    const adminImport = await o.as(server, adminToken).post('/api/v1/admin/festivals/f-a/import-lineup', { rows: [row] });
    assert.equal(adminImport.status, 200, JSON.stringify(adminImport.body));
    await o.as(server, adminToken).put('/api/v1/admin/festivals/f-a', { name: 'Admin edit' });

    const viewer = o.as(server, users.viewerA.token);
    const detail = await viewer.get(`${MANAGE}/festivals/f-a`);
    assert.equal(detail.body.data.updatedByUsername, 'Festie support');
    const history = await viewer.get(`${MANAGE}/festivals/f-a/imports`);
    assert.deepEqual(history.body.data.imports.map((i: any) => i.createdBy), ['Festie support']);

    const own = await o.as(server, users.editorA.token).post(`${MANAGE}/festivals/f-a/import-lineup`, { rows: [{ ...row, row: 2, artist: 'Team Act', startTime: '12:00', endTime: '13:00' }] });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.data.committed, true, JSON.stringify(own.body.data.plan?.rows));
    await o.as(server, users.editorA.token).put(`${MANAGE}/festivals/f-a`, { name: 'Team edit', expectedUpdatedAt: FAR_FUTURE });
    // A teammate reads as "<display name> at <organization>", never as the attendee username. With no display name, "A teammate".
    const after = await viewer.get(`${MANAGE}/festivals/f-a`);
    assert.equal(after.body.data.updatedByUsername, 'A teammate at Org org-a');
    const afterHistory = await viewer.get(`${MANAGE}/festivals/f-a/imports`);
    assert.deepEqual(afterHistory.body.data.imports.map((i: any) => i.createdBy), ['A teammate at Org org-a', 'Festie support']);
    for (const res of [after, afterHistory]) assert.equal(JSON.stringify(res.body).includes(users.editorA.username), false);

    // The admin still sees real names on the admin mount.
    const adminHistory = await o.as(server, adminToken).get('/api/v1/admin/festivals/f-a/imports');
    assert.ok(adminHistory.body.data.imports.some((i: any) => i.createdBy === adminName));
    for (const res of [detail, history, afterHistory, after]) assert.equal(JSON.stringify(res.body).includes(adminName), false);
  });
});
