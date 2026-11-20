import 'dotenv/config';
/**
 * Organizations: the admin routes, members and pending members, the claim in GET /manage/me, the
 * last-owner guard, the effect of removal and suspension, the festival caps, /auth/me and the audit rows.
 * Needs TEST_DATABASE_URL. The cross-tenant cells live in festival-access-matrix.test.ts and
 * organizer-isolation.test.ts.
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
  if (skip) console.log('organizations: skipped (TEST_DATABASE_URL not set)');
});

const ADMIN_ORGS = '/api/v1/admin/organizations';
const MANAGE = '/api/v1/manage';

async function boot(overrides: Record<string, any> = {}) {
  const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000, ...overrides });
  servers.push(server);
  const adminToken = await h.loginAdmin(server);
  await o.reauth(server, adminToken, o.ADMIN_PASSWORD);
  return { server, adminToken, admin: o.as(server, adminToken) };
}

// The audit insert of a route that does not await it lands a moment later.
async function auditRows(server: any, where: string, params: unknown[]) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { rows } = await o.sql(server, `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at`, params);
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}

describe('organizations: admin routes', { skip }, () => {
  test('an admin creates an organization as pending, lists it, activates it, verifies it and suspends it', async () => {
    const { server, admin } = await boot();
    const created = await admin.post(ADMIN_ORGS, { name: 'Venue X', kind: 'venue', website: 'https://venue.example' });
    assert.equal(created.status, 201);
    const org = created.body.data;
    assert.equal(org.status, 'pending');
    assert.equal(org.verifiedAt, null);
    assert.match(org.id, /^org-/);

    const list = await admin.get(ADMIN_ORGS);
    assert.deepEqual(list.body.data.map((x: any) => [x.id, x.memberCount, x.pendingCount, x.ownerCount]), [[org.id, 0, 0, 0]]);
    assert.equal((await admin.get(`${ADMIN_ORGS}?ownerless=true`)).body.data.length, 1);
    assert.equal((await admin.get(`${ADMIN_ORGS}?status=active`)).body.data.length, 0);

    assert.equal((await admin.put(`${ADMIN_ORGS}/${org.id}/status`, { status: 'active' })).body.data.status, 'active');
    const verified = await admin.put(`${ADMIN_ORGS}/${org.id}/verified`, { verified: true });
    assert.ok(verified.body.data.verifiedAt);
    assert.equal((await admin.put(`${ADMIN_ORGS}/${org.id}/verified`, { verified: false })).body.data.verifiedAt, null);
    assert.equal((await admin.put(`${ADMIN_ORGS}/${org.id}/status`, { status: 'suspended' })).body.data.status, 'suspended');
    assert.equal((await admin.put(`${ADMIN_ORGS}/${org.id}/status`, { status: 'pending' })).status, 400);
    assert.equal((await admin.put(`${ADMIN_ORGS}/nope/status`, { status: 'active' })).status, 404);

    const detail = (await admin.get(`${ADMIN_ORGS}/${org.id}`)).body.data;
    assert.deepEqual([detail.members, detail.pending, detail.festivals], [[], [], []]);

    const actions = (await o.sql(server, 'SELECT action, actor_type, organization_id FROM audit_log WHERE organization_id = $1 ORDER BY created_at', [org.id])).rows;
    assert.deepEqual(
      actions.map((r: any) => r.action),
      ['organization.created', 'organization.activated', 'organization.verified', 'organization.unverified', 'organization.suspended'],
    );
    assert.ok(actions.every((r: any) => r.actor_type === 'admin'));
  });

  test('input is validated: short name, http website, bad kind', async () => {
    const { admin } = await boot();
    for (const body of [{ name: 'x' }, { name: 'Venue', website: 'http://venue.example' }, { name: 'Venue', kind: 'club' }, {}]) {
      assert.equal((await admin.post(ADMIN_ORGS, body)).status, 400, JSON.stringify(body));
    }
  });
});

describe('organizations: members and pending members', { skip }, () => {
  async function withOrg(overrides: Record<string, any> = {}) {
    const ctx = await boot(overrides);
    await o.seedOrg(ctx.server, 'org-1', 'active');
    return ctx;
  }

  test('a member change needs a recent password', async () => {
    const { server } = await withOrg();
    const freshAdmin = o.as(server, await h.loginAdmin(server));
    const res = await freshAdmin.post(`${ADMIN_ORGS}/org-1/members`, { email: 'a@example.com', role: 'owner' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
  });

  test('a confirmed account joins at once; an unconfirmed or unknown address waits as pending', async () => {
    const { server, admin } = await withOrg();
    const confirmed = await o.makeUser(server, `conf-${Date.now()}`);
    const unconfirmed = await o.makeUser(server, `unconf-${Date.now()}`, { confirmed: false });

    const joined = await admin.post(`${ADMIN_ORGS}/org-1/members`, { email: confirmed.email.toUpperCase(), role: 'editor' });
    assert.equal(joined.status, 201);
    assert.deepEqual([joined.body.data.kind, joined.body.data.userId], ['member', confirmed.id]);
    assert.equal((await admin.post(`${ADMIN_ORGS}/org-1/members`, { email: confirmed.email, role: 'viewer' })).status, 409);

    const waiting = await admin.post(`${ADMIN_ORGS}/org-1/members`, { email: unconfirmed.email, role: 'owner' });
    assert.equal(waiting.body.data.kind, 'pending');
    const stranger = await admin.post(`${ADMIN_ORGS}/org-1/members`, { email: 'Nobody@Example.com', role: 'viewer' });
    assert.deepEqual([stranger.body.data.kind, stranger.body.data.email], ['pending', 'nobody@example.com']);

    const detail = (await admin.get(`${ADMIN_ORGS}/org-1`)).body.data;
    assert.deepEqual(detail.members.map((m: any) => [m.userId, m.role]), [[confirmed.id, 'editor']]);
    assert.deepEqual(detail.pending.map((p: any) => [p.email, p.role]).sort(), [
      ['nobody@example.com', 'viewer'],
      [unconfirmed.email, 'owner'],
    ]);
    const audit = await o.sql(server, "SELECT action FROM audit_log WHERE organization_id = 'org-1' ORDER BY action");
    assert.deepEqual(
      audit.rows.map((r: any) => r.action),
      ['organization.member_added', 'organization.pending_member_added', 'organization.pending_member_added'],
    );
  });

  test('the claim needs a confirmed email, is idempotent, and a different email claims nothing', async () => {
    const { server, admin } = await withOrg();
    const stamp = Date.now();
    const owner = await o.makeUser(server, `late-${stamp}`, { confirmed: false });
    const other = await o.makeUser(server, `other-${stamp}`);
    assert.equal((await admin.post(`${ADMIN_ORGS}/org-1/members`, { email: owner.email, role: 'owner' })).body.data.kind, 'pending');

    // Unconfirmed: nothing is claimed, and the pending row stays for later.
    const before = await o.as(server, owner.token).get(`${MANAGE}/me`);
    assert.deepEqual(before.body.data, { emailConfirmed: false, organizations: [] });
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_pending_members')).rowCount, 1);

    // Another confirmed user never claims it.
    assert.deepEqual((await o.as(server, other.token).get(`${MANAGE}/me`)).body.data.organizations, []);

    await o.sql(server, 'UPDATE users SET email_verified_at = NOW() WHERE id = $1', [owner.id]);
    const claimed = await o.as(server, owner.token).get(`${MANAGE}/me`);
    assert.equal(claimed.body.data.emailConfirmed, true);
    assert.deepEqual(claimed.body.data.organizations, [
      { id: 'org-1', name: 'Org org-1', role: 'owner', status: 'active', verified: false },
    ]);
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_pending_members')).rowCount, 0);

    // A second call changes nothing and writes no second audit row.
    await o.as(server, owner.token).get(`${MANAGE}/me`);
    const rows = await auditRows(server, "action = 'organization.member_added' AND actor_id = $1", [owner.id]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].actor_type, rows[0].organization_id], ['organizer', 'org-1']);
  });

  test('a claim keeps the role of an existing membership', async () => {
    const { server } = await withOrg();
    const user = await o.makeUser(server, `keep-${Date.now()}`);
    await o.addMember(server, 'org-1', user.id, 'owner');
    await o.sql(server, "INSERT INTO organization_pending_members (organization_id, email, role) VALUES ('org-1', $1, 'viewer')", [user.email]);
    const me = await o.as(server, user.token).get(`${MANAGE}/me`);
    assert.deepEqual(me.body.data.organizations.map((x: any) => x.role), ['owner']);
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_pending_members')).rowCount, 0);
  });

  test('a pending member is removed by email, once', async () => {
    const { admin } = await withOrg();
    await admin.post(`${ADMIN_ORGS}/org-1/members`, { email: 'gone@example.com', role: 'viewer' });
    assert.equal((await admin.delete(`${ADMIN_ORGS}/org-1/pending-members/${encodeURIComponent('Gone@Example.com')}`)).status, 200);
    assert.equal((await admin.delete(`${ADMIN_ORGS}/org-1/pending-members/gone@example.com`)).status, 404);
  });

  test('the last active owner cannot be removed or demoted, and two concurrent demotions leave one owner', async () => {
    const { server, admin } = await withOrg();
    const stamp = Date.now();
    const [a, b] = await Promise.all([o.makeUser(server, `own-a-${stamp}`), o.makeUser(server, `own-b-${stamp}`)]);
    await o.addMember(server, 'org-1', a.id, 'owner');

    assert.equal((await admin.delete(`${ADMIN_ORGS}/org-1/members/${a.id}`)).status, 409);
    assert.equal((await admin.put(`${ADMIN_ORGS}/org-1/members/${a.id}`, { role: 'editor' })).status, 409);

    await o.addMember(server, 'org-1', b.id, 'owner');
    const results = await Promise.all([
      admin.put(`${ADMIN_ORGS}/org-1/members/${a.id}`, { role: 'viewer' }),
      admin.put(`${ADMIN_ORGS}/org-1/members/${b.id}`, { role: 'viewer' }),
    ]);
    assert.deepEqual(results.map((r: any) => r.status).sort(), [200, 409]);
    const owners = await o.sql(server, "SELECT user_id FROM organization_members WHERE organization_id = 'org-1' AND role = 'owner'");
    assert.equal(owners.rowCount, 1);
  });

  test('a deleted user does not count as an owner', async () => {
    const { server, admin } = await withOrg();
    const stamp = Date.now();
    const [live, ghost] = await Promise.all([o.makeUser(server, `live-${stamp}`), o.makeUser(server, `ghost-${stamp}`)]);
    await o.addMember(server, 'org-1', live.id, 'owner');
    await o.addMember(server, 'org-1', ghost.id, 'owner');
    await o.sql(server, 'UPDATE users SET deleted_at = NOW() WHERE id = $1', [ghost.id]);
    assert.equal((await admin.put(`${ADMIN_ORGS}/org-1/members/${live.id}`, { role: 'editor' })).status, 409);
    assert.equal((await admin.delete(`${ADMIN_ORGS}/org-1/members/${ghost.id}`)).status, 200);
  });

  test('a removal and a role change take effect on the next request', async () => {
    const { server, admin } = await withOrg();
    const stamp = Date.now();
    const [boss, editor] = await Promise.all([o.makeUser(server, `boss-${stamp}`), o.makeUser(server, `ed-${stamp}`)]);
    await o.addMember(server, 'org-1', boss.id, 'owner');
    await o.addMember(server, 'org-1', editor.id, 'editor');
    await o.seedFestival(server, 'f-1', 'org-1');
    const edit = () => o.as(server, editor.token).put(`${MANAGE}/festivals/f-1`, { name: 'Renamed' });

    assert.equal((await edit()).status, 200);
    assert.equal((await admin.put(`${ADMIN_ORGS}/org-1/members/${editor.id}`, { role: 'viewer' })).status, 200);
    assert.equal((await edit()).status, 403);
    assert.equal((await o.as(server, editor.token).get(`${MANAGE}/festivals/f-1`)).status, 200);
    assert.equal((await admin.delete(`${ADMIN_ORGS}/org-1/members/${editor.id}`)).status, 200);
    assert.equal((await edit()).status, 404);
    assert.equal((await o.as(server, editor.token).get(`${MANAGE}/festivals/f-1`)).status, 404);
  });

  test('suspending blocks writes at once, reading stays, and activating restores writes', async () => {
    const { server, admin } = await withOrg();
    const user = await o.makeUser(server, `susp-${Date.now()}`);
    await o.addMember(server, 'org-1', user.id, 'owner');
    await o.seedFestival(server, 'f-1', 'org-1');
    const edit = () => o.as(server, user.token).put(`${MANAGE}/festivals/f-1`, { name: 'Renamed' });
    assert.equal((await edit()).status, 200);
    await admin.put(`${ADMIN_ORGS}/org-1/status`, { status: 'suspended' });
    assert.equal((await edit()).status, 403);
    assert.equal((await o.as(server, user.token).get(`${MANAGE}/festivals/f-1`)).status, 200);
    assert.equal((await o.as(server, user.token).post(`${MANAGE}/festivals`, { organizationId: 'org-1', name: 'New' })).status, 403);
    await admin.put(`${ADMIN_ORGS}/org-1/status`, { status: 'active' });
    assert.equal((await edit()).status, 200);
  });

  test('an active organization stops at its festival cap', async () => {
    const { server } = await withOrg({ ORGANIZER_ACTIVE_FESTIVAL_CAP: '2' });
    const user = await o.makeUser(server, `cap-${Date.now()}`);
    await o.addMember(server, 'org-1', user.id, 'owner');
    const create = (name: string) => o.as(server, user.token).post(`${MANAGE}/festivals`, { organizationId: 'org-1', name });
    assert.equal((await create('One')).status, 201);
    assert.equal((await create('Two')).status, 201);
    const third = await create('Three');
    assert.equal(third.status, 403);
    assert.match(third.body.error.message, /2 festivals/);
  });
});

describe('organizations: /auth/me and the audit rows', { skip }, () => {
  test('/auth/me lists the organizations of a confirmed member, read only, and nothing for anyone else', async () => {
    const { server } = await boot();
    const users = await o.seedScenario(server);
    const own = await o.as(server, users.editorA.token).get('/api/v1/auth/me');
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.data.organizations, [{ id: 'org-a', name: 'Org org-a', role: 'editor', status: 'active', verified: false }]);
    for (const who of ['stranger', 'unconfirmed', 'ghostA'] as const) {
      const res = await o.as(server, users[who].token).get('/api/v1/auth/me');
      if (res.status === 200) assert.deepEqual(res.body.data.organizations, [], who);
    }
    // /auth/me never claims: a pending row stays until GET /manage/me.
    await o.sql(server, "INSERT INTO organization_pending_members (organization_id, email, role) VALUES ('org-b', $1, 'viewer')", [users.stranger.email]);
    assert.deepEqual((await o.as(server, users.stranger.token).get('/api/v1/auth/me')).body.data.organizations, []);
    assert.equal((await o.sql(server, 'SELECT 1 FROM organization_pending_members')).rowCount, 1);
  });

  test('audit rows carry the organizer actor and the organization; an admin on the same festival stays admin', async () => {
    const { server, adminToken } = await boot();
    const users = await o.seedScenario(server);
    await o.as(server, users.editorA.token).put(`${MANAGE}/festivals/f-a`, { name: 'By editor' });
    const organizer = await auditRows(server, "action = 'festival.updated' AND target_id = 'f-a' AND actor_id = $1", [users.editorA.id]);
    assert.equal(organizer.length, 1);
    assert.deepEqual([organizer[0].actor_type, organizer[0].organization_id], ['organizer', 'org-a']);

    await o.as(server, adminToken).put('/api/v1/admin/festivals/f-a', { name: 'By admin' });
    const admin = (await auditRows(server, "action = 'festival.updated' AND target_id = 'f-a' AND actor_type = 'admin'", [])) as any[];
    assert.equal(admin.length, 1);
    assert.equal(admin[0].organization_id, 'org-a');

    await o.as(server, adminToken).put('/api/v1/admin/festivals/f-plat', { name: 'Platform' });
    const platform = await auditRows(server, "action = 'festival.updated' AND target_id = 'f-plat'", []);
    assert.equal(platform[0].organization_id, null);

    const created = await o.as(server, users.ownerA.token).post(`${MANAGE}/festivals`, { organizationId: 'org-a', name: 'Made' });
    const createdRows = await auditRows(server, "action = 'festival.created' AND target_id = $1", [created.body.data.id]);
    assert.deepEqual([createdRows[0].actor_type, createdRows[0].organization_id], ['organizer', 'org-a']);
  });
});
