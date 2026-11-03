/**
 * GET /api/v1/account/export (exportVersion 1.2): the records a user wrote in
 * crews and on sets, the stored location on crew statuses, the session device
 * label and the sharing settings.
 *
 * The first block maps rows from a stub pool and runs without a database. The
 * second block is DB-gated like tests/account.test.ts (TEST_DATABASE_URL).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createAccountRoutes from '../routes/account';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
// The shared helpers exit the process without a test database, so load them only when it exists.
const helpers = skip ? null : await import('./_integration-helpers');

const SECTIONS = [
  'ratings',
  'caught',
  'followedFestivals',
  'expenses',
  'pollsCreated',
  'pollVotes',
  'packingItems',
  'rides',
  'rideSeats',
  'meetingPoints',
  'crewActivity',
  'calendarFeeds',
  'paymentRemindersSent',
  'crewDays',
  'meetingPointsComing',
];

// Each pattern picks the stub rows for one section's query.
const SECTION_TABLES: Record<string, RegExp> = {
  ratings: /FROM\s+set_ratings/,
  caught: /FROM\s+set_caught/,
  followedFestivals: /FROM\s+festival_follows/,
  expenses: /FROM\s+crew_expenses/,
  pollsCreated: /FROM\s+crew_polls\s+WHERE/,
  pollVotes: /FROM\s+crew_poll_votes/,
  packingItems: /FROM\s+crew_packing_items/,
  rides: /FROM\s+crew_ride_offers\s+WHERE/,
  rideSeats: /FROM\s+crew_ride_passengers/,
  meetingPoints: /FROM\s+crew_meeting_points\s+WHERE/,
  crewActivity: /FROM\s+crew_activity/,
  calendarFeeds: /FROM\s+calendar_tokens/,
  paymentRemindersSent: /FROM\s+crew_expense_reminders/,
  crewDays: /FROM\s+crew_member_days/,
  meetingPointsComing: /FROM\s+crew_meeting_point_coming/,
};

function stubExportApp(
  answer: (sql: string) => unknown[],
  warnings: unknown[] = [],
  stores: Record<string, unknown> = {},
) {
  const passThrough = (_req: any, _res: any, next: any) => next();
  const deps: any = {
    express,
    config: {},
    log: { info() {}, warn: (...args: unknown[]) => warnings.push(args), error() {}, debug() {} },
    redis: null,
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'u1', username: 'exporter' };
      next();
    },
    handleAvatarUpload: passThrough,
    rateLimit: () => passThrough,
    validate: () => passThrough,
    schemas: {},
    setNoStore: () => {},
    getUserById: async (id: string) => ({ id, username: 'exporter' }),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string, details: any = null) =>
      res.status(status).json({ data: null, error: { message, code, ...(details || {}) } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', RATE_LIMITED: 'RATE_LIMITED', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    stores: {
      profiles: { getByUserId: async () => [] },
      pool: { query: async (sql: string) => ({ rows: answer(sql) }) },
      shareLinks: { getStatus: async () => ({ publicSchedule: true, linksResetAt: '2026-06-01T00:00:00.000Z' }) },
      identities: { listByUser: async () => [] },
      sessions: {
        listUserSessions: async () => [
          { token: 'secret-session-token', createdAt: 1, lastAccess: 2, deviceLabel: 'Pixel 9' },
          { token: 'other-token', createdAt: 1, lastAccess: 2 },
        ],
      },
      crewStatus: {
        listByUser: async () => [
          {
            crew_id: 'c1',
            status: 'here',
            latitude: 28.1,
            longitude: -81.6,
            location_captured_at: '2026-06-05T20:00:00Z',
          },
        ],
      },
      ...stores,
    },
  };
  const app = express();
  app.use(createAccountRoutes(deps));
  return app;
}

describe('account export 1.2 records (stub pool, no database)', () => {
  test('maps every section to the camelCase contract', async () => {
    const at = new Date('2026-06-05T18:00:00Z');
    const iso = at.toISOString();
    const rows: Record<string, unknown[]> = {
      ratings: [
        { set_id: 's1', festival_id: 'f1', artist: 'Alpha', rating: 4, note: 'loud', created_at: at, updated_at: at },
      ],
      caught: [{ set_id: 's1', festival_id: 'f1', artist: 'Alpha', caught: true, updated_at: at }],
      followedFestivals: [{ festival_id: 'f1', festival_name: 'Fest One', created_at: at }],
      expenses: [
        {
          id: 'e1',
          crew_id: 'c1',
          description: 'Gas',
          amount: '12.50',
          category: 'travel',
          planned: false,
          paid_by_you: false,
          added_by_you: false,
          your_share_cents: 450,
          created_at: at,
          updated_at: null,
          confirmed_at: at,
          disputed_at: null,
        },
      ],
      pollsCreated: [
        {
          id: 'p1',
          crew_id: 'c1',
          question: 'Which stage?',
          options: ['Main', 'Forest'],
          multi_answer: true,
          created_at: at,
          closed_at: null,
        },
      ],
      pollVotes: [{ poll_id: 'p2', crew_id: 'c1', question: 'Food?', options: ['Tacos', 'Pizza'], voted_at: at }],
      packingItems: [
        {
          id: 'k1',
          crew_id: 'c1',
          label: 'Tent',
          added_by_you: false,
          bringing: true,
          claimed: true,
          packed: false,
          created_at: at,
        },
      ],
      rides: [
        {
          id: 'r1',
          crew_id: 'c1',
          driver: 'Me',
          seats: 3,
          direction: 'home',
          depart_from: 'Lot B',
          depart_at: 'Fri 9am',
          depart_time: at,
          note: null,
          created_at: at,
        },
      ],
      rideSeats: [{ ride_id: 'r2', crew_id: 'c1', created_at: at }],
      meetingPoints: [
        {
          id: 'm1',
          crew_id: 'c1',
          label: 'Tree',
          location: 'By the tree',
          latitude: 28.2,
          longitude: -81.5,
          type: 'during',
          meet_at: null,
          created_at: at,
        },
      ],
      crewActivity: [{ crew_id: 'c1', type: 'expense-added', detail: '$20.00 to ana', created_at: at }],
      calendarFeeds: [{ festival_id: 'f1', created_at: at }],
      paymentRemindersSent: [{ crew_id: 'c1', sent_on: '2026-06-05' }],
      crewDays: [{ crew_id: 'c1', day_index: 0, answer: 'going', updated_at: at }],
      meetingPointsComing: [{ meeting_point_id: 'm9', crew_id: 'c1', created_at: at }],
    };
    const app = stubExportApp((sql) => {
      const name = Object.keys(SECTION_TABLES).find((key) => SECTION_TABLES[key]!.test(sql));
      return name ? rows[name]! : [];
    });

    const res = await request(app).get('/export');
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.exportVersion, '1.2');
    assert.equal('messages' in data, false);
    for (const name of SECTIONS) assert.equal(data[name].length, 1, name);

    assert.deepEqual(data.user.sharing, { publicSchedule: true, linksResetAt: '2026-06-01T00:00:00.000Z' });
    assert.deepEqual(
      data.sessions.map((s: any) => s.deviceLabel),
      ['Pixel 9', null],
    );
    assert.deepEqual(
      [data.crewStatuses[0].latitude, data.crewStatuses[0].longitude, data.crewStatuses[0].locationCapturedAt],
      [28.1, -81.6, '2026-06-05T20:00:00.000Z'],
    );

    assert.deepEqual(data.ratings[0], {
      setId: 's1',
      festivalId: 'f1',
      artist: 'Alpha',
      rating: 4,
      note: 'loud',
      createdAt: iso,
      updatedAt: iso,
    });
    assert.deepEqual(data.caught[0], { setId: 's1', festivalId: 'f1', artist: 'Alpha', caught: true, updatedAt: iso });
    assert.deepEqual(data.followedFestivals[0], { festivalId: 'f1', festivalName: 'Fest One', followedAt: iso });
    assert.deepEqual(data.expenses[0], {
      id: 'e1',
      crewId: 'c1',
      description: 'Gas',
      amount: 12.5,
      category: 'travel',
      planned: false,
      paidByYou: false,
      addedByYou: false,
      yourShareCents: 450,
      createdAt: iso,
      updatedAt: null,
      confirmedAt: iso,
      disputedAt: null,
    });
    assert.deepEqual(data.pollsCreated[0], {
      id: 'p1',
      crewId: 'c1',
      question: 'Which stage?',
      options: ['Main', 'Forest'],
      multiAnswer: true,
      createdAt: iso,
      closedAt: null,
    });
    assert.deepEqual(data.pollVotes[0], {
      pollId: 'p2',
      crewId: 'c1',
      question: 'Food?',
      options: ['Tacos', 'Pizza'],
      votedAt: iso,
    });
    assert.deepEqual(data.packingItems[0], {
      id: 'k1',
      crewId: 'c1',
      label: 'Tent',
      addedByYou: false,
      bringing: true,
      claimed: true,
      packed: false,
      createdAt: iso,
    });
    assert.deepEqual(data.rides[0], {
      id: 'r1',
      crewId: 'c1',
      driver: 'Me',
      seats: 3,
      direction: 'home',
      departFrom: 'Lot B',
      departAt: 'Fri 9am',
      departTime: iso,
      note: null,
      createdAt: iso,
    });
    assert.deepEqual(data.rideSeats[0], { rideId: 'r2', crewId: 'c1', joinedAt: iso });
    assert.equal(data.meetingPoints[0].latitude, 28.2);
    assert.equal(data.meetingPoints[0].meetAt, null);
    assert.deepEqual(data.crewActivity[0], {
      crewId: 'c1',
      type: 'expense-added',
      detail: '$20.00 to ana',
      createdAt: iso,
    });
    assert.deepEqual(data.calendarFeeds[0], { festivalId: 'f1', createdAt: iso });
    assert.deepEqual(data.paymentRemindersSent[0], { crewId: 'c1', sentOn: '2026-06-05' });
    assert.deepEqual(data.crewDays[0], { crewId: 'c1', dayIndex: 0, answer: 'going', updatedAt: iso });
    assert.deepEqual(data.meetingPointsComing[0], { meetingPointId: 'm9', crewId: 'c1', createdAt: iso });

    const text = JSON.stringify(data);
    assert.ok(!text.includes('secret-session-token'), 'no session token');
    assert.ok(!text.includes('other-token'), 'no session token');
  });

  test('every section that fails exports [] and logs gdpr-export:partial-failure', async () => {
    for (const name of SECTIONS) {
      const warnings: any[] = [];
      const app = stubExportApp((sql) => {
        if (SECTION_TABLES[name]!.test(sql)) throw new Error('relation missing');
        return [];
      }, warnings);

      const res = await request(app).get('/export');
      assert.equal(res.status, 200, name);
      assert.deepEqual(res.body.data[name], [], name);
      const failures = warnings.filter(([event]) => event === 'gdpr-export:partial-failure');
      assert.deepEqual(
        failures.map(([, meta]) => meta.section),
        [name],
      );
    }
  });

  test('a failing sharing lookup exports the safe default and logs the section', async () => {
    const warnings: any[] = [];
    const app = stubExportApp(() => [], warnings, {
      shareLinks: {
        getStatus: async () => {
          throw new Error('db down');
        },
      },
    });

    const res = await request(app).get('/export');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.user.sharing, { publicSchedule: false, linksResetAt: null });
    assert.ok(warnings.some(([event, meta]) => event === 'gdpr-export:partial-failure' && meta.section === 'sharing'));
  });

  test('every section query takes the user id as its only parameter', async () => {
    const calls: unknown[][] = [];
    const { collectAuthoredRecords } = await import('../lib/account-export-records');
    await collectAuthoredRecords(
      {
        query: (async (_sql: string, params: unknown[]) => {
          calls.push(params);
          return { rows: [] };
        }) as any,
      },
      'u1',
      { warn: () => {} },
    );
    assert.equal(calls.length, SECTIONS.length);
    for (const params of calls) assert.deepEqual(params, ['u1']);
  });
});

describe('account export 1.2 records (database)', { concurrency: 1, skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });

  test('exports every record of the user and nothing private of another member', async () => {
    const h = helpers!;
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
    servers.push(server);
    const tag = Date.now().toString(36);
    const register = async (name: string) => {
      const data = await h.registerUser(server, name);
      return { id: data.user.id as string, token: data.token as string };
    };
    const me = await register(`exp-me-${tag}`);
    const other = await register(`exp-ot-${tag}`);

    const pool = new h.Pool({ connectionString: h.TEST_DATABASE_URL });
    let shareToken = '';
    let hasCrewDays = false;
    let hasIdentities = false;
    try {
      const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
      hasCrewDays = (await q("SELECT to_regclass('crew_member_days') IS NOT NULL AS ok")).rows[0].ok;
      hasIdentities = (await q("SELECT to_regclass('user_identities') IS NOT NULL AS ok")).rows[0].ok;

      await q(
        "INSERT INTO crews (id, festival_id, name, created_by) VALUES ('c-me', 'fest-1', 'Mine', $1), ('c-other', 'fest-1', 'Theirs', $2)",
        [me.id, other.id],
      );
      await q(
        "INSERT INTO crew_members (crew_id, user_id, role) VALUES ('c-me', $1, 'owner'), ('c-me', $2, 'member'), ('c-other', $2, 'owner')",
        [me.id, other.id],
      );
      await q(
        "INSERT INTO set_ratings (user_id, set_id, rating, note) VALUES ($1, 'set-a', 4, 'loud'), ($2, 'set-a', 1, 'theirs')",
        [me.id, other.id],
      );
      await q("INSERT INTO set_caught (user_id, set_id, caught) VALUES ($1, 'set-a', TRUE), ($2, 'set-a', FALSE)", [
        me.id,
        other.id,
      ]);
      await q("INSERT INTO festival_follows (user_id, festival_id) VALUES ($1, 'fest-1'), ($2, 'fest-1')", [
        me.id,
        other.id,
      ]);
      await q(
        `INSERT INTO crew_expenses (id, crew_id, paid_by, created_by, description, amount, split_with, split_amounts) VALUES
           ('e-paid', 'c-me', $1, $1, 'Gas', 12.50, jsonb_build_array($1::text, $2::text), NULL),
           ('e-uneven', 'c-me', $2, $2, 'Ice', 30, jsonb_build_array($1::text, $2::text), jsonb_build_object($1::text, 1000, $2::text, 2000)),
           ('e-even', 'c-me', $2, $2, 'Water', 9, '[]'::jsonb, NULL),
           ('e-unrelated', 'c-other', $2, $2, 'Snacks', 9, jsonb_build_array($2::text), NULL)`,
        [me.id, other.id],
      );
      await q(
        `INSERT INTO crew_polls (id, crew_id, created_by, question, options, multi_answer) VALUES
           ('p-theirs', 'c-me', $2, 'Which stage?', '["Main","Forest"]', TRUE),
           ('p-mine', 'c-me', $1, 'Food?', '["Tacos","Pizza"]', FALSE)`,
        [me.id, other.id],
      );
      await q(
        `INSERT INTO crew_poll_votes (poll_id, user_id, option_index, option_indexes) VALUES
           ('p-theirs', $1, 0, ARRAY[0, 1]), ('p-mine', $1, 1, NULL), ('p-mine', $2, 0, NULL)`,
        [me.id, other.id],
      );
      await q(
        `INSERT INTO crew_packing_items (id, crew_id, created_by, label, brought_by, claimed) VALUES
           ('k-mine', 'c-me', $1, 'Tent', NULL, FALSE),
           ('k-claimed', 'c-me', $2, 'Cooler', $1, TRUE),
           ('k-theirs', 'c-me', $2, 'Chairs', $2, TRUE)`,
        [me.id, other.id],
      );
      await q(
        `INSERT INTO crew_ride_offers (id, crew_id, created_by, driver, seats, direction) VALUES
           ('r-mine', 'c-me', $1, 'Me', 3, 'home'), ('r-theirs', 'c-me', $2, 'Them', 2, 'to_festival')`,
        [me.id, other.id],
      );
      await q("INSERT INTO crew_ride_passengers (ride_id, user_id) VALUES ('r-theirs', $1), ('r-mine', $2)", [
        me.id,
        other.id,
      ]);
      await q(
        `INSERT INTO crew_meeting_points (id, crew_id, created_by, label, location, latitude, longitude) VALUES
           ('m-mine', 'c-me', $1, 'Tree', 'By the tree', 28.2, -81.5), ('m-theirs', 'c-me', $2, 'Gate', 'Gate 3', NULL, NULL)`,
        [me.id, other.id],
      );
      await q(
        "INSERT INTO crew_activity (id, crew_id, user_id, type, detail) VALUES ('a-mine', 'c-me', $1, 'joined', NULL), ('a-theirs', 'c-me', $2, 'joined', NULL)",
        [me.id, other.id],
      );
      await q(
        "INSERT INTO calendar_tokens (id, user_id, festival_id, profile_id) VALUES ('cal-secret-id', $1, 'fest-1', 'prof-x')",
        [me.id],
      );
      await q(
        "INSERT INTO crew_expense_reminders (crew_id, from_user_id, to_user_id) VALUES ('c-me', $1, $2), ('c-me', $2, $1)",
        [me.id, other.id],
      );
      await q(
        "INSERT INTO crew_member_status (crew_id, user_id, status, latitude, longitude, location_captured_at) VALUES ('c-me', $1, 'here', 28.1, -81.6, now()), ('c-me', $2, 'there', 1, 2, now())",
        [me.id, other.id],
      );
      if (hasCrewDays) {
        await q(
          "INSERT INTO crew_member_days (crew_id, user_id, day_index, answer) VALUES ('c-me', $1, 0, 'going'), ('c-me', $2, 0, 'no')",
          [me.id, other.id],
        );
        await q(
          "INSERT INTO crew_meeting_point_coming (meeting_point_id, crew_id, user_id) VALUES ('m-theirs', 'c-me', $1), ('m-mine', 'c-me', $2)",
          [me.id, other.id],
        );
      }
    } finally {
      await pool.end();
    }

    await h.joinFestivalProfile(server, me.token);
    const link = await h.markTrustedMutation(
      server.request.post('/api/v1/account/share-link/fest-1').set('x-user-token', me.token),
    );
    assert.equal(link.status, 200);
    shareToken = link.body.data.token;

    const res = await server.request.get('/api/v1/account/export').set('x-user-token', me.token);
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.exportVersion, '1.2');
    assert.equal('messages' in data, false);
    assert.deepEqual(data.user.sharing, { publicSchedule: false, linksResetAt: null });

    assert.deepEqual(
      data.ratings.map((r: any) => [r.artist, r.festivalId, r.rating]),
      [['Alpha', 'fest-1', 4]],
    );
    assert.deepEqual(
      data.caught.map((c: any) => c.caught),
      [true],
    );
    assert.deepEqual(
      data.followedFestivals.map((f: any) => f.festivalId),
      ['fest-1'],
    );

    const byId = Object.fromEntries(data.expenses.map((e: any) => [e.id, e]));
    assert.deepEqual(Object.keys(byId).sort(), ['e-even', 'e-paid', 'e-uneven']);
    assert.equal(byId['e-paid'].amount, 12.5);
    assert.equal(byId['e-paid'].paidByYou, true);
    assert.equal(byId['e-paid'].addedByYou, true);
    assert.equal(byId['e-uneven'].paidByYou, false);
    assert.equal(byId['e-uneven'].yourShareCents, 1000);
    assert.equal(byId['e-even'].yourShareCents, null);

    assert.deepEqual(
      data.pollsCreated.map((p: any) => [p.id, p.options, p.multiAnswer]),
      [['p-mine', ['Tacos', 'Pizza'], false]],
    );
    const votes = Object.fromEntries(data.pollVotes.map((v: any) => [v.pollId, v.options]));
    assert.deepEqual(votes, { 'p-theirs': ['Main', 'Forest'], 'p-mine': ['Pizza'] });

    const packing = Object.fromEntries(data.packingItems.map((k: any) => [k.id, k]));
    assert.deepEqual(Object.keys(packing).sort(), ['k-claimed', 'k-mine']);
    assert.equal(packing['k-claimed'].addedByYou, false);
    assert.equal(packing['k-claimed'].bringing, true);
    assert.equal(packing['k-mine'].bringing, false);

    assert.deepEqual(
      data.rides.map((r: any) => [r.id, r.direction]),
      [['r-mine', 'home']],
    );
    assert.deepEqual(
      data.rideSeats.map((s: any) => s.rideId),
      ['r-theirs'],
    );
    assert.deepEqual(
      data.meetingPoints.map((m: any) => m.id),
      ['m-mine'],
    );
    assert.equal(data.meetingPoints[0].latitude, 28.2);
    assert.deepEqual(
      data.crewActivity.map((a: any) => a.type),
      ['joined'],
    );
    assert.deepEqual(
      data.calendarFeeds.map((c: any) => c.festivalId),
      ['fest-1'],
    );
    assert.equal(data.paymentRemindersSent.length, 1);
    assert.match(data.paymentRemindersSent[0].sentOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(data.crewStatuses.length, 1);
    assert.equal(data.crewStatuses[0].latitude, 28.1);
    assert.equal(data.crewStatuses[0].longitude, -81.6);
    assert.ok(data.crewStatuses[0].locationCapturedAt);

    if (hasCrewDays) {
      assert.deepEqual(
        data.crewDays.map((d: any) => [d.dayIndex, d.answer]),
        [[0, 'going']],
      );
      assert.deepEqual(
        data.meetingPointsComing.map((c: any) => c.meetingPointId),
        ['m-theirs'],
      );
    }
    if (hasIdentities) assert.ok(Array.isArray(data.identities));

    const text = JSON.stringify(data);
    assert.ok(!text.includes(other.id), "no other member's id");
    assert.ok(!text.includes(me.token), 'no session token');
    assert.ok(!text.includes('cal-secret-id'), 'no calendar token id');
    assert.ok(!text.includes(shareToken), 'no share token');
    assert.ok(!/apple_refresh_token_enc|appleRefreshTokenEnc|"subject"/.test(text), 'no provider credential');
  });
});
