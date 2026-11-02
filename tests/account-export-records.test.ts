/**
 * GET /api/v1/account/export (exportVersion 1.2): the records a user wrote in
 * crews and on sets — ratings, expenses, poll votes, packing items, rides,
 * meeting points — and the stored location on crew statuses.
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

function stubExportApp(answer: (sql: string) => unknown[], warnings: unknown[] = []) {
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
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, code } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', RATE_LIMITED: 'RATE_LIMITED', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    stores: {
      profiles: { getByUserId: async () => [] },
      pool: { query: async (sql: string) => ({ rows: answer(sql) }) },
      crewStatus: {
        listByUser: async () => [
          { crew_id: 'c1', status: 'here', latitude: 28.1, longitude: -81.6, location_captured_at: '2026-06-05T20:00:00Z' },
        ],
      },
    },
  };
  const app = express();
  app.use(createAccountRoutes(deps));
  return app;
}

describe('account export 1.2 records (stub pool, no database)', () => {
  test('maps every section to the camelCase contract', async () => {
    const created = new Date('2026-06-05T18:00:00Z');
    const app = stubExportApp((sql) => {
      if (/FROM\s+set_ratings/.test(sql)) {
        return [{ set_id: 's1', festival_id: 'f1', artist: 'Alpha', rating: 4, note: 'loud', created_at: created, updated_at: created }];
      }
      if (/FROM\s+crew_expenses/.test(sql)) {
        return [
          { id: 'e1', crew_id: 'c1', description: 'Gas', amount: '12.50', category: 'travel', planned: false, paid_by: 'u1', split_with: ['u1', 'u2'], created_at: created },
          { id: 'e2', crew_id: 'c1', description: 'Ice', amount: '3.00', category: 'food', planned: false, paid_by: 'u2', split_with: '["u1","u2"]', created_at: created },
        ];
      }
      if (/FROM\s+crew_poll_votes/.test(sql)) {
        return [{ poll_id: 'p1', crew_id: 'c1', question: 'Which stage?', option: 'Forest', voted_at: created }];
      }
      if (/FROM\s+crew_packing_items/.test(sql)) {
        return [{ id: 'k1', crew_id: 'c1', label: 'Tent', claimed: true, brought_by: 'u1', created_at: created }];
      }
      if (/FROM\s+crew_ride_offers/.test(sql)) {
        return [{ id: 'r1', crew_id: 'c1', driver: 'Me', seats: 3, depart_from: 'Home', depart_at: 'Fri 9am', note: null, created_at: created }];
      }
      if (/FROM\s+crew_meeting_points/.test(sql)) {
        return [{ id: 'm1', crew_id: 'c1', label: 'Tree', location: 'By the tree', latitude: 28.2, longitude: -81.5, type: 'during', meet_at: null, created_at: created }];
      }
      return [];
    });

    const res = await request(app).get('/export');
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.exportVersion, '1.2');
    assert.equal('messages' in data, false);
    assert.deepEqual(data.ratings, [
      { setId: 's1', festivalId: 'f1', artist: 'Alpha', rating: 4, note: 'loud', createdAt: created.toISOString(), updatedAt: created.toISOString() },
    ]);
    assert.deepEqual(
      data.expenses.map((e: any) => [e.id, e.amount, e.paidByYou, e.splitWith]),
      [
        ['e1', 12.5, true, ['u1', 'u2']],
        ['e2', 3, false, ['u1', 'u2']],
      ],
    );
    assert.deepEqual(data.pollVotes, [
      { pollId: 'p1', crewId: 'c1', question: 'Which stage?', option: 'Forest', votedAt: created.toISOString() },
    ]);
    assert.equal(data.packingItems[0].broughtBy, 'u1');
    assert.equal(data.rides[0].departAt, 'Fri 9am');
    assert.equal(data.meetingPoints[0].latitude, 28.2);
    assert.equal(data.meetingPoints[0].meetAt, null);
    assert.deepEqual(
      [data.crewStatuses[0].latitude, data.crewStatuses[0].longitude, data.crewStatuses[0].locationCapturedAt],
      [28.1, -81.6, '2026-06-05T20:00:00.000Z'],
    );
  });

  test('a failing section exports [] and logs gdpr-export:partial-failure', async () => {
    const warnings: any[] = [];
    const app = stubExportApp((sql) => {
      if (/FROM\s+crew_ride_offers/.test(sql)) throw new Error('relation missing');
      return [];
    }, warnings);

    const res = await request(app).get('/export');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.rides, []);
    assert.deepEqual(res.body.data.ratings, []);
    const failure = warnings.find(([event]) => event === 'gdpr-export:partial-failure');
    assert.equal(failure?.[1].section, 'rides');
  });
});

describe('account export 1.2 records (database)', { concurrency: 1, skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });

  test('exports every record the user wrote and leaves out an unrelated expense', async () => {
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
    try {
      const q = (sql: string, params: unknown[]) => pool.query(sql, params);
      await q("INSERT INTO crews (id, festival_id, name, created_by) VALUES ($1, 'fest-1', 'Mine', $2), ($3, 'fest-1', 'Theirs', $4)", ['c-me', me.id, 'c-other', other.id]);
      await q("INSERT INTO crew_members (crew_id, user_id, role) VALUES ('c-me', $1, 'owner'), ('c-me', $2, 'member'), ('c-other', $2, 'owner')", [me.id, other.id]);
      await q("INSERT INTO set_ratings (user_id, set_id, rating, note) VALUES ($1, 'set-a', 4, 'loud')", [me.id]);
      await q(
        `INSERT INTO crew_expenses (id, crew_id, paid_by, description, amount, split_with) VALUES
           ('e-paid', 'c-me', $1, 'Gas', 12.50, jsonb_build_array($1::text, $2::text)),
           ('e-split', 'c-me', $2, 'Ice', 30, jsonb_build_array($1::text, $2::text)),
           ('e-unrelated', 'c-other', $2, 'Snacks', 9, jsonb_build_array($2::text))`,
        [me.id, other.id],
      );
      await q("INSERT INTO crew_polls (id, crew_id, created_by, question, options) VALUES ('p1', 'c-me', $1, 'Which stage?', '[\"Main\",\"Forest\"]')", [other.id]);
      await q("INSERT INTO crew_poll_votes (poll_id, user_id, option_index) VALUES ('p1', $1, 1)", [me.id]);
      await q("INSERT INTO crew_packing_items (id, crew_id, created_by, label) VALUES ('k1', 'c-me', $1, 'Tent')", [me.id]);
      await q("INSERT INTO crew_ride_offers (id, crew_id, created_by, driver, seats) VALUES ('r1', 'c-me', $1, 'Me', 3)", [me.id]);
      await q("INSERT INTO crew_meeting_points (id, crew_id, created_by, label, location, latitude, longitude) VALUES ('m1', 'c-me', $1, 'Tree', 'By the tree', 28.2, -81.5)", [me.id]);
      await q("INSERT INTO crew_member_status (crew_id, user_id, status, latitude, longitude, location_captured_at) VALUES ('c-me', $1, 'here', 28.1, -81.6, now())", [me.id]);
    } finally {
      await pool.end();
    }

    const res = await server.request.get('/api/v1/account/export').set('x-user-token', me.token);
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.exportVersion, '1.2');
    assert.equal('messages' in data, false);

    assert.equal(data.ratings.length, 1);
    assert.equal(data.ratings[0].artist, 'Alpha');
    assert.equal(data.ratings[0].festivalId, 'fest-1');

    const byId = Object.fromEntries(data.expenses.map((e: any) => [e.id, e]));
    assert.deepEqual(Object.keys(byId).sort(), ['e-paid', 'e-split']);
    assert.equal(byId['e-paid'].amount, 12.5);
    assert.equal(byId['e-paid'].paidByYou, true);
    assert.equal(byId['e-split'].paidByYou, false);
    assert.deepEqual(byId['e-split'].splitWith, [me.id, other.id]);

    assert.equal(data.pollVotes[0].option, 'Forest');
    assert.equal(data.packingItems[0].label, 'Tent');
    assert.equal(data.rides[0].seats, 3);
    assert.equal(data.meetingPoints[0].latitude, 28.2);
    assert.equal(data.crewStatuses[0].latitude, 28.1);
    assert.equal(data.crewStatuses[0].longitude, -81.6);
    assert.ok(data.crewStatuses[0].locationCapturedAt);
  });
});
