import 'dotenv/config';
/**
 * Fixes from the review of the organizer platform: the flag, member emails, the atomic daily limits, the labels of
 * former teammates, the held-alert release and the purge of mailed addresses.
 *
 * The first describe uses mocked deps and needs no database. The others run the stores or the real app on the
 * throwaway test database and skip without TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import createLineupAnnounceRoutes from '../routes/lineup-announce.js';
import createOrganizationsRoutes from '../routes/organizations.js';
import { createAnnouncementsStore } from '../lib/db/stores/announcements.js';
import { createFestivalReviewStore } from '../lib/db/stores/festival-review.js';
import { createOrganizationsStore } from '../lib/db/stores/organizations.js';
import { ensureTestSchema, skip, TEST_DATABASE_URL } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

const pass = () => (_req: any, _res: any, next: any) => next();
const log = { info() {}, warn() {}, error() {}, debug() {} };
const sendSuccess = (res: any, data: any) => res.json({ data, error: null });
const sendError = (res: any, status: number, message: string, code?: string) => res.status(status).json({ data: null, error: { message, code } });
const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DRAFT: 'DRAFT',
};

describe('admin organization routes with mocked deps', () => {
  function build({ scheduleChanged = mock.fn(async (_arg: unknown) => ({ ok: true })) } = {}) {
    const hold = mock.fn(async (_id: string, _alert: unknown) => ({ held: 1, people: 1 }));
    const send = mock.fn(async (_arg: any) => true);
    const alert = { changes: [{ kind: 'removed', setId: 's1', artist: 'A' }], pickersBySet: new Map([['s1', ['u1']]]) };
    const deps: any = {
      express,
      log,
      config: { MARK: 'config' },
      emitter: { scheduleChanged },
      stores: {
        organizations: {
          addByEmail: async (_id: string, email: string, role: string) => ({ kind: 'pending', email, role }),
          getById: async () => ({ id: 'org-a', name: 'Org A' }),
        },
        festivals: { getById: async (id: string) => ({ id, name: 'Fest' }) },
        festivalReview: { claimHeld: async () => ({ rows: 1, alert }), hold },
        auditLog: { insert: async () => {} },
      },
      festivalAccess: () => (req: any, _res: any, next: any) => {
        req.festivalId = req.params.festivalId;
        next();
      },
      schemas: {},
      validate: pass,
      validateQuery: pass,
      validateParams: pass,
      rateLimit: pass,
      requireRecentAuth: (_req: any, _res: any, next: any) => next(),
      getRequestIp: () => '127.0.0.1',
      setNoStore: () => {},
      sendSuccess,
      sendError,
      ErrorCodes,
      sendOrganizationMemberEmail: send,
    };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.user = { userId: 'admin-1' };
      req.validatedParams = req.params;
      req.validatedBody = req.body;
      next();
    });
    app.use('/orgs', createOrganizationsRoutes(deps));
    return { app, send, hold, scheduleChanged, alert };
  }

  test('an admin who adds a member sends the fixed-template email, the same as an owner does', async () => {
    const { app, send } = build();
    const res = await request(app).post('/orgs/org-a/members').send({ email: 'venue@example.com', role: 'owner' }).expect(201);
    assert.equal(res.body.data.emailed, true);
    assert.equal(send.mock.callCount(), 1);
    const arg = send.mock.calls[0]!.arguments[0];
    assert.deepEqual([arg.to, arg.organizationName, arg.role], ['venue@example.com', 'Org A', 'owner']);
  });

  test('a mail failure does not fail the add', async () => {
    const { app, send } = build();
    send.mock.mockImplementation(async () => {
      throw new Error('smtp down');
    });
    const res = await request(app).post('/orgs/org-a/members').send({ email: 'venue@example.com', role: 'editor' }).expect(201);
    assert.equal(res.body.data.emailed, false);
  });

  test('releasing held alerts puts them back when the whole send failed, and says so', async () => {
    const { app, hold, alert } = build({ scheduleChanged: mock.fn(async (_arg: unknown) => ({ ok: false })) });
    const res = await request(app).post('/orgs/held-alerts/f-1/release').expect(503);
    assert.match(res.body.error.message, /held again/);
    assert.equal(hold.mock.callCount(), 1);
    assert.deepEqual(hold.mock.calls[0]!.arguments, ['f-1', alert]);
  });

  test('releasing held alerts that went out holds nothing back', async () => {
    const { app, hold } = build();
    const res = await request(app).post('/orgs/held-alerts/f-1/release').expect(200);
    assert.equal(res.body.data.released, 1);
    assert.equal(hold.mock.callCount(), 0);
  });
});

describe('the lineup announcement of an organization with mocked deps', () => {
  function build({ followers = 0, priorAttendees = 0, claim = 7 as number | null } = {}) {
    const claimLineupAnnounce = mock.fn(async (_id: string) => claim);
    const releaseLineupAnnounce = mock.fn(async (_claimId: number) => {});
    const sendLineupDrop = mock.fn(async (_id: string, _scope?: string) => {});
    const deps: any = {
      express,
      log,
      festivalAccess: () => (req: any, _res: any, next: any) => {
        req.festivalId = req.params.id;
        req.festivalRole = 'owner';
        req.organizationId = 'org-a';
        next();
      },
      rateLimit: pass,
      sendSuccess,
      sendError,
      ErrorCodes,
      stores: { festivalReview: { claimLineupAnnounce, releaseLineupAnnounce }, auditLog: { insert: async () => {} } },
      getFestivalById: async (id: string) => ({ id, name: 'Fest', publishedAt: '2026-01-01T00:00:00.000Z' }),
      getRequestIp: () => '127.0.0.1',
      reengagement: { sendLineupDrop },
      reengagementExecutor: {
        countLineupDrop: async () => ({ festivalName: 'Fest', recipients: followers + priorAttendees, followers, priorAttendees }),
      },
    };
    const app = express();
    app.use(express.json());
    app.use('/f', createLineupAnnounceRoutes(deps));
    return { app, claimLineupAnnounce, releaseLineupAnnounce, sendLineupDrop };
  }

  test('an empty audience is answered like any other: an organizer is never told it is exactly zero', async () => {
    const { app, sendLineupDrop } = build({ followers: 0, priorAttendees: 0 });
    const res = await request(app).post('/f/f-1/lineup-announcement').expect(200);
    assert.deepEqual(res.body.data, { queued: true, recipients: null });
    assert.equal(sendLineupDrop.mock.callCount(), 1);
  });

  test('a claimed day is 429 and sends nothing', async () => {
    const { app, sendLineupDrop } = build({ followers: 30, claim: null });
    const res = await request(app).post('/f/f-1/lineup-announcement').expect(429);
    assert.match(res.body.error.message, /today/);
    assert.equal(sendLineupDrop.mock.callCount(), 0);
  });

  test('a send that fails gives the day back', async () => {
    const { app, sendLineupDrop, releaseLineupAnnounce } = build({ followers: 30 });
    sendLineupDrop.mock.mockImplementation(async () => {
      throw new Error('queue down');
    });
    await request(app).post('/f/f-1/lineup-announcement').expect(500);
    assert.deepEqual(releaseLineupAnnounce.mock.calls[0]!.arguments, [7]);
  });
});

describe('the stores, on a database', { skip }, () => {
  let pool: Pool;

  async function setup() {
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query("INSERT INTO organizations (id, name, kind, status) VALUES ('rf-org', 'Review Fix Org', 'venue', 'active') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ('rf-fest', 'RF', 'X', NOW(), NOW()) ON CONFLICT DO NOTHING");
  }

  async function teardown() {
    await pool.query("DELETE FROM festival_announcements WHERE organization_id = 'rf-org'");
    await pool.query("DELETE FROM festival_lineup_announce_claims WHERE festival_id = 'rf-fest'");
    await pool.query("DELETE FROM festivals WHERE id = 'rf-fest'");
    await pool.query("DELETE FROM organization_member_emails WHERE organization_id = 'rf-org'");
    await pool.query("DELETE FROM organizations WHERE id = 'rf-org'");
    await pool.end();
  }

  test('parallel announcements cannot pass the organization daily cap', async () => {
    await setup();
    try {
      const store = createAnnouncementsStore(pool);
      const make = (i: number) => ({
        id: `rf-ann-${Date.now()}-${i}`,
        festivalId: 'rf-fest',
        severity: 'info',
        title: 'T',
        body: 'B',
        screen: 'home',
        sendAt: new Date().toISOString(),
        createdBy: null,
        push: false,
        organizationId: 'rf-org',
      });
      const results = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => store.createWithinOrganizationCap(make(i), 2)));
      assert.equal(results.filter(Boolean).length, 2);
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM festival_announcements WHERE organization_id = 'rf-org'");
      assert.equal(rows[0].n, 2);
    } finally {
      await teardown();
    }
  });

  test('parallel lineup announcements claim the day once, and a released claim opens it again', async () => {
    await setup();
    try {
      const review = createFestivalReviewStore(pool);
      const claims = await Promise.all([1, 2, 3, 4, 5].map(() => review.claimLineupAnnounce('rf-fest')));
      const won = claims.filter((id) => id !== null);
      assert.equal(won.length, 1);
      assert.equal(await review.claimLineupAnnounce('rf-fest'), null);
      await review.releaseLineupAnnounce(won[0] as number);
      assert.notEqual(await review.claimLineupAnnounce('rf-fest'), null);
    } finally {
      await teardown();
    }
  });

  test('a mailed address is purged after two days, and the cap still reads the last 24 hours', async () => {
    await setup();
    try {
      await pool.query("INSERT INTO users (id, username, password_hash, created_at) VALUES ('rf-owner', 'rf-owner', 'x', NOW()) ON CONFLICT DO NOTHING");
      await pool.query(
        "INSERT INTO organization_member_emails (organization_id, email, created_at) VALUES ('rf-org', 'old@example.com', NOW() - INTERVAL '3 days'), ('rf-org', 'recent@example.com', NOW() - INTERVAL '30 hours')",
      );
      const store = createOrganizationsStore(pool);
      const added = await store.addByEmail('rf-org', 'new@example.com', 'viewer', 'rf-owner', 10, { byOwner: true });
      assert.equal(added.kind, 'pending');
      const { rows } = await pool.query("SELECT email FROM organization_member_emails WHERE organization_id = 'rf-org' ORDER BY email");
      assert.deepEqual(rows.map((r: any) => r.email), ['new@example.com', 'recent@example.com']);
    } finally {
      await pool.query("DELETE FROM users WHERE id = 'rf-owner'");
      await teardown();
    }
  });

  test('an owner add is always pending and never names an account, an admin add of a confirmed account joins', async () => {
    await setup();
    try {
      const stamp = Date.now();
      await pool.query(
        "INSERT INTO users (id, username, password_hash, email, email_verified_at, created_at) VALUES ($1, $2, 'x', $3, NOW(), NOW())",
        [`rf-acct-${stamp}`, `rf-acct-${stamp}`, `acct-${stamp}@example.com`],
      );
      const store = createOrganizationsStore(pool);
      const known = await store.addByEmail('rf-org', `acct-${stamp}@example.com`, 'editor', null, 10, { byOwner: true });
      const unknown = await store.addByEmail('rf-org', `nobody-${stamp}@example.com`, 'editor', null, 10, { byOwner: true });
      assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
      assert.deepEqual([known.kind, 'userId' in known], ['pending', false]);
      assert.equal((await pool.query("SELECT 1 FROM organization_members WHERE organization_id = 'rf-org'")).rowCount, 0);
      const byAdmin = await store.addByEmail('rf-org', `acct-${stamp}@example.com`, 'viewer', null);
      assert.equal(byAdmin.kind, 'member');
    } finally {
      await pool.query("DELETE FROM organization_members WHERE organization_id = 'rf-org'");
      await pool.query("DELETE FROM organization_pending_members WHERE organization_id = 'rf-org'");
      await pool.query("DELETE FROM users WHERE id LIKE 'rf-acct-%'");
      await teardown();
    }
  });

  test('a removed teammate reads as a former teammate, and only a platform admin reads as Festie support', async () => {
    await setup();
    try {
      const stamp = Date.now();
      const [member, former, admin] = [`rf-m-${stamp}`, `rf-f-${stamp}`, `rf-a-${stamp}`];
      for (const id of [member, former, admin]) {
        await pool.query("INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES ($1, $2, 'x', 'Alex', NOW())", [id, id]);
      }
      await pool.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ('rf-org', $1, 'owner')", [member]);
      const { rows: role } = await pool.query("SELECT id FROM roles WHERE name = 'admin' LIMIT 1");
      await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [admin, role[0].id]);
      const store = createOrganizationsStore(pool);
      assert.equal(await store.editorLabel('rf-org', member), 'Alex at Review Fix Org');
      assert.equal(await store.editorLabel('rf-org', former), 'A former teammate');
      assert.equal(await store.editorLabel('rf-org', admin), 'Festie support');
      assert.equal(await store.editorLabel('rf-org', null), null);
    } finally {
      await pool.query("DELETE FROM user_roles WHERE user_id LIKE 'rf-a-%'");
      await pool.query("DELETE FROM organization_members WHERE organization_id = 'rf-org'");
      await pool.query("DELETE FROM users WHERE id LIKE 'rf-%'");
      await teardown();
    }
  });
});

describe('the real app with the organizer platform off', { skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });

  test('an admin has no organizations routes and /auth/me reports the platform as off for a former member', async () => {
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000, ORGANIZER_PLATFORM_ENABLED: 'false' });
    servers.push(server);
    const users = await o.seedScenario(server);
    const adminToken = await h.loginAdmin(server);
    assert.equal((await o.as(server, adminToken).get('/api/v1/admin/organizations')).status, 404);
    const me = await o.as(server, users.ownerA.token).get('/api/v1/auth/me');
    assert.deepEqual([me.body.data.organizations, me.body.data.organizerPlatform], [[], false]);
  });

  test('with the platform on, /auth/me lists the organizations and reports the platform as on', async () => {
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
    servers.push(server);
    const users = await o.seedScenario(server);
    const me = await o.as(server, users.ownerA.token).get('/api/v1/auth/me');
    assert.deepEqual(me.body.data.organizations.map((x: any) => x.id), ['org-a']);
    assert.equal(me.body.data.organizerPlatform, true);
  });
});
