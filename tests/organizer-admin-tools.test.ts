import 'dotenv/config';
/**
 * Admin tools of the organizer platform (plan-v3 section 7), on the real app and the throwaway test database:
 * transferring a festival into an organization and handing it back, the reason on a status change, the list of
 * recent organizer edits on live festivals, and how a removed teammate reads in the organization's activity view.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

describe('admin tools of the organizer platform', { skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });

  async function boot() {
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
    servers.push(server);
    const users = await o.seedScenario(server);
    const adminToken = await h.loginAdmin(server);
    await o.reauth(server, adminToken, o.ADMIN_PASSWORD);
    return { server, users, adminToken };
  }

  const auditRows = async (server: any, action: string) =>
    (await o.sql(server, 'SELECT target_id, organization_id, details_json FROM audit_log WHERE action = $1 ORDER BY created_at', [action])).rows;

  test('transfer moves a platform festival into an active organization, refuses an inactive one and hands it back', async () => {
    const { server, users, adminToken } = await boot();
    const admin = o.as(server, adminToken);
    assert.equal((await o.as(server, users.ownerA.token).get('/api/v1/manage/festivals/f-plat')).status, 404);

    const refused = await admin.post('/api/v1/admin/organizations/org-p/festivals', { festivalId: 'f-plat' });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /Activate the organization/);

    const moved = await admin.post('/api/v1/admin/organizations/org-a/festivals', { festivalId: 'f-plat' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.deepEqual([moved.body.data.from, moved.body.data.to], [null, 'org-a']);
    assert.equal((await o.as(server, users.ownerA.token).get('/api/v1/manage/festivals/f-plat')).status, 200);
    assert.equal((await admin.post('/api/v1/admin/organizations/org-a/festivals', { festivalId: 'f-plat' })).status, 409, 'already owned');
    assert.equal((await admin.post('/api/v1/admin/organizations/org-a/festivals', { festivalId: 'no-such-festival' })).status, 404);
    assert.equal((await o.as(server, users.ownerA.token).post('/api/v1/admin/organizations/org-a/festivals', { festivalId: 'f-b' })).status, 403, 'only an admin');

    assert.equal((await admin.delete('/api/v1/admin/organizations/org-b/festivals/f-plat')).status, 404, 'handed back by the wrong owner');
    const back = await admin.delete('/api/v1/admin/organizations/org-a/festivals/f-plat');
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.deepEqual([back.body.data.from, back.body.data.to], ['org-a', null]);
    assert.equal((await o.as(server, users.ownerA.token).get('/api/v1/manage/festivals/f-plat')).status, 404);

    const rows = await auditRows(server, 'festival.transferred');
    assert.deepEqual(
      rows.map((r: any) => [r.target_id, r.organization_id, JSON.parse(r.details_json)]),
      [
        ['f-plat', 'org-a', { from: null, to: 'org-a' }],
        ['f-plat', 'org-a', { from: 'org-a', to: null }],
      ],
    );
  });

  test('a transfer needs a recent password', async () => {
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
    servers.push(server);
    await o.seedScenario(server);
    const adminToken = await h.loginAdmin(server);
    const res = await o.as(server, adminToken).post('/api/v1/admin/organizations/org-a/festivals', { festivalId: 'f-plat' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
  });

  test('a status change keeps its reason in the audit row', async () => {
    const { server, adminToken } = await boot();
    const admin = o.as(server, adminToken);
    assert.equal((await admin.put('/api/v1/admin/organizations/org-a/status', { status: 'suspended', reason: 'Chargeback dispute' })).status, 200);
    assert.equal((await admin.put('/api/v1/admin/organizations/org-a/status', { status: 'active' })).status, 200);
    const rows = await auditRows(server, 'organization.suspended');
    assert.deepEqual(rows.map((r: any) => JSON.parse(r.details_json)), [{ reason: 'Chargeback dispute' }]);
    assert.equal((await admin.put('/api/v1/admin/organizations/org-a/status', { status: 'suspended', reason: '' })).status, 400);
  });

  test('the review queue lists recent organizer edits of live festivals only', async () => {
    const { server, users, adminToken } = await boot();
    const row = (id: string, actorType: string, action: string, target: string, ago = '1 hour') =>
      o.sql(
        server,
        `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, organization_id, status, created_at)
         VALUES ($1, $2, $3, $4, 'festival', $5, 'org-a', 'success', NOW() - $6::interval)`,
        [id, actorType, users.editorA.id, action, target, ago],
      );
    await row('rf-live', 'organizer', 'festival.updated', 'f-a-live');
    await row('rf-draft', 'organizer', 'festival.updated', 'f-a');
    await row('rf-admin', 'admin', 'festival.updated', 'f-a-live');
    await row('rf-old', 'organizer', 'festival.updated', 'f-a-live', '15 days');
    await row('rf-request', 'organizer', 'festival.publish_requested', 'f-a-live');
    const queue = await o.as(server, adminToken).get('/api/v1/admin/organizations/review-queue');
    assert.equal(queue.status, 200);
    assert.deepEqual(
      queue.body.data.recentEdits.map((e: any) => [e.id, e.festivalId, e.organizationName]),
      [['rf-live', 'f-a-live', 'Org org-a']],
    );
    assert.equal((await o.as(server, users.ownerA.token).get('/api/v1/admin/organizations/review-queue')).status, 403);
  });

  test('a removed teammate reads as a former teammate in the activity view, and an admin as Festie support', async () => {
    const { server, users } = await boot();
    const { rows: admins } = await o.sql(server, "SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin' LIMIT 1");
    const insert = (id: string, actorType: string, actorId: string) =>
      o.sql(
        server,
        `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, organization_id, status, created_at)
         VALUES ($1, $2, $3, 'festival.updated', 'festival', 'f-a', 'org-a', 'success', NOW())`,
        [id, actorType, actorId],
      );
    await insert('rf-gone', 'organizer', 'a-removed-teammate');
    await insert('rf-staff', 'admin', admins[0].user_id);
    const view = await o.as(server, users.ownerA.token).get('/api/v1/manage/organizations/org-a/audit');
    assert.equal(view.status, 200);
    const actors = Object.fromEntries(view.body.data.map((e: any) => [e.id, e.actor]));
    assert.equal(actors['rf-gone'], 'A former teammate');
    assert.equal(actors['rf-staff'], 'Festie support');
  });

  test("a Festie row names its organization's festival and nothing else", async () => {
    const { server, users } = await boot();
    const { rows: admins } = await o.sql(server, "SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin' LIMIT 1");
    const insert = (id: string, targetId: string) =>
      o.sql(
        server,
        `INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, details_json, organization_id, status, created_at)
         VALUES ($1, 'admin', $2, 'festival.published', 'festival', $3, '{"note":"private"}', 'org-a', 'success', NOW())`,
        [id, admins[0].user_id, targetId],
      );
    await insert('rf-own', 'f-a');
    // A row filed under this organization but aimed at another organization's festival must not leak that name.
    await insert('rf-other', 'f-b');
    const view = await o.as(server, users.ownerA.token).get('/api/v1/manage/organizations/org-a/audit');
    assert.equal(view.status, 200);
    const details = Object.fromEntries(view.body.data.map((e: any) => [e.id, e.details]));
    assert.deepEqual(details['rf-own'], { name: 'Fest f-a' });
    assert.equal(details['rf-other'], null);
    assert.doesNotMatch(JSON.stringify(view.body), /private|Fest f-b/);
  });
});
