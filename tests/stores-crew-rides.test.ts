import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: mock pool factory (same pattern as stores-crew-packing.test.ts)
// ---------------------------------------------------------------------------
function makePool(queryResults: any[] = []) {
  let callIdx = 0;
  const query = mock.fn(async () => {
    const result = queryResults[callIdx] || { rows: [] };
    callIdx++;
    return result;
  });
  return { query };
}

// ---------------------------------------------------------------------------
// lib/db/stores/crews.ts — createCrewsStore().crewRides
// ---------------------------------------------------------------------------
describe('lib/db/stores/crews.ts — crewRides sub-store', () => {
  let createCrewsStore: any;

  beforeEach(async () => {
    const mod = await import('../lib/db/stores/crews.js');
    createCrewsStore = mod.default;
  });

  function makeStore(queryResults: any[] = []) {
    const pool = makePool(queryResults);
    const store = createCrewsStore(pool, {}).crewRides;
    return { store, pool };
  }

  // =========================================================================
  // create()
  // =========================================================================
  describe('create', () => {
    it('inserts an offer and returns the created row', async () => {
      const createdRow = {
        id: 'ride-abc',
        crew_id: 'crew-1',
        created_by: 'user-1',
        driver: 'Ada',
        seats: 3,
        depart_from: 'North lot',
        depart_at: 'Fri 2pm',
        note: 'Leaving sharp',
        created_at: '2026-06-03T12:00:00Z',
      };
      // create() issues INSERT then a SELECT for the row.
      const { store, pool } = makeStore([{ rows: [] }, { rows: [createdRow] }]);

      const result = await store.create({
        id: 'ride-abc',
        crewId: 'crew-1',
        createdBy: 'user-1',
        driver: 'Ada',
        seats: 3,
        departFrom: 'North lot',
        departAt: 'Fri 2pm',
        note: 'Leaving sharp',
      });

      assert.deepStrictEqual(result, createdRow);
      assert.strictEqual(pool.query.mock.calls.length, 2);
      const insert = pool.query.mock.calls[0]!;
      assert.ok((insert.arguments as any[])[0].includes('INSERT INTO'));
      assert.ok((insert.arguments as any[])[0].includes('crew_ride_offers'));
      // Params: [id, crewId, createdBy, driver, seats, departFrom, departAt, note]
      const params = (insert.arguments as any[])[1];
      assert.strictEqual(params[0], 'ride-abc');
      assert.strictEqual(params[1], 'crew-1');
      assert.strictEqual(params[2], 'user-1');
      assert.strictEqual(params[3], 'Ada');
      assert.strictEqual(params[4], 3);
      assert.strictEqual(params[5], 'North lot');
      assert.strictEqual(params[6], 'Fri 2pm');
      assert.strictEqual(params[7], 'Leaving sharp');
    });

    it('defaults optional fields to null when omitted', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ id: 'ride-x' }] }]);
      await store.create({
        id: 'ride-x',
        crewId: 'crew-1',
        createdBy: 'user-1',
      });
      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.strictEqual(params[3], null);
      assert.strictEqual(params[4], null);
      assert.strictEqual(params[5], null);
      assert.strictEqual(params[6], null);
      assert.strictEqual(params[7], null);
    });

    it('returns null when the row is not found after insert', async () => {
      const { store } = makeStore([{ rows: [] }, { rows: [] }]);
      const result = await store.create({
        id: 'ride-y',
        crewId: 'crew-1',
        createdBy: 'user-1',
        driver: 'Bo',
      });
      assert.strictEqual(result, null);
    });
  });

  // =========================================================================
  // listByCrew()
  // =========================================================================
  describe('listByCrew', () => {
    it('selects offers for the crew, oldest-first', async () => {
      const rows = [
        { id: 'ride-1', crew_id: 'crew-1', driver: 'Ada' },
        { id: 'ride-2', crew_id: 'crew-1', driver: 'Bo' },
      ];
      const { store, pool } = makeStore([{ rows }]);

      const result = await store.listByCrew('crew-1');

      assert.deepStrictEqual(result, rows);
      assert.strictEqual(pool.query.mock.calls.length, 1);
      const call = pool.query.mock.calls[0]!;
      const sql = (call.arguments as any[])[0];
      assert.ok(sql.includes('FROM') && sql.includes('crew_ride_offers'));
      assert.ok(sql.includes('ORDER BY'));
      assert.ok(sql.includes('created_at'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['crew-1']);
    });
  });

  // =========================================================================
  // update()
  // =========================================================================
  describe('update', () => {
    it('maps camelCase fields to columns and returns the updated row', async () => {
      const updated = { id: 'ride-1', driver: 'Cy', seats: 2, depart_from: 'South gate' };
      // update() issues UPDATE then a SELECT.
      const { store, pool } = makeStore([{ rows: [] }, { rows: [updated] }]);

      const result = await store.update('ride-1', {
        driver: 'Cy',
        seats: 2,
        departFrom: 'South gate',
        departAt: 'Sat 9am',
        note: 'Two open seats',
      });

      assert.deepStrictEqual(result, updated);
      const upd = pool.query.mock.calls[0]!;
      const sql = (upd.arguments as any[])[0];
      assert.ok(sql.startsWith('UPDATE crew_ride_offers SET'));
      assert.ok(sql.includes('driver = $1'));
      assert.ok(sql.includes('seats = $2'));
      assert.ok(sql.includes('depart_from = $3'));
      assert.ok(sql.includes('depart_at = $4'));
      assert.ok(sql.includes('note = $5'));
      // Final param is the id at the trailing placeholder.
      const params = (upd.arguments as any[])[1];
      assert.deepStrictEqual(params, ['Cy', 2, 'South gate', 'Sat 9am', 'Two open seats', 'ride-1']);
    });

    it('updates a single field and clears note when passed null', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ id: 'ride-1' }] }]);
      await store.update('ride-1', { seats: 0, note: null });
      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      // Order matches Object.entries iteration: seats then note, then id.
      assert.deepStrictEqual(params, [0, null, 'ride-1']);
    });

    it('returns null and issues no query when no known fields are given', async () => {
      const { store, pool } = makeStore([]);
      const result = await store.update('ride-1', { bogus: 'x' } as any);
      assert.strictEqual(result, null);
      assert.strictEqual(pool.query.mock.calls.length, 0);
    });
  });

  // =========================================================================
  // delete() / getById() / countByCrew()
  // =========================================================================
  describe('delete / getById / countByCrew', () => {
    it('delete issues a DELETE with the id', async () => {
      const { store, pool } = makeStore([{ rows: [] }]);
      await store.delete('ride-1');
      const call = pool.query.mock.calls[0]!;
      assert.ok((call.arguments as any[])[0].includes('DELETE FROM crew_ride_offers'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['ride-1']);
    });

    it('getById returns the row or null', async () => {
      const row = { id: 'ride-1', crew_id: 'crew-1' };
      const { store } = makeStore([{ rows: [row] }]);
      assert.deepStrictEqual(await store.getById('ride-1'), row);

      const { store: empty } = makeStore([{ rows: [] }]);
      assert.strictEqual(await empty.getById('missing'), null);
    });

    it('countByCrew returns the integer count', async () => {
      const { store, pool } = makeStore([{ rows: [{ count: 3 }] }]);
      const count = await store.countByCrew('crew-1');
      assert.strictEqual(count, 3);
      const call = pool.query.mock.calls[0]!;
      assert.ok((call.arguments as any[])[0].includes('COUNT(*)'));
      assert.deepStrictEqual((call.arguments as any[])[1], ['crew-1']);
    });
  });

  // =========================================================================
  // T30: direction, depart_time, passenger_ids, takeSeat(), leaveSeat()
  // =========================================================================
  describe('T30 columns', () => {
    it('create stores direction and departTime after the legacy params', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ id: 'ride-x' }] }]);
      await store.create({
        id: 'ride-x',
        crewId: 'crew-1',
        createdBy: 'user-1',
        direction: 'to_festival',
        departTime: '2026-07-04T18:00:00.000Z',
      });
      const [sql, params] = pool.query.mock.calls[0]!.arguments as any[];
      assert.ok(sql.includes('direction'));
      assert.ok(sql.includes('depart_time'));
      assert.ok(sql.includes('$10'));
      assert.strictEqual(params[8], 'to_festival');
      assert.strictEqual(params[9], '2026-07-04T18:00:00.000Z');
    });

    it('create defaults direction and departTime to null', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [] }]);
      await store.create({ id: 'ride-x', crewId: 'crew-1', createdBy: 'user-1' });
      const params = (pool.query.mock.calls[0]!.arguments as any[])[1];
      assert.strictEqual(params[8], null);
      assert.strictEqual(params[9], null);
    });

    it('every SELECT reads direction, depart_time and the member-filtered passenger_ids', async () => {
      const { store, pool } = makeStore([]);
      await store.create({ id: 'ride-x', crewId: 'crew-1', createdBy: 'user-1' });
      await store.listByCrew('crew-1');
      await store.getById('ride-x');
      await store.update('ride-x', { seats: 2 });
      const selects = (pool.query.mock.calls as any[])
        .map((c) => c.arguments[0] as string)
        .filter((sql) => sql.trimStart().startsWith('SELECT'));
      assert.strictEqual(selects.length, 4);
      for (const sql of selects) {
        assert.ok(sql.includes('direction'));
        assert.ok(sql.includes('depart_time'));
        assert.ok(sql.includes('AS passenger_ids'));
        assert.ok(sql.includes('FROM crew_ride_passengers p JOIN crew_members cm ON cm.user_id = p.user_id'));
        assert.ok(sql.includes('ORDER BY p.created_at'));
      }
      // listByCrew correlates on its alias; the single-row reads on the table name.
      assert.ok(selects[1]!.includes('cm.crew_id = ro.crew_id WHERE p.ride_id = ro.id'));
      assert.ok(selects[2]!.includes('cm.crew_id = crew_ride_offers.crew_id WHERE p.ride_id = crew_ride_offers.id'));
    });

    it('update maps direction and departTime to their columns', async () => {
      const { store, pool } = makeStore([{ rows: [] }, { rows: [{ id: 'ride-1' }] }]);
      await store.update('ride-1', { direction: 'home', departTime: '2026-07-05T03:00:00.000Z' });
      const [sql, params] = pool.query.mock.calls[0]!.arguments as any[];
      assert.strictEqual(sql, 'UPDATE crew_ride_offers SET direction = $1, depart_time = $2 WHERE id = $3');
      assert.deepStrictEqual(params, ['home', '2026-07-05T03:00:00.000Z', 'ride-1']);
    });
  });

  describe('takeSeat / leaveSeat', () => {
    // takeSeat runs on a pooled client inside withTransaction; getById runs on the pool.
    function makeTxStore(
      clientResults: Record<string, any>,
      offerRow: any = { id: 'ride-1', passenger_ids: ['user-1'] },
    ) {
      const client = {
        query: mock.fn(async (sql: string) => {
          if (sql.includes('FOR UPDATE')) return clientResults.lock;
          if (sql.includes('FROM') && sql.includes('crew_ride_passengers p')) return clientResults.taken;
          return { rows: [], rowCount: 1 };
        }),
        release: mock.fn(() => {}),
      };
      const pool = {
        connect: mock.fn(async () => client),
        query: mock.fn(async () => ({ rows: [offerRow] })),
      };
      const store = createCrewsStore(pool, {}).crewRides;
      const sqls = () => (client.query.mock.calls as any[]).map((c) => c.arguments[0] as string);
      return { store, pool, client, sqls };
    }

    it("returns 'full' without inserting when every seat is taken", async () => {
      const { store, client, sqls } = makeTxStore({
        lock: { rows: [{ seats: 2, crew_id: 'crew-1' }] },
        taken: { rows: [{ user_id: 'user-2' }, { user_id: 'user-3' }] },
      });
      assert.strictEqual(await store.takeSeat('ride-1', 'user-1'), 'full');
      assert.ok(!sqls().some((s) => s.includes('INSERT')));
      assert.deepStrictEqual(sqls()[0], 'BEGIN');
      assert.ok(sqls().includes('COMMIT'));
      assert.strictEqual(client.release.mock.calls.length, 1);
    });

    it('locks the offer, counts only current members, inserts the seat and returns the offer', async () => {
      const { store, client, sqls } = makeTxStore({
        lock: { rows: [{ seats: 2, crew_id: 'crew-1' }] },
        taken: { rows: [{ user_id: 'user-2' }] },
      });
      const offer = await store.takeSeat('ride-1', 'user-1');
      assert.deepStrictEqual(offer, { id: 'ride-1', passenger_ids: ['user-1'] });
      const calls = client.query.mock.calls as any[];
      const lock = calls.find((c) => c.arguments[0].includes('FOR UPDATE'));
      assert.deepStrictEqual(lock.arguments[1], ['ride-1']);
      const taken = calls.find((c) => c.arguments[0].includes('crew_ride_passengers p'));
      assert.ok(taken.arguments[0].includes('JOIN crew_members cm'));
      assert.deepStrictEqual(taken.arguments[1], ['ride-1', 'crew-1']);
      const insert = calls.find((c) => c.arguments[0].includes('INSERT INTO crew_ride_passengers'));
      assert.ok(insert.arguments[0].includes('ON CONFLICT DO NOTHING'));
      assert.deepStrictEqual(insert.arguments[1], ['ride-1', 'user-1']);
      assert.ok(sqls().includes('COMMIT'));
    });

    it('a repeat take on a full ride succeeds without inserting', async () => {
      const { store, sqls } = makeTxStore({
        lock: { rows: [{ seats: 1, crew_id: 'crew-1' }] },
        taken: { rows: [{ user_id: 'user-1' }] },
      });
      assert.deepStrictEqual(await store.takeSeat('ride-1', 'user-1'), { id: 'ride-1', passenger_ids: ['user-1'] });
      assert.ok(!sqls().some((s) => s.includes('INSERT')));
    });

    it('a ride with no seat limit never fills', async () => {
      const { store, sqls } = makeTxStore({
        lock: { rows: [{ seats: null, crew_id: 'crew-1' }] },
        taken: { rows: [{ user_id: 'user-2' }, { user_id: 'user-3' }] },
      });
      assert.notStrictEqual(await store.takeSeat('ride-1', 'user-1'), 'full');
      assert.ok(sqls().some((s) => s.includes('INSERT INTO crew_ride_passengers')));
    });

    it('rolls back and releases the client when a query fails', async () => {
      const { store, client, sqls } = makeTxStore({ lock: undefined, taken: undefined });
      (client.query as any).mock.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) throw new Error('db down');
        return { rows: [] };
      });
      await assert.rejects(store.takeSeat('ride-1', 'user-1'), /db down/);
      assert.ok(sqls().includes('ROLLBACK'));
      assert.strictEqual(client.release.mock.calls.length, 1);
    });

    it('leaveSeat deletes only the caller row and returns the offer', async () => {
      const { store, pool } = makeTxStore({}, { id: 'ride-1', passenger_ids: [] });
      const offer = await store.leaveSeat('ride-1', 'user-1');
      assert.deepStrictEqual(offer, { id: 'ride-1', passenger_ids: [] });
      const [sql, params] = (pool.query.mock.calls as any[])[0].arguments;
      assert.strictEqual(sql, 'DELETE FROM crew_ride_passengers WHERE ride_id = $1 AND user_id = $2');
      assert.deepStrictEqual(params, ['ride-1', 'user-1']);
    });
  });
});
