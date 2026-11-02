import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import createCrewsStore from '../lib/db/stores/crews.js';
import { createStores } from '../lib/db/index.js';

// Crew ownership in the store: transferOwnership moves crews.created_by with the
// role rows, and handOverOwnedCrews (DELETE /account) picks a new owner per crew.

/**
 * A pool double that answers the handover queries from fixtures. `owned` lists
 * the crews the user owns; `candidates` maps a crew to its active members in
 * join order; a transfer to a user in `clashWith` raises 23505 on the created_by
 * update, as crews_reform_idem_uidx would.
 */
function handoverPool({
  owned,
  candidates,
  clashWith = [],
  failWith,
}: {
  owned: string[];
  candidates: Record<string, string[]>;
  clashWith?: string[];
  failWith?: Error;
}) {
  const committed: Array<{ crewId: string; to: string }> = [];
  return {
    committed,
    query: async (sql: string, params: any[]) => {
      if (sql.includes("role = 'owner'")) return { rows: owned.map((crew_id) => ({ crew_id })) };
      return { rows: (candidates[params[0]] ?? []).map((user_id) => ({ user_id })) };
    },
    connect: async () => {
      let pending: { crewId: string; to: string } | null = null;
      return {
        query: async (sql: string, params: any[] = []) => {
          if (sql.startsWith('UPDATE crews SET created_by')) {
            if (failWith) throw failWith;
            if (clashWith.includes(params[0])) throw Object.assign(new Error('duplicate key'), { code: '23505' });
            pending = { crewId: params[1], to: params[0] };
          }
          if (sql === 'COMMIT' && pending) committed.push(pending);
          return { rows: [] };
        },
        release: () => {},
      };
    },
  };
}

describe('crews.handOverOwnedCrews (no database)', () => {
  test('hands each owned crew to the earliest-joined active member', async () => {
    const pool = handoverPool({ owned: ['c1'], candidates: { c1: ['b', 'c'] } });
    const { crews } = createCrewsStore(pool as any, {});
    assert.deepEqual(await crews.handOverOwnedCrews('a'), [{ crewId: 'c1', newOwnerId: 'b' }]);
    assert.deepEqual(pool.committed, [{ crewId: 'c1', to: 'b' }]);
  });

  test('a valid choice wins over join order', async () => {
    const pool = handoverPool({ owned: ['c1'], candidates: { c1: ['b', 'c'] } });
    const { crews } = createCrewsStore(pool as any, {});
    const result = await crews.handOverOwnedCrews('a', [{ crewId: 'c1', newOwnerId: 'c' }]);
    assert.deepEqual(result, [{ crewId: 'c1', newOwnerId: 'c' }]);
  });

  test('a choice that is not an active member is ignored', async () => {
    const pool = handoverPool({ owned: ['c1'], candidates: { c1: ['b', 'c'] } });
    const { crews } = createCrewsStore(pool as any, {});
    const result = await crews.handOverOwnedCrews('a', [{ crewId: 'c1', newOwnerId: 'stranger' }]);
    assert.deepEqual(result, [{ crewId: 'c1', newOwnerId: 'b' }]);
  });

  test('a reform-key clash moves on to the next candidate', async () => {
    const pool = handoverPool({ owned: ['c1'], candidates: { c1: ['b', 'c'] }, clashWith: ['b'] });
    const { crews } = createCrewsStore(pool as any, {});
    assert.deepEqual(await crews.handOverOwnedCrews('a'), [{ crewId: 'c1', newOwnerId: 'c' }]);
  });

  test('a crew with no candidate, or only clashing ones, is left alone', async () => {
    const pool = handoverPool({ owned: ['solo', 'c1'], candidates: { c1: ['b'] }, clashWith: ['b'] });
    const { crews } = createCrewsStore(pool as any, {});
    assert.deepEqual(await crews.handOverOwnedCrews('a'), []);
    assert.deepEqual(pool.committed, []);
  });

  test('any other database error propagates', async () => {
    const pool = handoverPool({ owned: ['c1'], candidates: { c1: ['b'] }, failWith: new Error('connection lost') });
    const { crews } = createCrewsStore(pool as any, {});
    await assert.rejects(crews.handOverOwnedCrews('a'), /connection lost/);
  });
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('crews.transferOwnership (database)', { skip }, () => {
  let pool: Pool;
  let stores: any;

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    stores = createStores(pool);
  });

  after(async () => {
    await pool.query("DELETE FROM crews WHERE id LIKE 'own-test-%'").catch(() => {});
    await pool.query("DELETE FROM festivals WHERE id LIKE 'own-test-%'").catch(() => {});
    await pool.query("DELETE FROM users WHERE id LIKE 'own-test-%'").catch(() => {});
    await pool.end();
  });

  const mkUser = (id: string) => stores.users.create({ id, username: id, passwordHash: 'x' });
  const mkCrew = (id: string, createdBy: string, reformedFrom: string | null = null) =>
    stores.crews.create({
      id,
      festivalId: 'own-test-f1',
      name: `Crew ${id}`,
      createdBy,
      inviteCode: `${id}-inv`,
      maxMembers: 10,
      reformedFrom,
    });
  const addMember = (crewId: string, userId: string, role: string) =>
    pool.query('INSERT INTO crew_members (crew_id, user_id, role) VALUES ($1, $2, $3)', [crewId, userId, role]);
  const roleOf = async (crewId: string, userId: string) =>
    (await pool.query('SELECT role FROM crew_members WHERE crew_id = $1 AND user_id = $2', [crewId, userId])).rows[0]
      ?.role;

  before(async () => {
    await pool.query("INSERT INTO festivals (id, name) VALUES ('own-test-f1', 'Ownership Fest') ON CONFLICT DO NOTHING");
    for (const id of ['own-test-a', 'own-test-b']) await mkUser(id);
  });

  test('moves created_by with the owner role', async () => {
    await mkCrew('own-test-c1', 'own-test-a');
    await addMember('own-test-c1', 'own-test-a', 'owner');
    await addMember('own-test-c1', 'own-test-b', 'member');

    await stores.crews.transferOwnership('own-test-c1', 'own-test-a', 'own-test-b');

    const crew = await stores.crews.getById('own-test-c1');
    assert.equal(crew.createdBy, 'own-test-b');
    assert.equal(await roleOf('own-test-c1', 'own-test-b'), 'owner');
    assert.equal(await roleOf('own-test-c1', 'own-test-a'), 'member');
  });

  test('a reform-key clash raises 23505 and changes nothing', async () => {
    // B already runs a reform of own-test-src in own-test-f1; taking over A's
    // reform of the same source would duplicate (created_by, festival_id, reformed_from).
    await mkCrew('own-test-src', 'own-test-a');
    await mkCrew('own-test-rb', 'own-test-b', 'own-test-src');
    await mkCrew('own-test-ra', 'own-test-a', 'own-test-src');
    await addMember('own-test-ra', 'own-test-a', 'owner');
    await addMember('own-test-ra', 'own-test-b', 'member');

    await assert.rejects(stores.crews.transferOwnership('own-test-ra', 'own-test-a', 'own-test-b'), {
      code: '23505',
    });

    const crew = await stores.crews.getById('own-test-ra');
    assert.equal(crew.createdBy, 'own-test-a');
    assert.equal(await roleOf('own-test-ra', 'own-test-a'), 'owner', 'the role swap rolled back');
    assert.equal(await roleOf('own-test-ra', 'own-test-b'), 'member');
  });
});
