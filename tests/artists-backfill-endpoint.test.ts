import 'dotenv/config';
/**
 * POST /api/v1/admin/artists/backfill end to end, on the test database. The seed mirrors the
 * artist-backfill tests: sets whose artist elements have no ids.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { seedFestival, skip, startArtistServer, withPool, type ArtistServer } from './_artist-helpers';
import { loginUser, registerUser, TRUSTED_MUTATION_HEADER } from './_integration-helpers';

let app: ArtistServer;
const wipe = () =>
  withPool((pool) => pool.query('TRUNCATE TABLE artist_backfill_runs, artists, festival_sets, festival_days, festival_stages, festivals CASCADE'));
const idsOf = () => withPool(async (pool) => (await pool.query('SELECT id, artists FROM festival_sets ORDER BY id')).rows);

before(async () => {
  if (skip) return;
  app = await startArtistServer();
  await wipe();
  await withPool((pool) =>
    seedFestival(pool, {
      id: 'bf-fest',
      published: true,
      sets: [
        { id: 'bf-1', artist: 'Alpha', artists: [{ name: 'Alpha', links: {} }] },
        { id: 'bf-2', artist: 'Beta', artists: [{ name: 'Beta', links: {} }] },
      ],
    }),
  );
});
after(async () => {
  if (!app) return;
  await wipe();
  await app.close();
});

describe('artist backfill endpoint', { skip }, () => {
  test('refuses a caller without a session and a bad mode', async () => {
    await app.server.request.post('/api/v1/admin/artists/backfill').send({ mode: 'dry-run' }).expect(401);
    await app.post('/api/v1/admin/artists/backfill', { mode: 'wipe' }).expect(400);
  });

  test('a signed-in user who is not an admin gets 403 in every mode', async () => {
    await registerUser(app.server, 'bf-plain-user');
    const { token } = await loginUser(app.server, 'bf-plain-user');
    for (const mode of ['dry-run', 'run', 'verify']) {
      await app.server.request
        .post('/api/v1/admin/artists/backfill')
        .set('x-user-token', token)
        .set(TRUSTED_MUTATION_HEADER, '1')
        .send({ mode })
        .expect(403);
    }
  });

  test('dry-run reports and writes nothing', async () => {
    const before = await idsOf();
    const res = await app.post('/api/v1/admin/artists/backfill', { mode: 'dry-run' }).expect(200);
    assert.equal(res.body.data.report.counts.sets, 2);
    assert.ok(res.body.data.report.counts.artistsToCreate > 0);
    assert.deepEqual(await idsOf(), before);
  });

  test('run is refused without a recent re-auth', async () => {
    const res = await app.post('/api/v1/admin/artists/backfill', { mode: 'run' }).expect(403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
  });

  test('run with a stale planHash is 409 PLAN_CHANGED and writes nothing', async () => {
    const before = await idsOf();
    const dry = await app.post('/api/v1/admin/artists/backfill', { mode: 'dry-run' }).expect(200);
    assert.match(dry.body.data.planHash, /^[a-f0-9]{64}$/);
    await app.post('/api/v1/auth/reauth', { password: 'test-admin-password' }).expect(200);
    const stale = await app.post('/api/v1/admin/artists/backfill', { mode: 'run', planHash: 'f'.repeat(64) }).expect(409);
    assert.equal(stale.body.error.code, 'PLAN_CHANGED');
    assert.deepEqual(await idsOf(), before);
  });

  test('run links ids, verify is ok, a second dry-run reports zero changes, one audit row exists', async () => {
    await app.post('/api/v1/auth/reauth', { password: 'test-admin-password' }).expect(200);
    const dry = await app.post('/api/v1/admin/artists/backfill', { mode: 'dry-run' }).expect(200);
    const run = await app.post('/api/v1/admin/artists/backfill', { mode: 'run', planHash: dry.body.data.planHash }).expect(200);
    assert.equal(run.body.data.result.festivalsWritten.length, 1);
    for (const row of await idsOf()) assert.ok(row.artists[0].id, `${row.id} has an artist id`);

    const verify = await app.post('/api/v1/admin/artists/backfill', { mode: 'verify' }).expect(200);
    assert.equal(verify.body.data.result.ok, true);

    const again = await app.post('/api/v1/admin/artists/backfill', { mode: 'dry-run' }).expect(200);
    const counts = again.body.data.report.counts;
    assert.equal(counts.artistsToCreate, 0);
    assert.equal(counts.festivalsToWrite, 0);
    assert.equal(counts.ownersToWrite, 0);

    await new Promise((resolve) => setTimeout(resolve, 200));
    const { rows } = await withPool((pool) => pool.query(`SELECT target_type, details_json FROM audit_log WHERE action = 'artist.backfill.run'`));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target_type, 'artist_backfill');
  });
});
