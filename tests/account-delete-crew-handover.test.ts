import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import createAccountRoutes from '../routes/account.js';
import { createStores } from '../lib/db/index.js';
import { accountDeleteSchema } from '../lib/schemas.js';

// DELETE /account hands every crew the account owns to another member before it
// soft-deletes the user, so a crew never sits without a visible owner for the
// 30-day grace period (account-30).

const noop = () => {};
const pass = (_req: any, _res: any, next: any) => next();

function buildApp(stores: any) {
  const deps: any = {
    express,
    config: { NODE_ENV: 'test' },
    log: { info: noop, warn: noop, error: noop, debug: noop },
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'owner-a', username: 'owner-a' };
      next();
    },
    handleAvatarUpload: pass,
    requireRecentAuth: pass,
    rateLimit: () => pass,
    validate: () => (req: any, _res: any, next: any) => {
      req.validatedBody = req.body;
      next();
    },
    schemas: {},
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, code } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INVALID_INPUT: 'INVALID_INPUT', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    getUserById: async () => ({ id: 'owner-a', username: 'owner-a', passwordHash: 'h', deletedAt: null }),
    verifyPassword: async () => true,
    invalidateUserSessions: async () => {},
    disconnectUserSockets: noop,
    getRequestIp: () => '127.0.0.1',
    clearUserSessionCookie: noop,
    invalidateUserCache: noop,
    stores,
  };
  const app = express();
  app.use(express.json());
  app.use('/', createAccountRoutes(deps));
  return app;
}

describe('DELETE /account — crew handover (no database)', () => {
  test('hands crews over before the soft-delete and returns the result', async () => {
    const calls: string[] = [];
    const handOverOwnedCrews = mock.fn(async () => {
      calls.push('handover');
      return [{ crewId: 'c1', newOwnerId: 'member-c' }];
    });
    const app = buildApp({
      crews: { handOverOwnedCrews },
      users: {
        update: async () => {
          calls.push('soft-delete');
        },
      },
    });

    const res = await request(app)
      .delete('/')
      .send({ password: 'pw', crewHandover: [{ crewId: 'c1', newOwnerId: 'member-c' }] });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.handedOver, [{ crewId: 'c1', newOwnerId: 'member-c' }]);
    assert.deepEqual((handOverOwnedCrews.mock.calls as any[])[0].arguments, [
      'owner-a',
      [{ crewId: 'c1', newOwnerId: 'member-c' }],
    ]);
    assert.deepEqual(calls, ['handover', 'soft-delete']);
  });

  test('a failed handover deletes nothing', async () => {
    const update = mock.fn(async () => {});
    const app = buildApp({
      crews: {
        handOverOwnedCrews: async () => {
          throw new Error('db down');
        },
      },
      users: { update },
    });

    const res = await request(app).delete('/').send({ password: 'pw' });

    assert.equal(res.status, 500);
    assert.equal(update.mock.calls.length, 0);
  });

  test('the schema accepts an optional crewHandover of at most 50 entries', () => {
    assert.ok(accountDeleteSchema.safeParse({ password: 'pw' }).success);
    const entry = { crewId: 'c1', newOwnerId: 'u1' };
    assert.ok(accountDeleteSchema.safeParse({ password: 'pw', crewHandover: [entry] }).success);
    assert.ok(!accountDeleteSchema.safeParse({ password: 'pw', crewHandover: Array(51).fill(entry) }).success);
    assert.ok(!accountDeleteSchema.safeParse({ password: 'pw', crewHandover: [{ crewId: '' }] }).success);
  });
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('crews.handOverOwnedCrews (database)', { skip }, () => {
  let pool: Pool;
  let stores: any;
  let n = 0;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    stores = createStores(pool);
    await pool.query("INSERT INTO festivals (id, name) VALUES ('hand-test-f1', 'Handover Fest') ON CONFLICT DO NOTHING");
  });

  after(async () => {
    await pool.query("DELETE FROM crews WHERE id LIKE 'hand-test-%'").catch(() => {});
    await pool.query("DELETE FROM festivals WHERE id LIKE 'hand-test-%'").catch(() => {});
    await pool.query("DELETE FROM users WHERE id LIKE 'hand-test-%'").catch(() => {});
    await pool.end();
  });

  /** A crew owned by A, with B (joined first) and C as members. Returns the ids. */
  async function ownedCrew(memberIds: string[] = ['b', 'c']) {
    n += 1;
    const id = (s: string) => `hand-test-${n}-${s}`;
    for (const u of ['a', ...memberIds]) await stores.users.create({ id: id(u), username: id(u), passwordHash: 'x' });
    await stores.crews.create({
      id: id('crew'),
      festivalId: 'hand-test-f1',
      name: 'Handover crew',
      createdBy: id('a'),
      inviteCode: id('inv'),
      maxMembers: 10,
    });
    const members = [['a', 'owner'], ...memberIds.map((u) => [u, 'member'])];
    for (const [i, [u, role]] of members.entries()) {
      await pool.query(
        "INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES ($1, $2, $3, '2020-01-01'::timestamptz + make_interval(days => $4::int))",
        [id('crew'), id(u!), role, i],
      );
    }
    return id;
  }

  async function ownerOf(crewId: string) {
    const crew = await stores.crews.getById(crewId);
    const { rows } = await pool.query("SELECT user_id FROM crew_members WHERE crew_id = $1 AND role = 'owner'", [
      crewId,
    ]);
    return { createdBy: crew.createdBy, owners: rows.map((r: any) => r.user_id) };
  }

  test('with no choice, the first-joined member takes over', async () => {
    const id = await ownedCrew();
    const result = await stores.crews.handOverOwnedCrews(id('a'));
    assert.deepEqual(result, [{ crewId: id('crew'), newOwnerId: id('b') }]);
    assert.deepEqual(await ownerOf(id('crew')), { createdBy: id('b'), owners: [id('b')] });
  });

  test('a valid choice takes over', async () => {
    const id = await ownedCrew();
    await stores.crews.handOverOwnedCrews(id('a'), [{ crewId: id('crew'), newOwnerId: id('c') }]);
    assert.deepEqual(await ownerOf(id('crew')), { createdBy: id('c'), owners: [id('c')] });
  });

  test('a choice that is not a member falls back to the first-joined member', async () => {
    const id = await ownedCrew();
    await stores.crews.handOverOwnedCrews(id('a'), [{ crewId: id('crew'), newOwnerId: 'hand-test-stranger' }]);
    assert.deepEqual(await ownerOf(id('crew')), { createdBy: id('b'), owners: [id('b')] });
  });

  test('a soft-deleted member is skipped', async () => {
    const id = await ownedCrew();
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [id('b')]);
    await stores.crews.handOverOwnedCrews(id('a'));
    assert.deepEqual(await ownerOf(id('crew')), { createdBy: id('c'), owners: [id('c')] });
  });

  test('a crew where the owner is the only member is left alone', async () => {
    const id = await ownedCrew([]);
    assert.deepEqual(await stores.crews.handOverOwnedCrews(id('a')), []);
    assert.deepEqual(await ownerOf(id('crew')), { createdBy: id('a'), owners: [id('a')] });
  });

  test('the new owner can kick after the old owner is soft-deleted', async () => {
    const id = await ownedCrew();
    await stores.crews.handOverOwnedCrews(id('a'));
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [id('a')]);
    const members = await stores.crews.getMembers(id('crew'));
    assert.equal(members.find((m: any) => m.role === 'owner')?.userId, id('b'), 'B is the visible owner');
    assert.equal((await stores.crews.getMember(id('crew'), id('b'))).role, 'owner', 'B passes the owner check');
  });
});
