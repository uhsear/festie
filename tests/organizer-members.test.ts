import 'dotenv/config';
/**
 * Owner-run members, the organization profile, the upload cap and the festival caps (plan-v3 3.3, 5.7, 6.6;
 * owner decision 7). Runs the real app on the throwaway test database. The role cells of every other route are
 * in festival-access-matrix.test.ts.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { Pool } from 'pg';
import { skip, TEST_DATABASE_URL } from './_test-schema';
import { createOrganizationsStore } from '../lib/db/stores/organizations.js';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

const ORG = '/api/v1/manage/organizations/org-a';
const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

async function boot(overrides: Record<string, any> = {}) {
  const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000, ...overrides });
  servers.push(server);
  const users = await o.seedScenario(server);
  // Owners change members only within 15 minutes of entering their password.
  for (const who of ['ownerA', 'ownerP', 'ownerS', 'editorA', 'viewerA'] as const) await o.reauth(server, users[who].token);
  const adminToken = await h.loginAdmin(server);
  await o.reauth(server, adminToken, o.ADMIN_PASSWORD);
  return { server, users, adminToken };
}

async function labelOf(userId: string) {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    return await createOrganizationsStore(pool).editorLabel('org-a', userId);
  } finally {
    await pool.end();
  }
}

const emailsOf = async (server: any, organizationId = 'org-a') =>
  (await o.sql(server, 'SELECT email FROM organization_member_emails WHERE organization_id = $1 ORDER BY id', [organizationId])).rows.map((r: any) => r.email);

describe('owner-run members: adding', { skip }, () => {
  test('an owner adds a confirmed account at once, and that person can open the festivals of the team', async () => {
    const { server, users } = await boot();
    const person = await o.makeUser(server, `joiner-${Date.now()}`);
    assert.equal((await o.as(server, person.token).get('/api/v1/manage/festivals/f-a')).status, 404);

    const added = await o.as(server, users.ownerA.token).post(`${ORG}/members`, { email: person.email, role: 'editor' });
    assert.equal(added.status, 201);
    assert.deepEqual([added.body.data.kind, added.body.data.userId, added.body.data.role], ['member', person.id, 'editor']);
    assert.equal(added.body.data.emailed, false, 'no mail key on the test server');
    assert.equal((await o.as(server, person.token).get('/api/v1/manage/festivals/f-a')).status, 200);
    assert.deepEqual(await emailsOf(server), [person.email]);
  });

  test('an address with no account waits, and is claimed only after that email is confirmed', async () => {
    const { server, users } = await boot();
    const stamp = Date.now();
    const added = await o.as(server, users.ownerA.token).post(`${ORG}/members`, { email: ` Later-${stamp}@Example.com `, role: 'viewer' });
    assert.equal(added.status, 201);
    assert.deepEqual([added.body.data.kind, added.body.data.email], ['pending', `later-${stamp}@example.com`]);

    const later = await o.makeUser(server, `later-${stamp}`, { confirmed: false });
    const unconfirmed = await o.as(server, later.token).get('/api/v1/manage/me');
    assert.deepEqual(unconfirmed.body.data.organizations, []);
    await o.sql(server, 'UPDATE users SET email_verified_at = NOW() WHERE id = $1', [later.id]);
    const claimed = await o.as(server, later.token).get('/api/v1/manage/me');
    assert.deepEqual(claimed.body.data.organizations.map((x: any) => [x.id, x.role]), [['org-a', 'viewer']]);
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_pending_members WHERE email = $1', [later.email])).rowCount, 0);
  });

  test('an owner cannot add an owner, and an editor, a viewer, a stranger and a member of another organization cannot add anyone', async () => {
    const { server, users } = await boot();
    const owner = await o.as(server, users.ownerA.token).post(`${ORG}/members`, { email: 'boss@example.com', role: 'owner' });
    assert.equal(owner.status, 403);
    assert.match(owner.body.error.message, /Only Festie can add an owner/);
    for (const [who, status] of [['editorA', 403], ['viewerA', 403], ['stranger', 404], ['ownerB', 404], ['unconfirmed', 404]] as const) {
      const res = await o.as(server, users[who].token).post(`${ORG}/members`, { email: 'x@example.com', role: 'viewer' });
      assert.equal(res.status, status, who);
    }
    assert.equal((await o.as(server).post(`${ORG}/members`, { email: 'x@example.com', role: 'viewer' })).status, 401);
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_pending_members')).rowCount, 0);
  });

  test('a member change needs a recent password', async () => {
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
    servers.push(server);
    const users = await o.seedScenario(server);
    const res = await o.as(server, users.ownerA.token).post(`${ORG}/members`, { email: 'x@example.com', role: 'viewer' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
  });

  test('a pending organization and a suspended one add nobody', async () => {
    const { server, users } = await boot();
    const pending = await o.as(server, users.ownerP.token).post('/api/v1/manage/organizations/org-p/members', { email: 'x@example.com', role: 'viewer' });
    assert.equal(pending.status, 403);
    assert.match(pending.body.error.message, /Festie is checking your organization/);
    const suspended = await o.as(server, users.ownerS.token).post('/api/v1/manage/organizations/org-s/members', { email: 'x@example.com', role: 'viewer' });
    assert.equal(suspended.status, 403);
  });

  test('the daily cap counts every membership email, refuses the next one, and an add that fails is not counted', async () => {
    const { server, users } = await boot({ ORGANIZER_MEMBER_ADD_DAILY_CAP: '2' });
    const add = (email: string) => o.as(server, users.ownerA.token).post(`${ORG}/members`, { email, role: 'viewer' });
    // Already a member: a 409 that rolls back and uses none of the cap.
    assert.equal((await add(users.viewerA.email)).status, 409);
    assert.equal((await add('one@example.com')).status, 201);
    assert.equal((await add('two@example.com')).status, 201);
    const third = await add('three@example.com');
    assert.equal(third.status, 429);
    assert.equal(third.body.error.code, 'RATE_LIMITED');
    assert.match(third.body.error.message, /2 people a day/);
    assert.deepEqual(await emailsOf(server), ['one@example.com', 'two@example.com']);
    assert.equal((await o.sql(server, "SELECT 1 FROM organization_pending_members WHERE email = 'three@example.com'")).rowCount, 0);

    // The day rolls over: a row older than 24 hours no longer counts.
    await o.sql(server, "UPDATE organization_member_emails SET created_at = NOW() - INTERVAL '25 hours' WHERE email = 'one@example.com'");
    assert.equal((await add('three@example.com')).status, 201);
  });

  test('the default cap is ten a day, and Festie staff are not capped', async () => {
    const { server, users, adminToken } = await boot();
    for (let i = 0; i < 10; i++) {
      assert.equal((await o.as(server, users.ownerA.token).post(`${ORG}/members`, { email: `p${i}@example.com`, role: 'viewer' })).status, 201, `add ${i}`);
    }
    assert.equal((await o.as(server, users.ownerA.token).post(`${ORG}/members`, { email: 'p10@example.com', role: 'viewer' })).status, 429);
    // An admin may add an owner through the same route, with no cap and no email row.
    const staff = await o.as(server, adminToken).post(`${ORG}/members`, { email: 'owner2@example.com', role: 'owner' });
    assert.equal(staff.status, 201);
    assert.equal((await emailsOf(server)).length, 10);
  });

  test('an add writes an organizer audit row for the organization', async () => {
    const { server, users } = await boot();
    await o.as(server, users.ownerA.token).post(`${ORG}/members`, { email: 'audit@example.com', role: 'editor' });
    const rows = (await o.sql(server, "SELECT actor_type, organization_id, actor_id FROM audit_log WHERE action = 'organization.pending_member_added' AND organization_id = 'org-a'")).rows;
    assert.deepEqual(rows.map((r: any) => [r.actor_type, r.organization_id, r.actor_id]), [['organizer', 'org-a', users.ownerA.id]]);
  });
});

describe('owner-run members: roles and removal', { skip }, () => {
  test('an owner turns an editor into a viewer, and the viewer is read only on the next request', async () => {
    const { server, users } = await boot();
    const edit = () => o.as(server, users.editorA.token).put('/api/v1/manage/festivals/f-a', { name: 'Edited', expectedUpdatedAt: '2999-01-01T00:00:00.000Z' });
    assert.equal((await edit()).status, 200);
    const changed = await o.as(server, users.ownerA.token).put(`${ORG}/members/${users.editorA.id}`, { role: 'viewer' });
    assert.deepEqual([changed.status, changed.body.data.from, changed.body.data.role], [200, 'editor', 'viewer']);
    assert.equal((await edit()).status, 403);
    assert.equal((await o.as(server, users.editorA.token).get('/api/v1/manage/festivals/f-a')).status, 200);
    assert.equal((await o.as(server, users.ownerA.token).put(`${ORG}/members/${users.editorA.id}`, { role: 'editor' })).status, 200);
    assert.equal((await edit()).status, 200);
  });

  test('an owner cannot make an owner, demote one or remove one, not even itself', async () => {
    const { server, users } = await boot();
    const owner = o.as(server, users.ownerA.token);
    const promote = await owner.put(`${ORG}/members/${users.editorA.id}`, { role: 'owner' });
    assert.equal(promote.status, 403);
    assert.match(promote.body.error.message, /Only Festie/);
    assert.equal((await owner.put(`${ORG}/members/${users.unconfirmed.id}`, { role: 'viewer' })).status, 403);
    assert.equal((await owner.delete(`${ORG}/members/${users.unconfirmed.id}`)).status, 403);
    assert.equal((await owner.delete(`${ORG}/members/${users.ownerA.id}`)).status, 403);
    await o.sql(server, "INSERT INTO organization_pending_members (organization_id, email, role) VALUES ('org-a', 'future-owner@example.com', 'owner')");
    assert.equal((await owner.delete(`${ORG}/pending-members/future-owner@example.com`)).status, 403);
    const roles = await o.sql(server, "SELECT role FROM organization_members WHERE organization_id = 'org-a' AND user_id = ANY($1) ORDER BY role", [[users.ownerA.id, users.unconfirmed.id]]);
    assert.deepEqual(roles.rows.map((r: any) => r.role), ['owner', 'owner']);
  });

  test('an owner never overwrites or consumes a pending owner invitation; Festie may', async () => {
    const { server, users, adminToken } = await boot();
    const owner = o.as(server, users.ownerA.token);
    const invite = (email: string, role = 'owner') =>
      o.sql(server, 'INSERT INTO organization_pending_members (organization_id, email, role) VALUES ($1, $2, $3) ON CONFLICT (organization_id, email) DO UPDATE SET role = EXCLUDED.role', ['org-a', email, role]);
    const pendingRole = async (email: string) => (await o.sql(server, "SELECT role FROM organization_pending_members WHERE organization_id = 'org-a' AND email = $1", [email])).rows[0]?.role;

    // An address with no account: the owner's add as editor must not demote the owner invitation.
    await invite('future-boss@example.com');
    const demote = await owner.post(`${ORG}/members`, { email: 'future-boss@example.com', role: 'editor' });
    assert.equal(demote.status, 403, JSON.stringify(demote.body));
    assert.match(demote.body.error.message, /Only Festie/);
    assert.equal(await pendingRole('future-boss@example.com'), 'owner');

    // A confirmed account whose address still holds an owner invitation: the add must not delete that invitation.
    const person = await o.makeUser(server, `invitee-${Date.now()}`);
    await invite(person.email);
    assert.equal((await owner.post(`${ORG}/members`, { email: person.email, role: 'viewer' })).status, 403);
    assert.equal(await pendingRole(person.email), 'owner');
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2', ['org-a', person.id])).rowCount, 0);

    // A lower invitation can still be replaced by an owner; Festie can replace an owner invitation.
    await invite('later@example.com', 'viewer');
    assert.equal((await owner.post(`${ORG}/members`, { email: 'later@example.com', role: 'editor' })).status, 201);
    assert.equal(await pendingRole('later@example.com'), 'editor');
    assert.equal((await o.as(server, adminToken).post(`${ORG}/members`, { email: 'future-boss@example.com', role: 'editor' })).status, 201);
    assert.equal(await pendingRole('future-boss@example.com'), 'editor');
  });

  test('removing a member closes their access on the next request; removing a pending address removes the invitation', async () => {
    const { server, users } = await boot();
    const owner = o.as(server, users.ownerA.token);
    assert.equal((await o.as(server, users.viewerA.token).get('/api/v1/manage/festivals/f-a')).status, 200);
    const removed = await owner.delete(`${ORG}/members/${users.viewerA.id}`);
    assert.deepEqual([removed.status, removed.body.data.role], [200, 'viewer']);
    assert.equal((await o.as(server, users.viewerA.token).get('/api/v1/manage/festivals/f-a')).status, 404);
    assert.equal((await owner.delete(`${ORG}/members/${users.viewerA.id}`)).status, 404);

    await owner.post(`${ORG}/members`, { email: 'gone@example.com', role: 'editor' });
    assert.equal((await owner.delete(`${ORG}/pending-members/gone@example.com`)).status, 200);
    assert.equal((await owner.delete(`${ORG}/pending-members/gone@example.com`)).status, 404);
    assert.equal((await o.as(server, users.editorA.token).delete(`${ORG}/members/${users.viewerA.id}`)).status, 403);
    assert.equal((await o.as(server, users.ownerB.token).delete(`${ORG}/members/${users.editorA.id}`)).status, 404);
  });

  test('an owner cannot reach a member of another organization by user id', async () => {
    const { server, users } = await boot();
    const res = await o.as(server, users.ownerA.token).delete(`${ORG}/members/${users.ownerB.id}`);
    assert.equal(res.status, 404);
    assert.equal((await o.sql(server, "SELECT 1 FROM organization_members WHERE organization_id = 'org-b'")).rowCount, 1);
  });
});

describe('the organization on the manage mount', { skip }, () => {
  test('any member reads it; only an owner sees addresses, invitations and the profile controls', async () => {
    const { server, users } = await boot();
    await o.as(server, users.ownerA.token).post(`${ORG}/members`, { email: 'waiting@example.com', role: 'viewer' });
    const asOwner = await o.as(server, users.ownerA.token).get(ORG);
    assert.equal(asOwner.status, 200);
    const owner = asOwner.body.data;
    assert.deepEqual([owner.id, owner.role, owner.status], ['org-a', 'owner', 'active']);
    assert.deepEqual(owner.pending.map((p: any) => [p.email, p.role, p.addedBy]), [['waiting@example.com', 'viewer', 'A teammate']]);
    assert.ok(owner.members.every((m: any) => typeof m.email === 'string' && !('username' in m)));
    assert.deepEqual([owner.upload.usedBytes, owner.upload.capBytes], [0, 200 * 1024 * 1024]);

    for (const who of ['editorA', 'viewerA'] as const) {
      const res = await o.as(server, users[who].token).get(ORG);
      assert.equal(res.status, 200, who);
      assert.deepEqual(res.body.data.pending, []);
      assert.ok(res.body.data.members.every((m: any) => !('email' in m) && !('username' in m)), who);
      assert.equal(res.body.data.members.length, owner.members.length);
      assert.doesNotMatch(JSON.stringify(res.body), /waiting@example\.com/);
    }
    assert.equal((await o.as(server, users.ownerB.token).get(ORG)).status, 404);
    assert.equal((await o.as(server, users.stranger.token).get(ORG)).status, 404);
    assert.equal((await o.as(server).get(ORG)).status, 401);
    // A suspended organization is still readable by its owner.
    assert.equal((await o.as(server, users.ownerS.token).get('/api/v1/manage/organizations/org-s')).status, 200);
  });

  test('"added by" names a teammate by display name, and anyone outside the team as Festie support', async () => {
    const { server, users } = await boot();
    await o.sql(server, "UPDATE users SET display_name = 'Alex' WHERE id = $1", [users.ownerA.id]);
    await o.sql(server, 'UPDATE organization_members SET added_by = $1 WHERE user_id = $2', [users.ownerA.id, users.editorA.id]);
    await o.sql(server, "UPDATE organization_members SET added_by = 'some-admin' WHERE user_id = $1", [users.viewerA.id]);
    const { members } = (await o.as(server, users.ownerA.token).get(ORG)).body.data;
    const byId = Object.fromEntries(members.map((m: any) => [m.userId, m.addedBy]));
    assert.equal(byId[users.editorA.id], 'Alex');
    assert.equal(byId[users.viewerA.id], 'Festie support');
  });

  test('an owner edits the profile; the display name then names the organization to teammates', async () => {
    const { server, users } = await boot();
    const res = await o.as(server, users.ownerA.token).put(ORG, { name: 'Venue A', displayName: 'The Venue', contactEmail: ' Booking@Venue.Example ', website: 'https://venue.example' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      [res.body.data.name, res.body.data.displayName, res.body.data.contactEmail, res.body.data.website],
      ['Venue A', 'The Venue', 'booking@venue.example', 'https://venue.example'],
    );
    // A key left out stays; null clears.
    const partial = await o.as(server, users.ownerA.token).put(ORG, { displayName: null });
    assert.deepEqual([partial.body.data.name, partial.body.data.displayName, partial.body.data.contactEmail], ['Venue A', null, 'booking@venue.example']);
    await o.sql(server, 'UPDATE users SET display_name = NULL WHERE id = $1', [users.ownerA.id]);
    assert.equal(await labelOf(users.ownerA.id), 'A teammate at Venue A', 'the name is the fallback when no display name is set');
    await o.as(server, users.ownerA.token).put(ORG, { displayName: 'The Venue' });
    assert.equal(await labelOf(users.ownerA.id), 'A teammate at The Venue');

    const rows = (await o.sql(server, "SELECT actor_type, details_json FROM audit_log WHERE action = 'organization.updated' AND organization_id = 'org-a' ORDER BY created_at")).rows;
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r: any) => r.actor_type === 'organizer'));
    assert.deepEqual(JSON.parse(rows[0].details_json).fields, ['name', 'displayName', 'contactEmail', 'website']);
  });

  test('the profile rejects bad input, other keys and an empty change; editors, viewers and strangers cannot edit', async () => {
    const { server, users } = await boot();
    const owner = o.as(server, users.ownerA.token);
    assert.equal((await owner.put(ORG, {})).status, 400);
    assert.equal((await owner.put(ORG, { name: 'x' })).status, 400);
    assert.equal((await owner.put(ORG, { contactEmail: 'not-an-email' })).status, 400);
    assert.equal((await owner.put(ORG, { website: 'http://insecure.example' })).status, 400);
    for (const key of ['status', 'kind', 'verifiedAt', 'id']) {
      assert.equal((await owner.put(ORG, { [key]: 'active' })).status, 400, key);
    }
    for (const [who, status] of [['editorA', 403], ['viewerA', 403], ['stranger', 404], ['ownerB', 404]] as const) {
      assert.equal((await o.as(server, users[who].token).put(ORG, { name: 'Hijacked' })).status, status, who);
    }
    assert.equal((await o.sql(server, "SELECT name FROM organizations WHERE id = 'org-a'")).rows[0].name, 'Org org-a');
    // A pending organization edits its profile; a suspended one does not.
    assert.equal((await o.as(server, users.ownerP.token).put('/api/v1/manage/organizations/org-p', { name: 'Pending Venue' })).status, 200);
    assert.equal((await o.as(server, users.ownerS.token).put('/api/v1/manage/organizations/org-s', { name: 'Paused Venue' })).status, 403);
  });
});

describe('the organization name goes into mail, so it carries no address or line break', { skip }, () => {
  const unsafe = ['Free tickets http://evil.example', 'Visit evil.example now', 'Line one\nLine two', 'Name <b>bold</b>', 'Go to a/b', 'Mail me@evil.example'];

  test('Festie cannot create an organization with such a name, and an owner cannot rename to one', async () => {
    const { server, users, adminToken } = await boot();
    for (const name of unsafe) {
      assert.equal((await o.as(server, adminToken).post('/api/v1/admin/organizations', { name })).status, 400, `create: ${JSON.stringify(name)}`);
      assert.equal((await o.as(server, users.ownerA.token).put(ORG, { name })).status, 400, `rename: ${JSON.stringify(name)}`);
      assert.equal((await o.as(server, users.ownerA.token).put(ORG, { displayName: name })).status, 400, `display: ${JSON.stringify(name)}`);
    }
    const fine = await o.as(server, adminToken).post('/api/v1/admin/organizations', { name: "Bass & Beats, St. Louis (2nd Stage) O'Neil" });
    assert.equal(fine.status, 201, JSON.stringify(fine.body));
  });

  test('the added-to-a-team email uses only a safe name; an unsafe stored name falls back to fixed words', async () => {
    const { sendOrganizationMemberEmail } = await import('../lib/email.js');
    const run = async (organizationName: string) => {
      const send = mock.fn(async (_message: any) => ({ data: { id: 'm1' }, error: null }));
      await sendOrganizationMemberEmail({
        to: 'someone@example.com',
        organizationName,
        role: 'editor',
        config: { RESEND_API_KEY: 'key', PUBLIC_ORIGIN: 'https://festie.example' },
        log: { info() {}, warn() {}, error() {} },
        _client: { emails: { send } },
      });
      return send.mock.calls[0]!.arguments[0] as any;
    };
    const ok = await run('Venue A');
    assert.equal(ok.subject, 'You were added to Venue A on Festie');
    for (const name of ['Click http://evil.example now', 'Two\nLines']) {
      const message = await run(name);
      assert.equal(message.subject, 'You were added to a team on Festie');
      assert.doesNotMatch(`${message.text}${message.html}`, /evil|Lines/);
    }
  });
});

describe('upload accounting', { skip }, () => {
  const MB = 1024 * 1024;

  async function png(width = 64) {
    const { default: sharp } = await import('sharp');
    return sharp({ create: { width, height: width, channels: 3, background: { r: 200, g: 30, b: 90 } } }).png().toBuffer();
  }

  const upload = async (server: any, token: string, festivalId: string, image: Buffer) =>
    (server.request as any)
      .post(`/api/v1/manage/festivals/${festivalId}/siteplan-image`)
      .set(h.TRUSTED_MUTATION_HEADER, '1')
      .set('x-user-token', token)
      .attach('image', image, { filename: 'plan.png', contentType: 'image/png' });

  test('a stored image counts its bytes; at the cap the next upload is refused, and Festie staff are counted but never refused', async () => {
    const { server, users, adminToken } = await boot({ PUBLIC_ORIGIN: 'https://festie.test', ORGANIZER_UPLOAD_MB_CAP: '1' });
    const image = await png();
    const first = await upload(server, users.ownerA.token, 'f-a', image);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const stored = (await o.sql(server, "SELECT key, festival_id, bytes FROM organization_uploads WHERE organization_id = 'org-a'")).rows;
    assert.equal(stored.length, 1);
    assert.deepEqual([stored[0].festival_id, stored[0].bytes > 0], ['f-a', true]);
    assert.ok(first.body.data.imageUrl.includes(stored[0].key));
    assert.equal((await o.as(server, users.ownerA.token).get(ORG)).body.data.upload.usedBytes, stored[0].bytes);

    // Fill the organization to within a few bytes of the 1 MB cap.
    await o.sql(server, "INSERT INTO organization_uploads (key, organization_id, festival_id, bytes) VALUES ('filler', 'org-a', 'f-a', $1)", [MB - stored[0].bytes - 5]);
    const refused = await upload(server, users.editorA.token, 'f-a', image);
    assert.equal(refused.status, 413);
    assert.match(refused.body.error.message, /used its 1 MB of image uploads/);
    assert.equal((await o.sql(server, "SELECT 1 FROM organization_uploads WHERE organization_id = 'org-a'")).rowCount, 2, 'a refused upload is not counted');

    // Another organization is unaffected, and Festie staff pass over the cap.
    await o.addMember(server, 'org-b', users.editorA.id, 'editor');
    assert.equal((await upload(server, users.editorA.token, 'f-b', image)).status, 201);
    assert.equal((await upload(server, adminToken, 'f-a', image)).status, 201);
    assert.equal((await o.sql(server, "SELECT 1 FROM organization_uploads WHERE organization_id = 'org-a'")).rowCount, 3);
  });

  test('a platform festival has no organization to count against', async () => {
    const { server, adminToken } = await boot({ PUBLIC_ORIGIN: 'https://festie.test' });
    const res = await upload(server, adminToken, 'f-plat', await png());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_uploads')).rowCount, 0);
  });

  test('a viewer and a pending organization cannot upload at all', async () => {
    const { server, users } = await boot({ PUBLIC_ORIGIN: 'https://festie.test' });
    assert.equal((await upload(server, users.viewerA.token, 'f-a', await png())).status, 403);
    assert.equal((await upload(server, users.ownerP.token, 'f-p', await png())).status, 403);
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_uploads')).rowCount, 0);
  });

  test('the sweep forgets old unreferenced rows, and keeps referenced and young ones', async () => {
    const { server } = await boot();
    const old = "NOW() - INTERVAL '3 days'";
    await o.sql(server, `INSERT INTO organization_uploads (key, organization_id, festival_id, bytes, created_at) VALUES
      ('aaaa', 'org-a', 'f-a', 10, ${old}), ('bbbb', 'org-a', 'f-a', 10, ${old}), ('cccc', 'org-a', 'f-a', 10, NOW())`);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      await createOrganizationsStore(pool).forgetUnreferencedUploads(['bbbb'], 24 * 60 * 60 * 1000);
    } finally {
      await pool.end();
    }
    const left = (await o.sql(server, 'SELECT key FROM organization_uploads ORDER BY key')).rows.map((r: any) => r.key);
    assert.deepEqual(left, ['bbbb', 'cccc']);
  });
});

describe('festival caps', { skip }, () => {
  test('a pending organization holds two drafts, then the API refuses the third', async () => {
    const { server, users } = await boot();
    const create = (name: string) => o.as(server, users.ownerP.token).post('/api/v1/manage/festivals', { organizationId: 'org-p', name });
    // org-p already holds one draft (f-p) and a live festival; only drafts count while pending.
    assert.equal((await create('Second draft')).status, 201);
    const third = await create('Third draft');
    assert.equal(third.status, 403);
    assert.match(third.body.error.message, /2 drafts while Festie checks your organization/);
  });

  test('an active organization stops at the cap, which counts live festivals as well as drafts', async () => {
    const { server, users } = await boot({ ORGANIZER_ACTIVE_FESTIVAL_CAP: '3' });
    const create = (name: string) => o.as(server, users.ownerA.token).post('/api/v1/manage/festivals', { organizationId: 'org-a', name });
    // org-a holds f-a (draft) and f-a-live.
    assert.equal((await create('Third')).status, 201);
    const fourth = await create('Fourth');
    assert.equal(fourth.status, 403);
    assert.match(fourth.body.error.message, /3 festivals/);
  });
});
