/**
 * POST /api/v1/account/stop-sharing: turns off the public schedule page and
 * clears the stored location on the user's crew statuses.
 *
 * The first block uses stub deps and runs without a database. The second block
 * is DB-gated like tests/account.test.ts (TEST_DATABASE_URL).
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

function stubApp(stores: Record<string, unknown>) {
  const passThrough = (_req: any, _res: any, next: any) => next();
  const emits: Array<{ room: string; event: string; payload: any }> = [];
  const deps: any = {
    express,
    config: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'u1', username: 'sharer' };
      next();
    },
    handleAvatarUpload: passThrough,
    rateLimit: () => passThrough,
    validate: () => passThrough,
    schemas: {},
    setNoStore: () => {},
    invalidateUserCache: () => {},
    serializePublicUser: (u: any) => ({ id: u.id, publicSchedule: u.publicSchedule === true }),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, code } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    io: { to: (room: string) => ({ emit: (event: string, payload: any) => emits.push({ room, event, payload }) }) },
    stores,
  };
  const app = express();
  app.use(createAccountRoutes(deps));
  return { app, emits };
}

describe('account stop-sharing (stub deps, no database)', () => {
  test('turns the public page off and re-broadcasts each cleared status', async () => {
    const patches: unknown[] = [];
    const rows = [
      { crew_id: 'c1', user_id: 'u1', latitude: null, longitude: null },
      { crew_id: 'c2', user_id: 'u1', latitude: null, longitude: null },
    ];
    const { app, emits } = stubApp({
      users: { update: async (_id: string, patch: any) => (patches.push(patch), { id: 'u1', publicSchedule: false }) },
      crewStatus: { clearLocationsForUser: async () => rows },
    });

    const res = await request(app).post('/stop-sharing');
    assert.equal(res.status, 200);
    assert.deepEqual(patches, [{ publicSchedule: false }]);
    assert.deepEqual(res.body.data, { user: { id: 'u1', publicSchedule: false }, clearedStatusLocations: 2 });
    assert.deepEqual(
      emits.map((e) => [e.room, e.event, e.payload.status.latitude]),
      [
        ['crew:c1', 'crew:status-updated', null],
        ['crew:c2', 'crew:status-updated', null],
      ],
    );
  });

  test('404 when the user is gone, 500 with the contract message on a store error', async () => {
    const gone = stubApp({ users: { update: async () => null }, crewStatus: { clearLocationsForUser: async () => [] } });
    assert.equal((await request(gone.app).post('/stop-sharing')).status, 404);

    const broken = stubApp({
      users: { update: async () => ({ id: 'u1' }) },
      crewStatus: {
        clearLocationsForUser: async () => {
          throw new Error('db down');
        },
      },
    });
    const res = await request(broken.app).post('/stop-sharing');
    assert.equal(res.status, 500);
    assert.equal(res.body.error.message, "Couldn't stop sharing. Try again.");
  });
});

describe('account stop-sharing (database)', { concurrency: 1, skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });

  test('requires authentication (401)', async () => {
    const h = helpers!;
    const server = await h.startServer();
    servers.push(server);
    const res = await server.request.post('/api/v1/account/stop-sharing').set(h.TRUSTED_MUTATION_HEADER, '1');
    assert.equal(res.status, 401);
  });

  test('turns publicSchedule off, nulls the status location in two crews, then reports 0', async () => {
    const h = helpers!;
    const server = await h.startServer();
    servers.push(server);
    const registered = await h.registerUser(server, `stop-${Date.now().toString(36)}`);
    const userId = registered.user.id as string;
    const token = registered.token as string;

    await server.request
      .put('/api/v1/account/public-schedule')
      .set('x-user-token', token)
      .set(h.TRUSTED_MUTATION_HEADER, '1')
      .send({ publicSchedule: true })
      .expect(200);

    const pool = new h.Pool({ connectionString: h.TEST_DATABASE_URL });
    try {
      await pool.query("INSERT INTO crews (id, festival_id, name, created_by) VALUES ('s1', 'fest-1', 'One', $1), ('s2', 'fest-1', 'Two', $1)", [userId]);
      await pool.query("INSERT INTO crew_members (crew_id, user_id, role) VALUES ('s1', $1, 'owner'), ('s2', $1, 'owner')", [userId]);
      await pool.query(
        `INSERT INTO crew_member_status (crew_id, user_id, status, latitude, longitude, location_captured_at)
         VALUES ('s1', $1, 'here', 28.1, -81.6, now()), ('s2', $1, 'there', 28.2, -81.5, now())`,
        [userId],
      );

      const stop = () =>
        server.request.post('/api/v1/account/stop-sharing').set('x-user-token', token).set(h.TRUSTED_MUTATION_HEADER, '1');

      const first = await stop();
      assert.equal(first.status, 200);
      assert.equal(first.body.data.user.publicSchedule, false);
      assert.equal(first.body.data.clearedStatusLocations, 2);

      const { rows } = await pool.query(
        'SELECT status, latitude, longitude, location_captured_at FROM crew_member_status WHERE user_id = $1 ORDER BY crew_id',
        [userId],
      );
      assert.deepEqual(rows, [
        { status: 'here', latitude: null, longitude: null, location_captured_at: null },
        { status: 'there', latitude: null, longitude: null, location_captured_at: null },
      ]);

      const second = await stop();
      assert.equal(second.status, 200);
      assert.equal(second.body.data.clearedStatusLocations, 0);
    } finally {
      await pool.end();
    }
  });
});
