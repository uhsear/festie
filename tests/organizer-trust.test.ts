import 'dotenv/config';
/**
 * The trust tier of the organizer platform (plan-v3 phase 3): what a verified organization may do that an
 * unverified one may not, and the limits on both.
 *
 *   - announcements: a banner for every organization, a push only for a verified one, urgent never, a daily cap
 *   - the lineup drop: a verified owner only, push and inbox only, prior editions of its own festivals only, once a day
 *   - interest counts: a verified owner only, nothing below 20 joined users, counts below 5 hidden
 *   - the organization's activity view, the usage counters and the admin audit filter by organization
 *   - the moved-set alert run cap, and the trigger that forgets a hard-deleted user in the held alerts
 *
 * The first describes need no database. The others skip without TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { Pool } from 'pg';
import { createAnnouncer } from '../lib/announcements.js';
import { createStores } from '../lib/db/index.js';
import { createFestivalReviewStore } from '../lib/db/stores/festival-review.js';
import { ENGAGEMENT_MIN_COUNT, ENGAGEMENT_MIN_JOINED, organizerAudience, organizerEngagement } from '../lib/organizer-engagement.js';
import { createReengagementTriggers } from '../lib/notifications/reengagement.js';
import { ensureTestSchema, TEST_DATABASE_URL, skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

describe('organizerEngagement: the floor on what an organizer learns about attendees', () => {
  const picks = [
    { setId: 'big', picks: 9 },
    { setId: 'edge', picks: ENGAGEMENT_MIN_COUNT },
    { setId: 'small', picks: ENGAGEMENT_MIN_COUNT - 1 },
  ];
  const reminders = [{ setId: 'small', reminders: 2 }, { setId: '__proto__', reminders: 7 }];

  test('a festival with fewer than the minimum of joined users shows nothing at all', () => {
    const result = organizerEngagement(ENGAGEMENT_MIN_JOINED - 1, picks, reminders);
    assert.deepEqual(result, { available: false, minJoined: ENGAGEMENT_MIN_JOINED, minCount: ENGAGEMENT_MIN_COUNT, sets: {} });
  });

  test('at the minimum, a count below 5 is null and a count of 5 or more is shown, whatever the set id', () => {
    const { available, sets } = organizerEngagement(ENGAGEMENT_MIN_JOINED, picks, reminders);
    assert.equal(available, true);
    assert.deepEqual(sets.big, { picks: 9, reminders: null });
    assert.deepEqual(sets.edge, { picks: 5, reminders: null });
    assert.deepEqual(sets.small, { picks: null, reminders: null });
    assert.deepEqual(Object.getOwnPropertyDescriptor(sets, '__proto__')?.value, { picks: null, reminders: 7 });
  });
});

describe('organizerAudience', () => {
  test('hides a size below the floor and shows one at or above it', () => {
    assert.equal(organizerAudience(0), null);
    assert.equal(organizerAudience(ENGAGEMENT_MIN_JOINED - 1), null);
    assert.equal(organizerAudience(ENGAGEMENT_MIN_JOINED), ENGAGEMENT_MIN_JOINED);
  });
});

describe('the announcer pushes only a row that asks for it', () => {
  const run = async (push: boolean | undefined) => {
    const sent: any[] = [];
    const row = { id: 'a1', festivalId: 'f1', screen: 'home', title: 'T', body: 'B', ...(push === undefined ? {} : { push }) };
    const counts: number[] = [];
    const announcer = createAnnouncer({
      stores: {
        announcements: { expireLate: async () => 0, claimDue: async () => [row], setRecipientCount: async (_id: string, n: number) => void counts.push(n) },
        festivals: { getById: async () => ({ publishedAt: '2026-01-01T00:00:00.000Z' }) },
        profiles: { userIdsByFestival: async () => ['u1', 'u2'] },
      },
      notificationService: { isConfigured: true, sendToOfflineUsers: async (args: any) => void sent.push(args) },
      config: { PUBLIC_ORIGIN: 'https://festie.test' },
      log: { warn() {} },
    });
    await announcer.deliverDue();
    return { sent, counts };
  };

  test('a banner with push false still counts its audience and sends no push', async () => {
    const { sent, counts } = await run(false);
    assert.equal(sent.length, 0);
    assert.deepEqual(counts, [2]);
  });

  test('push true, and a row from before the column existed, send one push', async () => {
    assert.equal((await run(true)).sent.length, 1);
    assert.equal((await run(undefined)).sent.length, 1);
  });
});

describe('Integration: organizer trust tier', { skip, concurrency: 1 }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });
  after(() => {
    if (skip) console.log('organizer-trust: database half skipped (TEST_DATABASE_URL not set)');
  });

  const MANAGE = '/api/v1/manage';
  const ANNOUNCE = { severity: 'info', title: 'Gates open at noon', body: 'Bring water.' };

  // Scenario A, B, S, P (tests/_organizer-helpers.ts) plus a verified organization V with an owner and an editor.
  async function boot(overrides: Record<string, any> = {}) {
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000, ...overrides });
    servers.push(server);
    const users: any = await o.seedScenario(server);
    const stamp = Date.now();
    users.ownerV = await o.makeUser(server, `ownerV-${stamp}`);
    users.editorV = await o.makeUser(server, `editorV-${stamp}`);
    await o.seedOrg(server, 'org-v', 'active', true);
    await o.addMember(server, 'org-v', users.ownerV.id, 'owner');
    await o.addMember(server, 'org-v', users.editorV.id, 'editor');
    await o.seedFestival(server, 'f-v', 'org-v');
    await o.seedFestival(server, 'f-v-live', 'org-v', true);
    await o.seedFestival(server, 'f-b-live', 'org-b', true);
    const adminToken = await h.loginAdmin(server);
    return { server, users, adminToken };
  }

  const announce = (server: any, token: string | undefined, festivalId: string, body: Record<string, unknown> = ANNOUNCE) =>
    o.as(server, token).post(`${MANAGE}/festivals/${festivalId}/announcements`, body);

  describe('announcements', () => {
    test('an unverified owner posts a banner with no push; the stored row says so and the response hides the creator', async () => {
      const { server, users } = await boot();
      const res = await announce(server, users.ownerA.token, 'f-a-live');
      assert.equal(res.status, 201);
      assert.equal('createdBy' in res.body.data.announcement, false);
      assert.equal(res.body.data.recipients, null, 'fewer than the floor of joined users reads as null');
      const { rows } = await o.sql(server, 'SELECT push, organization_id, created_by FROM festival_announcements WHERE festival_id = $1', ['f-a-live']);
      assert.deepEqual(rows.map((r: any) => [r.push, r.organization_id, r.created_by]), [[false, 'org-a', users.ownerA.id]]);
    });

    test('a verified owner posts one that pushes', async () => {
      const { server, users } = await boot();
      assert.equal((await announce(server, users.ownerV.token, 'f-v-live')).status, 201);
      const { rows } = await o.sql(server, 'SELECT push, organization_id FROM festival_announcements WHERE festival_id = $1', ['f-v-live']);
      assert.deepEqual(rows.map((r: any) => [r.push, r.organization_id]), [[true, 'org-v']]);
    });

    test('an admin announcement still pushes, may be urgent, and does not count against the organization', async () => {
      const { server, adminToken } = await boot();
      const res = await announce(server, adminToken, 'f-a-live', { ...ANNOUNCE, severity: 'urgent' });
      assert.equal(res.status, 201);
      const { rows } = await o.sql(server, 'SELECT push, organization_id FROM festival_announcements WHERE festival_id = $1', ['f-a-live']);
      assert.deepEqual(rows.map((r: any) => [r.push, r.organization_id]), [[true, null]]);
    });

    test('who may and who may not: urgent, editor, viewer, another tenant, a draft', async () => {
      const { server, users } = await boot();
      const urgent = await announce(server, users.ownerA.token, 'f-a-live', { ...ANNOUNCE, severity: 'urgent' });
      assert.equal(urgent.status, 403);
      assert.match(urgent.body.error.message, /urgent/);
      assert.equal((await announce(server, users.editorA.token, 'f-a-live')).status, 403);
      assert.equal((await announce(server, users.viewerA.token, 'f-a-live')).status, 403);
      assert.equal((await announce(server, users.ownerB.token, 'f-a-live')).status, 404);
      assert.equal((await announce(server, users.stranger.token, 'f-a-live')).status, 404);
      assert.equal((await announce(server, users.ownerS.token, 'f-s-live')).status, 403, 'suspended');
      assert.equal((await announce(server, users.ownerA.token, 'f-a')).status, 409, 'a draft has no attendees');
      assert.equal((await o.sql(server, 'SELECT 1 FROM festival_announcements')).rowCount, 0);
    });

    test('the fourth announcement of an organization in a day is 429, and another organization is not affected', async () => {
      const { server, users } = await boot();
      for (let i = 0; i < 3; i++) assert.equal((await announce(server, users.ownerA.token, 'f-a-live')).status, 201);
      const fourth = await announce(server, users.ownerA.token, 'f-a-live');
      assert.equal(fourth.status, 429);
      assert.match(fourth.body.error.message, /3 announcements a day/);
      assert.equal((await announce(server, users.ownerV.token, 'f-v-live')).status, 201);
    });

    test('a cancelled announcement still counts toward the day, and the list hides who created it', async () => {
      const { server, users } = await boot();
      const created = await announce(server, users.ownerA.token, 'f-a-live', { ...ANNOUNCE, sendAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString() });
      assert.equal(created.status, 201);
      const id = created.body.data.announcement.id;
      const list = await o.as(server, users.ownerA.token).get(`${MANAGE}/festivals/f-a-live/announcements`);
      assert.equal(list.status, 200);
      assert.equal(list.body.data.announcements.some((a: any) => 'createdBy' in a), false);
      assert.equal((await o.as(server, users.ownerB.token).delete(`${MANAGE}/festivals/f-a-live/announcements/${id}`)).status, 404);
      assert.equal((await o.as(server, users.ownerA.token).delete(`${MANAGE}/festivals/f-a-live/announcements/${id}`)).status, 200);
      const { rows } = await o.sql(server, 'SELECT cancelled_at FROM festival_announcements WHERE id = $1', [id]);
      assert.notEqual(rows[0].cancelled_at, null);
      const cap = await o.sql(server, "SELECT COUNT(*)::int AS n FROM festival_announcements WHERE organization_id = 'org-a' AND created_at > NOW() - INTERVAL '24 hours'");
      assert.equal(cap.rows[0].n, 1, 'the cancelled row is still in the count the cap reads');
    });
  });

  describe('the lineup drop', () => {
    test('an unverified owner is refused, a verified owner of another organization sees 404', async () => {
      const { server, users } = await boot();
      const refused = await o.as(server, users.ownerA.token).get(`${MANAGE}/festivals/f-a-live/lineup-announcement`);
      assert.equal(refused.status, 403);
      assert.match(refused.body.error.message, /not verified/);
      assert.equal((await o.as(server, users.ownerA.token).post(`${MANAGE}/festivals/f-a-live/lineup-announcement`)).status, 403);
      assert.equal((await o.as(server, users.ownerV.token).get(`${MANAGE}/festivals/f-a-live/lineup-announcement`)).status, 404);
      assert.equal((await o.as(server, users.editorV.token).get(`${MANAGE}/festivals/f-v-live/lineup-announcement`)).status, 403, 'an editor never sends');
    });

    test('a verified owner counts and sends push only, once a day, and a draft is refused', async () => {
      const { server, users } = await boot();
      await o.sql(server, "INSERT INTO festival_follows (user_id, festival_id) VALUES ($1, 'f-v-live')", [users.stranger.id]);
      const count = await o.as(server, users.ownerV.token).get(`${MANAGE}/festivals/f-v-live/lineup-announcement`);
      assert.equal(count.status, 200);
      assert.equal(count.body.data.followers, null, 'a small audience is hidden from an organizer');
      assert.equal(count.body.data.emailRecipients, 0);
      assert.equal(count.body.data.emailOff, 'organizer');
      assert.equal((await o.as(server, users.ownerV.token).post(`${MANAGE}/festivals/f-v/lineup-announcement`)).status, 409);
      const sent = await o.as(server, users.ownerV.token).post(`${MANAGE}/festivals/f-v-live/lineup-announcement`);
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      const again = await o.as(server, users.ownerV.token).post(`${MANAGE}/festivals/f-v-live/lineup-announcement`);
      assert.equal(again.status, 429);
      assert.match(again.body.error.message, /today/);
    });
  });

  describe('interest counts', () => {
    const join = async (server: any, festivalId: string, count: number, start = 0) => {
      for (let i = start; i < start + count; i++) {
        const id = `eng-${festivalId}-${i}`;
        await o.sql(server, 'INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, NOW())', [id, id, 'x']);
        await o.sql(server, 'INSERT INTO festival_profiles (id, festival_id, user_id, created_at) VALUES ($1, $2, $3, NOW())', [`p-${id}`, festivalId, id]);
      }
    };

    test('only a verified owner reads them, only of its own festival', async () => {
      const { server, users, adminToken } = await boot();
      assert.equal((await o.as(server, users.ownerA.token).get(`${MANAGE}/festivals/f-a-live/engagement`)).status, 403);
      assert.equal((await o.as(server, users.editorV.token).get(`${MANAGE}/festivals/f-v-live/engagement`)).status, 403);
      assert.equal((await o.as(server, users.ownerV.token).get(`${MANAGE}/festivals/f-a-live/engagement`)).status, 404);
      assert.equal((await o.as(server, users.stranger.token).get(`${MANAGE}/festivals/f-v-live/engagement`)).status, 404);
      assert.equal((await o.as(server, adminToken).get(`${MANAGE}/festivals/no-such-fest/engagement`)).status, 404);
      assert.equal((await o.as(server, users.ownerV.token).get(`${MANAGE}/festivals/f-v-live/engagement`)).status, 200);
    });

    test('below the joined-user floor there is nothing; at it the answer is available', async () => {
      const { server, users } = await boot();
      await join(server, 'f-v-live', ENGAGEMENT_MIN_JOINED - 1);
      const below = await o.as(server, users.ownerV.token).get(`${MANAGE}/festivals/f-v-live/engagement`);
      assert.deepEqual(below.body.data, { available: false, minJoined: ENGAGEMENT_MIN_JOINED, minCount: ENGAGEMENT_MIN_COUNT, sets: {} });
      await join(server, 'f-v-live', 1, ENGAGEMENT_MIN_JOINED - 1);
      const at = await o.as(server, users.ownerV.token).get(`${MANAGE}/festivals/f-v-live/engagement`);
      assert.equal(at.body.data.available, true);
    });
  });

  describe('activity, usage and the audit filter', () => {
    test('an owner reads the organization activity: teammates by display name, Festie by label, never an id or an admin name', async () => {
      const { server, users, adminToken } = await boot();
      await o.sql(server, "UPDATE users SET display_name = 'Alex' WHERE id = $1", [users.editorA.id]);
      const saved = await o.as(server, users.editorA.token).put(`${MANAGE}/festivals/f-a`, { name: 'Renamed', expectedUpdatedAt: '2999-01-01T00:00:00Z' });
      assert.equal(saved.status, 200);
      const adminSaved = await o.as(server, adminToken).put(`/api/v1/admin/festivals/f-a`, { name: 'By Festie' });
      assert.equal(adminSaved.status, 200);
      const view = await o.as(server, users.ownerA.token).get(`${MANAGE}/organizations/org-a/audit`);
      assert.equal(view.status, 200);
      const text = JSON.stringify(view.body);
      const mine = view.body.data.find((row: any) => row.actor === 'Alex at Org org-a');
      assert.ok(mine, `the editor's save is listed by display name: ${text}`);
      const festie = view.body.data.filter((row: any) => row.actor === 'Festie support');
      assert.ok(festie.length > 0, 'the admin save is listed as Festie support');
      assert.ok(festie.every((row: any) => row.details === null), 'a Festie row carries no details');
      assert.equal(text.includes(users.editorA.username), false);
      assert.equal(text.includes('testadmin-'), false);
      assert.equal(text.includes('actorId'), false);
    });

    test('only an owner of that organization reads it', async () => {
      const { server, users } = await boot();
      assert.equal((await o.as(server, users.editorA.token).get(`${MANAGE}/organizations/org-a/audit`)).status, 403);
      assert.equal((await o.as(server, users.viewerA.token).get(`${MANAGE}/organizations/org-a/audit`)).status, 403);
      assert.equal((await o.as(server, users.ownerB.token).get(`${MANAGE}/organizations/org-a/audit`)).status, 404);
      assert.equal((await o.as(server, users.stranger.token).get(`${MANAGE}/organizations/org-a/audit`)).status, 404);
      assert.equal((await o.as(server, undefined).get(`${MANAGE}/organizations/org-a/audit`)).status, 401);
    });

    test('the admin audit list filters by organization', async () => {
      const { server, users, adminToken } = await boot();
      await o.as(server, users.editorA.token).put(`${MANAGE}/festivals/f-a`, { name: 'A edit', expectedUpdatedAt: '2999-01-01T00:00:00Z' }).expect(200);
      await o.as(server, users.ownerB.token).put(`${MANAGE}/festivals/f-b`, { name: 'B edit', expectedUpdatedAt: '2999-01-01T00:00:00Z' }).expect(200);
      const listed = await o.as(server, adminToken).get('/api/v1/admin/audit?scope=all&organization_id=org-a&limit=100');
      assert.equal(listed.status, 200);
      const targets = listed.body.data.map((row: any) => row.targetId);
      assert.ok(targets.includes('f-a'));
      assert.equal(targets.includes('f-b'), false);
    });

    test('the admin organization detail carries the usage counters', async () => {
      const { server, users, adminToken } = await boot();
      assert.equal((await announce(server, users.ownerA.token, 'f-a-live')).status, 201);
      const detail = await o.as(server, adminToken).get('/api/v1/admin/organizations/org-a');
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body.data.usage, { festivals: 2, drafts: 1, announcementsThisMonth: 1, uploadedBytes: 0 });
    });
  });
});

describe('Integration: moved-set alert runs, the lineup-drop audience and held user ids', { skip, concurrency: 1 }, () => {
  let pool: Pool;
  let stores: any;

  const log = { info() {}, warn() {}, debug() {}, error() {} };
  const festival = (id: string, name: string, organizationId: string | null) => ({
    id,
    name,
    location: 'Somewhere',
    stages: [],
    days: [],
    publishedAt: new Date().toISOString(),
    organizationId,
  });

  async function attend(userId: string, festivalId: string) {
    await pool.query('INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING', [userId, userId, 'x']);
    await pool.query('INSERT INTO festival_profiles (id, festival_id, user_id, created_at) VALUES ($1, $2, $3, NOW())', [`${festivalId}-${userId}`, festivalId, userId]);
  }

  async function seed() {
    await pool.query('TRUNCATE festival_follows, festival_profiles, festival_sets, festival_days, festival_stages, festivals, organizations, users CASCADE');
    await pool.query("INSERT INTO organizations (id, name, status) VALUES ('org-x', 'Org X', 'active'), ('org-y', 'Org Y', 'active')");
  }

  const triggers = () =>
    createReengagementTriggers({
      stores: {
        users: { getByIds: async () => new Map() },
        notificationLog: { existsForEvent: async () => false, existsForEvents: async () => new Set<string>() },
      },
      config: { PUBLIC_ORIGIN: 'https://festie.test', RESEND_API_KEY: '' },
      log,
      notificationService: { isConfigured: false },
      pool,
    } as any);

  test('a festival of an organization is announced only to its own prior editions; an admin send is unscoped', async () => {
    if (skip) return;
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      stores = createStores(pool);
      await seed();
      await stores.festivals.create({ ...festival('x-2025', 'Same Fest 2025', 'org-x') });
      await stores.festivals.create({ ...festival('y-2025', 'Same Fest 2025', 'org-y') });
      await stores.festivals.create({ ...festival('p-2025', 'Same Fest 2025', null) });
      await stores.festivals.create({ ...festival('x-2026', 'Same Fest 2026', 'org-x') });
      await attend('fan-x', 'x-2025');
      await attend('fan-y', 'y-2025');
      await attend('fan-p', 'p-2025');
      const dry = (organizationId?: string) => triggers().countLineupDrop('x-2026', organizationId) as Promise<any>;
      const admin = await dry();
      assert.equal(admin.priorAttendees, 3, 'an admin send reaches every edition of the name');
      const scoped = await dry('org-x');
      assert.equal(scoped.priorAttendees, 1, 'an organization reaches only its own editions');
      assert.deepEqual([scoped.emailRecipients, scoped.emailCut, scoped.emailOff], [0, 0, 'organizer']);
      assert.equal((await dry('org-y')).priorAttendees, 1, 'the scope is the sender, not the festival: org-y sees its own edition only');
    } finally {
      await pool.end();
    }
  });

  test('takeAlertRun lets a festival send the capped number of runs per hour, counts concurrent saves, and is per festival', async () => {
    if (skip) return;
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      stores = createStores(pool);
      await seed();
      await stores.festivals.create({ ...festival('run-a', 'Run A', 'org-x') });
      await stores.festivals.create({ ...festival('run-b', 'Run B', 'org-x') });
      const review = createFestivalReviewStore(pool);
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => review.takeAlertRun('run-a', 3)));
      assert.equal(results.filter(Boolean).length, 3, 'five saves at once take exactly three runs');
      assert.equal(await review.alertRunsLeft('run-a', 3), 0);
      assert.equal(await review.takeAlertRun('run-a', 3), false);
      assert.equal(await review.takeAlertRun('run-b', 3), true, 'another festival has its own runs');
      assert.equal(await review.alertRunsLeft('run-b', 3), 2);
      await pool.query("UPDATE festival_schedule_alert_runs SET created_at = NOW() - INTERVAL '61 minutes' WHERE festival_id = 'run-a'");
      assert.equal(await review.takeAlertRun('run-a', 3), true, 'runs older than an hour no longer count');
    } finally {
      await pool.end();
    }
  });

  test('hard-deleting a user takes the id out of the held alerts, so retention does not abort', async () => {
    if (skip) return;
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      stores = createStores(pool);
      await seed();
      await stores.festivals.create({ ...festival('held-f', 'Held', 'org-x') });
      for (const id of ['gone', 'stays']) await pool.query('INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, NOW())', [id, id, 'x']);
      await pool.query(
        `INSERT INTO festival_held_schedule_changes (festival_id, set_id, kind, artist, picker_ids, interest_holder_ids)
         VALUES ('held-f', 's1', 'moved', 'A', ARRAY['gone', 'stays'], ARRAY['gone'])`,
      );
      await pool.query("DELETE FROM users WHERE id = 'gone'");
      const { rows } = await pool.query("SELECT picker_ids, interest_holder_ids FROM festival_held_schedule_changes WHERE festival_id = 'held-f'");
      assert.deepEqual(rows[0], { picker_ids: ['stays'], interest_holder_ids: [] });
    } finally {
      await pool.end();
    }
  });
});
