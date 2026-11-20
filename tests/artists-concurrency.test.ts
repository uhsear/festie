import 'dotenv/config';
/**
 * Lock order and races: festivals first, then artists. Two clients and an explicit
 * barrier, so the interleaving is the one under test and not a lucky timing. Needs TEST_DATABASE_URL.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { resolveArtistRefs } from '../lib/artist-refs';
import { createArtistsStore } from '../lib/db/stores/artists';
import { lockFestivalAny } from '../lib/db/stores/festival-lock';
import { TEST_DATABASE_URL } from './_integration-helpers';
import { createArtist, dropFestivalCache, formBody, seedFestival, setRow, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';

let app: ArtistServer;
let pool: Pool;
before(async () => {
  if (skip) return;
  app = await startArtistServer();
  pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
});
after(async () => {
  if (pool) await pool.end();
  if (app) await app.close();
});

const settled = (promise: Promise<unknown>) =>
  Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 600))]);

describe('artist edit and festival save take locks in one order', { skip, concurrency: 1 }, () => {
  test('an artist edit that needs a festival waits for a save, retries, and the final copy equals the artist row', async () => {
    const artist = await createArtist(app, { name: 'Barrier Old' });
    const old = { id: artist.id, name: 'Barrier Old', links: {} };
    await withPool(async (p) => {
      await seedFestival(p, { id: 'fest-lock-known', sets: [{ id: 'lock-known-1', artist: 'Barrier Old', artists: [old] }] });
      await seedFestival(p, { id: 'fest-lock-new', sets: [] });
    });

    // Client A: a festival save in flight. It holds the festival lock and has read the artist.
    const a = await pool.connect();
    await a.query('BEGIN');
    await lockFestivalAny(a, 'fest-lock-new');
    const resolved = await resolveArtistRefs(a, {
      festivalId: 'fest-lock-new',
      days: [{ sets: [{ id: 'lock-new-1', artist: 'Barrier Old', artists: [old] }] }],
      separator: 'b2b',
      userId: null,
    });

    // Client B: the artist edit. It cannot see A's uncommitted festival, so it locks the artist and waits for A's share lock.
    const store = createArtistsStore(pool);
    const edit = store.update(artist.id, { expectedUpdatedAt: artist.updatedAt, changes: { name: 'Barrier New' }, userId: null });
    assert.equal(await settled(edit), false, 'the edit waits for the save instead of overtaking it');

    // A finishes its save with the copy it read, then commits.
    const set = resolved.days![0].sets[0];
    await a.query(
      `INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order, artists)
       VALUES ('lock-new-1', 'fest-lock-new', 0, $1, 'fest-lock-new-main', '20:00', '23:00', 0, $2::jsonb)`,
      [set.artist, JSON.stringify(set.artists)],
    );
    await a.query('COMMIT');
    a.release();

    // B starts over once it sees the new festival, and rewrites both copies.
    const result = await edit;
    assert.deepEqual(result.synced.map((f) => f.id).sort(), ['fest-lock-known', 'fest-lock-new']);
    await withPool(async (p) => {
      for (const id of ['lock-known-1', 'lock-new-1']) {
        const row = await setRow(p, id);
        assert.equal(row.artists[0].name, 'Barrier New', id);
        assert.equal(row.artist, 'Barrier New', id);
      }
    });
  });

  test('a save that reads the artist after the edit committed copies the new name', async () => {
    const artist = await createArtist(app, { name: 'After Old' });
    const store = createArtistsStore(pool);
    await store.update(artist.id, { expectedUpdatedAt: artist.updatedAt, changes: { name: 'After New' }, userId: null });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await resolveArtistRefs(client, {
        festivalId: 'fest-none',
        days: [{ sets: [{ id: 's', artist: 'After Old', artists: [{ id: artist.id, name: 'After Old', links: {} }] }] }],
        separator: 'b2b',
        userId: null,
      });
      assert.equal(out.days![0].sets[0].artists[0].name, 'After New');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('concurrent saves that create the same new names', { skip, concurrency: 1 }, () => {
  const save = (festivalId: string, artist: string) =>
    app.put(`/api/v1/admin/festivals/${festivalId}`, formBody({ id: festivalId }, [
      { id: `${festivalId}-set`, artist, stageId: `${festivalId}-main`, startTime: '20:00', endTime: '23:00' },
    ]));

  async function seedPair(round: number, tag: string) {
    const ids = [`fest-${tag}-${round}-a`, `fest-${tag}-${round}-b`];
    await withPool(async (p) => {
      for (const id of ids) await seedFestival(p, { id, sets: [] });
    });
    await dropFestivalCache(app);
    return ids as [string, string];
  }

  test('two saves create one name at once: one artist, no 500', async () => {
    for (let round = 0; round < 2; round += 1) {
      const [first, second] = await seedPair(round, 'same');
      const name = `Race Name ${round}`;
      const [r1, r2] = await Promise.all([save(first, name), save(second, name)]);
      assert.equal(r1.status, 200, JSON.stringify(r1.body));
      assert.equal(r2.status, 200, JSON.stringify(r2.body));
      await withPool(async (p) => {
        const { rows } = await p.query('SELECT id FROM artists WHERE name = $1', [name]);
        assert.equal(rows.length, 1);
        assert.equal((await setRow(p, `${first}-set`)).artists[0].id, rows[0].id);
        assert.equal((await setRow(p, `${second}-set`)).artists[0].id, rows[0].id);
      });
    }
  });

  test('saves that create A, B and B, A at once: no deadlock and two artists', async () => {
    for (let round = 0; round < 2; round += 1) {
      const [first, second] = await seedPair(round, 'cross');
      const a = `Cross Alpha ${round}`;
      const b = `Cross Beta ${round}`;
      const [r1, r2] = await Promise.all([save(first, `${a} b2b ${b}`), save(second, `${b} b2b ${a}`)]);
      assert.equal(r1.status, 200, JSON.stringify(r1.body));
      assert.equal(r2.status, 200, JSON.stringify(r2.body));
      await withPool(async (p) => {
        const { rows } = await p.query('SELECT name FROM artists WHERE name = ANY($1::text[])', [[a, b]]);
        assert.equal(rows.length, 2);
      });
    }
  });
});
