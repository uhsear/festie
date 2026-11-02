/**
 * crewStatus.listByCrew joins crew_members: a member who left or was removed
 * no longer shows (with their last location) in the crew's status list. Their
 * row stays for the export and is cleared by Stop all sharing or account delete.
 *
 * The first block checks the query against a stub pool. The second block is
 * DB-gated like tests/account.test.ts (TEST_DATABASE_URL).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import createCrewsStore from '../lib/db/stores/crews.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
// The shared helpers exit the process without a test database, so load them only when it exists.
const helpers = skip ? null : await import('./_integration-helpers');

describe('crewStatus membership queries (stub pool, no database)', () => {
  test('listByCrew and listLocationsForUser join crew_members on crew and user', async () => {
    const calls: Array<[string, unknown[]]> = [];
    const pool: any = {
      query: async (sql: string, params: unknown[]) => {
        calls.push([sql, params]);
        return { rows: [] };
      },
    };
    const { crewStatus } = createCrewsStore(pool, {});
    await crewStatus.listByCrew('crew-1');
    await crewStatus.listLocationsForUser('user-1');

    for (const [sql] of calls)
      assert.match(sql, /JOIN crew_members m ON m\.crew_id = s\.crew_id\s+AND m\.user_id = s\.user_id/);
    const [locationsSql, locationsParams] = calls[1]!;
    assert.match(locationsSql, /s\.latitude IS NOT NULL/);
    assert.doesNotMatch(locationsSql, /s\.latitude,|s\.longitude/);
    assert.deepEqual(locationsParams, ['user-1']);
  });
});

describe('crew status hides members who left (database)', { concurrency: 1, skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });

  test('after a member leaves, GET /crews/:id/status lists only the remaining member', async () => {
    const h = helpers!;
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
    servers.push(server);
    const tag = Date.now().toString(36);
    const owner = await h.registerUser(server, `stay-${tag}`);
    const leaver = await h.registerUser(server, `leave-${tag}`);

    const pool = new h.Pool({ connectionString: h.TEST_DATABASE_URL });
    try {
      await pool.query("INSERT INTO crews (id, festival_id, name, created_by) VALUES ('cm1', 'fest-1', 'Crew', $1)", [
        owner.user.id,
      ]);
      await pool.query(
        "INSERT INTO crew_members (crew_id, user_id, role) VALUES ('cm1', $1, 'owner'), ('cm1', $2, 'member')",
        [owner.user.id, leaver.user.id],
      );
    } finally {
      await pool.end();
    }

    const putStatus = (token: string, latitude: number) =>
      server.request
        .put('/api/v1/crews/cm1/status')
        .set('x-user-token', token)
        .set(h.TRUSTED_MUTATION_HEADER, '1')
        .send({ status: 'here', position: { lat: latitude, lng: -81.5 } })
        .expect(200);
    await putStatus(owner.token, 28.1);
    await putStatus(leaver.token, 28.2);

    const list = () => server.request.get('/api/v1/crews/cm1/status').set('x-user-token', owner.token).expect(200);
    const before = await list();
    assert.equal(before.body.data.statuses.length, 2);

    await server.request
      .delete('/api/v1/crews/cm1/leave')
      .set('x-user-token', leaver.token)
      .set(h.TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const after = await list();
    assert.deepEqual(
      after.body.data.statuses.map((s: any) => s.user_id),
      [owner.user.id],
    );
  });
});
