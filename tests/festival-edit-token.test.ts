import 'dotenv/config';
/**
 * The festival form's conflict token: checked inside the save, under the festival row
 * lock, against the last form edit. Needs TEST_DATABASE_URL.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { dropFestivalCache, festivalRow, formBody, seedFestival, setRow, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';

let app: ArtistServer;
before(async () => {
  if (!skip) app = await startArtistServer();
});
after(async () => {
  if (app) await app.close();
});

const set = (id: string, artist: string, festivalId: string) => ({
  id,
  artist,
  stageId: `${festivalId}-main`,
  startTime: '20:00',
  endTime: '23:00',
});

async function open(festivalId: string) {
  await dropFestivalCache(app);
  const res = await app.get(`/api/v1/admin/festivals/${festivalId}`).expect(200);
  return res.body.data.updatedAt as string;
}

describe('festival save token', { skip, concurrency: 1 }, () => {
  test('an import write (NOW(), microseconds), then a save with the token from GET: 200', async () => {
    await withPool((pool) => seedFestival(pool, { id: 'fest-token-1', sets: [{ id: 'token-1-a', artist: 'Alpha', artists: [] }] }));
    await dropFestivalCache(app);
    await app.post('/api/v1/admin/festivals/fest-token-1/import-lineup', {
      rows: [{ row: 2, artist: 'Beta', stage: 'Main', day: 'Friday', date: '2099-08-21', startTime: '21:00', endTime: '22:00' }],
      skipSpotify: true,
    }).expect(200);
    const token = await open('fest-token-1');
    // The token a client holds is cut to milliseconds, the stored value has microseconds.
    assert.match(token, /\.\d{3}Z$/);
    await app.put('/api/v1/admin/festivals/fest-token-1', formBody({ id: 'fest-token-1' }, [set('token-1-a', 'Alpha', 'fest-token-1')], {
      expectedUpdatedAt: token,
    })).expect(200);
  });

  test('a save moves the form edit time, so a second save with the old token is a 409', async () => {
    await withPool((pool) => seedFestival(pool, { id: 'fest-token-2', sets: [] }));
    const token = await open('fest-token-2');
    const body = formBody({ id: 'fest-token-2' }, [], { expectedUpdatedAt: token });
    await app.put('/api/v1/admin/festivals/fest-token-2', body).expect(200);
    const stale = await app.put('/api/v1/admin/festivals/fest-token-2', body).expect(409);
    assert.equal(stale.body.error.code, 'FESTIVAL_CHANGED');
  });

  test('a festival soft-deleted after the form loaded: the save fails before any child write', async () => {
    await withPool((pool) => seedFestival(pool, { id: 'fest-token-3', sets: [{ id: 'token-3-a', artist: 'Keep', artists: [] }] }));
    const token = await open('fest-token-3');
    await withPool((pool) => pool.query(`UPDATE festivals SET deleted_at = now() WHERE id = 'fest-token-3'`));
    const res = await app.put('/api/v1/admin/festivals/fest-token-3', formBody({ id: 'fest-token-3' }, [set('token-3-b', 'Intruder', 'fest-token-3')], {
      expectedUpdatedAt: token,
    }));
    assert.equal(res.status, 409);
    await withPool(async (pool) => {
      const { rows } = await pool.query(`SELECT id FROM festival_sets WHERE festival_id = 'fest-token-3'`);
      assert.deepEqual(rows.map((r: any) => r.id), ['token-3-a']);
    });
  });

  test('a set added after the cache was read makes a days save a 409 and writes nothing', async () => {
    await withPool((pool) => seedFestival(pool, { id: 'fest-token-4', sets: [{ id: 'token-4-a', artist: 'Alpha', artists: [] }] }));
    const token = await open('fest-token-4');
    await withPool((pool) =>
      pool.query(
        `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists)
         VALUES ('token-4-late', 'fest-token-4', 0, 'Late Add', 'fest-token-4-main', '22:00', '23:00', 5, '[]')`,
      ),
    );
    const res = await app.put('/api/v1/admin/festivals/fest-token-4', formBody({ id: 'fest-token-4' }, [set('token-4-a', 'Alpha Edited', 'fest-token-4')], {
      expectedUpdatedAt: token,
    }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'FESTIVAL_CHANGED');
    await withPool(async (pool) => {
      assert.equal((await setRow(pool, 'token-4-a')).artist, 'Alpha');
      assert.equal((await pool.query(`SELECT 1 FROM festival_sets WHERE id = 'token-4-late'`)).rowCount, 1);
    });
  });

  test('an old client with no token still saves, and edited_at follows the save', async () => {
    await withPool((pool) => seedFestival(pool, { id: 'fest-token-5', sets: [] }));
    await dropFestivalCache(app);
    const before1 = await withPool((pool) => festivalRow(pool, 'fest-token-5'));
    await app.put('/api/v1/admin/festivals/fest-token-5', formBody({ id: 'fest-token-5' }, [])).expect(200);
    const after1 = await withPool((pool) => festivalRow(pool, 'fest-token-5'));
    assert.ok(new Date(after1.edited_at) > new Date(before1.edited_at));
  });
});
