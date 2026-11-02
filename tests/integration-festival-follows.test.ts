import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { createStores } from '../lib/db/index.js';

// Real-DB test (skip-gated like crew-owner-hard-delete): festival follows
// (migration 089) and the co-pick privacy floor. The helpers are imported
// lazily because _integration-helpers exits the process without a test DB.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('Integration — festival follows and co-picks', { skip, concurrency: 1 }, () => {
  let helpers: any;
  let server: any;
  let pool: Pool;

  before(async () => {
    helpers = await import('./_integration-helpers');
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  after(async () => {
    if (server) await server.close();
    await pool.end();
  });

  async function freshServer() {
    if (server) await server.close();
    server = await helpers.startServer();
    return server;
  }

  /** Seeds `count` users, each with a fest-1 profile that picks `setIds`. */
  async function seedPickers(prefix: string, count: number, setIds: string[]) {
    for (let i = 0; i < count; i++) {
      const userId = `${prefix}-u${i}`;
      const profileId = `${prefix}-p${i}`;
      await pool.query('INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $1, $2, NOW())', [
        userId,
        'x',
      ]);
      await pool.query(
        'INSERT INTO festival_profiles (id, festival_id, user_id, created_at) VALUES ($1, $2, $3, NOW())',
        [profileId, 'fest-1', userId],
      );
      for (const setId of setIds) {
        await pool.query('INSERT INTO festival_profile_picks (profile_id, set_id, priority) VALUES ($1, $2, $3)', [
          profileId,
          setId,
          'must',
        ]);
      }
    }
  }

  async function seedOtherFestival() {
    await pool.query("INSERT INTO festivals (id, name, location, created_at) VALUES ('fest-2', 'Other Fest', 'Elsewhere', NOW())");
    await pool.query("INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ('fest-2', 'main', 'Main', '#ffffff', 0)");
    await pool.query("INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ('fest-2', 0, 'Friday', '2026-07-03')");
    await pool.query(
      "INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ('other-set', 'fest-2', 0, 'Other', 'main', '10:00', '11:00', 0)",
    );
  }

  const alsoPicked = (setId: string) => server.request.get(`/api/v1/festivals/fest-1/sets/${setId}/also-picked`).expect(200);

  test('follow, list, follow again, unfollow, unfollow again', async () => {
    await freshServer();
    const alice = await helpers.registerUser(server, 'follow-alice');

    const put = await server.request.put('/api/v1/festivals/fest-1/follow').set('x-user-token', alice.token).expect(200);
    assert.deepEqual(put.body.data, { festivalId: 'fest-1', following: true });
    await server.request.put('/api/v1/festivals/fest-1/follow').set('x-user-token', alice.token).expect(200);

    const { rows } = await pool.query("SELECT 1 FROM festival_follows WHERE festival_id = 'fest-1'");
    assert.equal(rows.length, 1);
    const list = await server.request.get('/api/v1/festivals/follows').set('x-user-token', alice.token).expect(200);
    assert.deepEqual(list.body.data, { festivalIds: ['fest-1'] });

    await server.request.delete('/api/v1/festivals/fest-1/follow').set('x-user-token', alice.token).expect(200);
    const again = await server.request.delete('/api/v1/festivals/fest-1/follow').set('x-user-token', alice.token).expect(200);
    assert.deepEqual(again.body.data, { festivalId: 'fest-1', following: false });
    const empty = await server.request.get('/api/v1/festivals/follows').set('x-user-token', alice.token).expect(200);
    assert.deepEqual(empty.body.data, { festivalIds: [] });
  });

  test('drafts and deleted festivals cannot be followed; a later delete hides the follow', async () => {
    await freshServer();
    await seedOtherFestival();
    const bob = await helpers.registerUser(server, 'follow-bob');

    await pool.query("UPDATE festivals SET published_at = NULL WHERE id = 'fest-2'");
    await server.request.put('/api/v1/festivals/fest-2/follow').set('x-user-token', bob.token).expect(404);
    await pool.query("UPDATE festivals SET published_at = NOW(), deleted_at = NOW() WHERE id = 'fest-2'");
    await server.request.put('/api/v1/festivals/fest-2/follow').set('x-user-token', bob.token).expect(404);
    await server.request.put('/api/v1/festivals/missing/follow').set('x-user-token', bob.token).expect(404);

    await server.request.put('/api/v1/festivals/fest-1/follow').set('x-user-token', bob.token).expect(200);
    await pool.query("UPDATE festivals SET deleted_at = NOW() WHERE id = 'fest-1'");
    const list = await server.request.get('/api/v1/festivals/follows').set('x-user-token', bob.token).expect(200);
    assert.deepEqual(list.body.data, { festivalIds: [] });
  });

  test('GET /follows needs auth, and GET /festivals/:id still works', async () => {
    await freshServer();
    await server.request.get('/api/v1/festivals/follows').expect(401);
    const fest = await server.request.get('/api/v1/festivals/fest-1').expect(200);
    assert.equal(fest.body.data.id, 'fest-1');
  });

  test('co-picks need 20 distinct users and return set ids only', async () => {
    await freshServer();
    await seedPickers('cp20', 20, ['set-a', 'set-b']);
    const res = await alsoPicked('set-a');
    assert.deepEqual(res.body.data, { setIds: ['set-b'] });
    assert.deepEqual(Object.keys(res.body.data), ['setIds']);

    await freshServer();
    await seedPickers('cp19', 19, ['set-a', 'set-b']);
    assert.deepEqual((await alsoPicked('set-a')).body.data, { setIds: [] });
  });

  test('soft-deleted users and deleted profiles do not count', async () => {
    await freshServer();
    await seedPickers('cpdu', 20, ['set-a', 'set-b']);
    await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = 'cpdu-u0'");
    assert.deepEqual((await alsoPicked('set-a')).body.data, { setIds: [] });

    await freshServer();
    await seedPickers('cpdp', 20, ['set-a', 'set-b']);
    await pool.query("UPDATE festival_profiles SET deleted_at = NOW() WHERE id = 'cpdp-p0'");
    assert.deepEqual((await alsoPicked('set-a')).body.data, { setIds: [] });
  });

  test('a set in another festival never appears, and a foreign set is 404', async () => {
    await freshServer();
    await seedOtherFestival();
    await seedPickers('cpof', 20, ['set-a', 'other-set']);
    assert.deepEqual((await alsoPicked('set-a')).body.data, { setIds: [] });
    await server.request.get('/api/v1/festivals/fest-1/sets/other-set/also-picked').expect(404);
  });

  test('hard-deleting a user with follows cascades, and retention_cleanup still runs', async () => {
    await freshServer();
    await seedPickers('cphd', 2, []);
    await pool.query("INSERT INTO festival_follows (user_id, festival_id) VALUES ('cphd-u0', 'fest-1'), ('cphd-u1', 'fest-1')");

    await createStores(pool).users.hardDelete('cphd-u0');
    const { rows: gone } = await pool.query("SELECT 1 FROM festival_follows WHERE user_id = 'cphd-u0'");
    assert.equal(gone.length, 0);

    await pool.query("UPDATE users SET deleted_at = NOW() - INTERVAL '40 days' WHERE id = 'cphd-u1'");
    await pool.query('SELECT retention_cleanup()');
    const { rows: purged } = await pool.query("SELECT 1 FROM festival_follows WHERE user_id = 'cphd-u1'");
    assert.equal(purged.length, 0);
  });
});
