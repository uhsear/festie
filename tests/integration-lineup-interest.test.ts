// Interest marks on the announced lineup, against a real database: delta writes, server conversion
// after an import, the reopen rule, import undo, the converted-pick guard, privacy, export, delete
// and the admin counts. The pure conversion rules are in tests/lineup-interest.test.ts.
import { afterEach, describe, test } from 'node:test';
import { assert, Pool, startServer, loginAdmin, registerUser, joinFestivalProfile } from './_integration-helpers';
import createProfilesStore from '../lib/db/stores/profiles';

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

const act = (name: string) => ({ artists: [{ name, links: {} }] });
const importRow = (row: number, artist: string, startTime: string) => ({
  row,
  artist,
  stage: 'Main Stage',
  day: 'Friday',
  date: '2026-06-05',
  startTime,
  endTime: `${Number(startTime.slice(0, 2)) + 1}:00`,
});

/** Retries until the check passes: conversion runs after the response. */
async function until<T>(check: () => Promise<T | false | undefined | null>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function setup(overrides: Record<string, any> = {}) {
  const server = await startServer(overrides);
  servers.push(server);
  const admin = await loginAdmin(server);
  const pool = new Pool({ connectionString: server.databaseUrl });
  const origClose = server.close;
  server.close = async () => {
    await pool.end();
    await origClose();
  };

  const festival = async () =>
    (await server.request.get('/api/v1/admin/festivals/fest-1').set('x-user-token', admin).expect(200)).body.data;
  const putFestival = (body: Record<string, unknown>) =>
    server.request.put('/api/v1/admin/festivals/fest-1').set('x-user-token', admin).send(body);
  const first = await festival();
  await putFestival({
    expectedUpdatedAt: first.updatedAt,
    lineup: [act('Alpha'), act('Zeta'), act('Omega'), act('Kappa')],
  }).expect(200);
  const lineup: any[] = (await festival()).lineup;
  const entry = (name: string) => lineup.find((e) => e.artists[0].name === name).id as string;

  const importRows = (rows: any[]) =>
    server.request
      .post('/api/v1/admin/festivals/fest-1/import-lineup')
      .set('x-user-token', admin)
      .send({ rows, skipSpotify: true });
  const undoImport = (importId: string) =>
    server.request.post(`/api/v1/admin/festivals/fest-1/imports/${importId}/undo`).set('x-user-token', admin);

  async function user(name: string) {
    const account = await registerUser(server, name);
    const profile = await joinFestivalProfile(server, account.token);
    const put = (body: Record<string, unknown>) =>
      server.request.put(`/api/v1/profiles/${profile.id}`).set('x-user-token', account.token).send(body);
    const own = async () => {
      const list = (await server.request.get('/api/v1/profiles/fest-1').set('x-user-token', account.token).expect(200)).body.data;
      return list.find((p: any) => p.id === profile.id);
    };
    const row = async () =>
      (await pool.query('SELECT interests_json, picks_json FROM festival_profiles WHERE id = $1', [profile.id])).rows[0];
    const dbPicks = async () =>
      Object.fromEntries(
        (await pool.query('SELECT set_id, priority FROM festival_profile_picks WHERE profile_id = $1', [profile.id])).rows.map(
          (r: any) => [r.set_id, r.priority],
        ),
      );
    return { account, profile, put, own, row, dbPicks };
  }

  const setIdOf = async (artist: string) =>
    (await pool.query('SELECT id FROM festival_sets WHERE festival_id = $1 AND artist = $2', [
      'fest-1',
      artist,
    ])).rows.map((r: any) => r.id as string);

  return { server, admin, pool, festival, putFestival, entry, importRows, undoImport, user, setIdOf };
}

describe('Integration: interest marks', { concurrency: 1 }, () => {
  test('interestAdd and interestRemove are deltas, unknown ids are dropped, picks stay on remove', async () => {
    const { entry, user } = await setup();
    const alice = await user('alice');

    const added = await alice.put({ interestAdd: [entry('Zeta'), entry('Omega'), 'lu-not-in-lineup'] }).expect(200);
    assert.deepEqual(Object.keys(added.body.data.interests).sort(), [entry('Omega'), entry('Zeta')].sort());
    assert.deepEqual(added.body.data.interests[entry('Zeta')], { state: 'open' });

    // Adding again changes nothing, and an unknown id in remove is dropped quietly.
    await alice.put({ interestAdd: [entry('Zeta')], interestRemove: ['lu-not-in-lineup'] }).expect(200);
    const removed = await alice.put({ interestRemove: [entry('Omega')] }).expect(200);
    assert.deepEqual(Object.keys(removed.body.data.interests), [entry('Zeta')]);

    // The viewer serializer returns the owner's marks too, so a reload sees them.
    assert.deepEqual(Object.keys((await alice.own()).interests), [entry('Zeta')]);
  });

  test('two devices adding different marks both survive', async () => {
    const { entry, user } = await setup();
    const alice = await user('alice');
    await Promise.all([alice.put({ interestAdd: [entry('Zeta')] }).expect(200), alice.put({ interestAdd: [entry('Omega')] }).expect(200)]);
    assert.deepEqual(Object.keys((await alice.row()).interests_json).sort(), [entry('Omega'), entry('Zeta')].sort());
  });

  test('a mark on an act that sets already cover converts at once', async () => {
    const { entry, user } = await setup();
    const alice = await user('alice');
    // Alpha has a timetable set (set-a), so the add converts it after the response.
    await alice.put({ interestAdd: [entry('Alpha')] }).expect(200);
    const row = await until(async () => {
      const r = await alice.row();
      return r.interests_json[entry('Alpha')]?.state === 'converted' && r;
    }, 'Alpha to convert');
    assert.deepEqual(row.interests_json[entry('Alpha')].sets, ['set-a']);
    assert.deepEqual(await alice.dbPicks(), { 'set-a': 'want-to-see' });
    assert.deepEqual(row.picks_json, { 'set-a': 'want-to-see' });
  });

  test('an import that schedules marked acts converts them for every user, and a second run changes nothing', async () => {
    const { entry, user, importRows, putFestival, festival, setIdOf, pool } = await setup();
    const alice = await user('alice');
    const bob = await user('bob');
    await alice.put({ interestAdd: [entry('Zeta'), entry('Omega'), entry('Kappa')] }).expect(200);
    await bob.put({ interestAdd: [entry('Zeta')] }).expect(200);

    await importRows([importRow(2, 'Zeta', '16:00'), importRow(3, 'Omega', '18:00')]).expect(200);
    const [zetaSet] = await setIdOf('Zeta');
    const [omegaSet] = await setIdOf('Omega');

    const aliceRow = await until(async () => {
      const r = await alice.row();
      return r.interests_json[entry('Omega')]?.state === 'converted' && r;
    }, 'alice to convert');
    assert.deepEqual(aliceRow.interests_json[entry('Zeta')].sets, [zetaSet]);
    assert.deepEqual(aliceRow.interests_json[entry('Omega')].sets, [omegaSet]);
    assert.deepEqual(aliceRow.interests_json[entry('Kappa')], { state: 'open' });
    assert.deepEqual(await alice.dbPicks(), { [zetaSet!]: 'want-to-see', [omegaSet!]: 'want-to-see' });
    assert.deepEqual(aliceRow.picks_json, { [zetaSet!]: 'want-to-see', [omegaSet!]: 'want-to-see' });
    await until(async () => (await bob.row()).interests_json[entry('Zeta')]?.state === 'converted', 'bob to convert');
    assert.deepEqual(await bob.dbPicks(), { [zetaSet!]: 'want-to-see' });

    // A second run (a festival save) is a no-op: no new updated_at on the profile.
    const stamp = async () => (await pool.query('SELECT updated_at FROM festival_profiles WHERE id = $1', [alice.profile.id])).rows[0].updated_at.toISOString();
    const before = await stamp();
    const current = await festival();
    await putFestival({ name: current.name, stages: current.stages, days: current.days }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(await stamp(), before);
  });

  test('an existing pick of any priority is kept when its set gets covered', async () => {
    const { entry, user, importRows, setIdOf } = await setup();
    const alice = await user('alice');
    // set-a is Alpha's set: pick it as "must" first, then mark Alpha.
    await alice.put({ picks: { 'set-a': 'must' } }).expect(200);
    await alice.put({ interestAdd: [entry('Alpha')] }).expect(200);
    await until(async () => (await alice.row()).interests_json[entry('Alpha')]?.state === 'converted', 'Alpha to convert');
    assert.deepEqual(await alice.dbPicks(), { 'set-a': 'must' });
    await importRows([importRow(2, 'Zeta', '16:00')]).expect(200);
    assert.equal((await setIdOf('Zeta')).length, 1);
  });

  test('conversion stops at MAX_PICKS and leaves the rest open', async () => {
    const { entry, user, importRows } = await setup({ MAX_PICKS: 1 });
    const alice = await user('alice');
    await alice.put({ interestAdd: [entry('Zeta'), entry('Omega')] }).expect(200);
    await importRows([importRow(2, 'Zeta', '16:00'), importRow(3, 'Omega', '18:00')]).expect(200);
    const marks = await until(async () => {
      const m = (await alice.row()).interests_json;
      return Object.values<any>(m).some((mark) => mark.state === 'converted') && m;
    }, 'one mark to convert');
    assert.deepEqual(Object.values<any>(marks).map((m) => m.state).sort(), ['converted', 'open']);
    assert.equal(Object.keys(await alice.dbPicks()).length, 1);
  });

  test('import undo takes back conversion picks, keeps a raised pick, and a re-import converts again', async () => {
    const { entry, user, importRows, undoImport, setIdOf } = await setup();
    const alice = await user('alice');
    const bob = await user('bob');
    await alice.put({ interestAdd: [entry('Zeta'), entry('Omega')] }).expect(200);
    await bob.put({ interestAdd: [entry('Omega')] }).expect(200);

    const committed = await importRows([importRow(2, 'Zeta', '16:00'), importRow(3, 'Omega', '18:00')]).expect(200);
    const importId = committed.body.data.result.importId;
    const [zetaSet] = await setIdOf('Zeta');
    await until(async () => (await bob.row()).interests_json[entry('Omega')]?.state === 'converted', 'bob to convert');
    await until(async () => (await alice.row()).interests_json[entry('Zeta')]?.state === 'converted', 'alice to convert');

    // Alice raises Zeta to must: that is her own choice, so undo keeps the set and her pick.
    await alice.put({ picks: { ...(await alice.dbPicks()), [zetaSet!]: 'must' } }).expect(200);

    const undone = await undoImport(importId).expect(200);
    assert.equal(undone.body.data.removed, 1);
    assert.equal(undone.body.data.autoPicksRemoved, 2);
    assert.deepEqual(undone.body.data.kept.map((k: any) => [k.setId, k.reason]), [[zetaSet, 'picked']]);
    assert.deepEqual(await setIdOf('Omega'), []);

    const aliceAfter = await alice.row();
    assert.deepEqual(aliceAfter.interests_json[entry('Omega')], { state: 'open' });
    assert.equal(aliceAfter.interests_json[entry('Zeta')].state, 'converted');
    assert.deepEqual(await alice.dbPicks(), { [zetaSet!]: 'must' });
    assert.deepEqual(aliceAfter.picks_json, { [zetaSet!]: 'must' });
    assert.deepEqual((await bob.row()).interests_json[entry('Omega')], { state: 'open' });
    assert.deepEqual(await bob.dbPicks(), {});

    await importRows([importRow(2, 'Omega', '18:00')]).expect(200);
    const [omegaAgain] = await setIdOf('Omega');
    await until(async () => (await bob.row()).interests_json[entry('Omega')]?.state === 'converted', 'bob to convert again');
    assert.deepEqual((await bob.row()).interests_json[entry('Omega')].sets, [omegaAgain]);
  });

  test('a converted mark reopens when its set is deleted and added again with a new id', async () => {
    const { server, admin, entry, user, importRows, setIdOf, festival, putFestival } = await setup();
    const alice = await user('alice');
    await alice.put({ interestAdd: [entry('Zeta')] }).expect(200);
    await importRows([importRow(2, 'Zeta', '16:00')]).expect(200);
    const [oldId] = await setIdOf('Zeta');
    await until(async () => (await alice.row()).interests_json[entry('Zeta')]?.state === 'converted', 'Zeta to convert');

    const current = await festival();
    const days = current.days.map((day: any) => ({
      ...day,
      sets: day.sets.map((set: any) => (set.id === oldId ? { ...set, id: 'zeta-new' } : set)),
    }));
    // Deleting a set that someone picked needs the removal confirm and a recent password check.
    await server.request.post('/api/v1/auth/reauth').set('x-user-token', admin).send({ password: 'test-admin-password' }).expect(200);
    await putFestival({ name: current.name, stages: current.stages, days, confirmRemovals: true }).expect(200);

    const row = await until(async () => {
      const r = await alice.row();
      return r.interests_json[entry('Zeta')]?.sets?.[0] === 'zeta-new' && r;
    }, 'Zeta to convert onto the new set');
    // The picks table is the read source. A festival save does not prune the picks_json mirror of a deleted set.
    assert.deepEqual(await alice.dbPicks(), { 'zeta-new': 'want-to-see' });
    assert.equal(row.picks_json['zeta-new'], 'want-to-see');
  });

  test('the converted-pick guard keeps a pick that a stale full-map write omits, until the 72 hours pass', async () => {
    const { entry, user, importRows, setIdOf, pool } = await setup();
    const alice = await user('alice');
    await alice.put({ interestAdd: [entry('Zeta')] }).expect(200);
    await importRows([importRow(2, 'Zeta', '16:00')]).expect(200);
    const [zetaSet] = await setIdOf('Zeta');
    await until(async () => (await alice.row()).interests_json[entry('Zeta')]?.state === 'converted', 'Zeta to convert');

    // An old build sends the whole map it holds, which predates the conversion.
    const stale = await alice.put({ picks: { 'set-a': 'must' } }).expect(200);
    assert.deepEqual(stale.body.data.picks, { 'set-a': 'must', [zetaSet!]: 'want-to-see' });
    assert.deepEqual(await alice.dbPicks(), { 'set-a': 'must', [zetaSet!]: 'want-to-see' });

    // An explicit remove ends the protection: the mark is gone, so the next full map removes the pick.
    await alice.put({ interestRemove: [entry('Zeta')] }).expect(200);
    await alice.put({ picks: { 'set-a': 'must' } }).expect(200);
    assert.deepEqual(await alice.dbPicks(), { 'set-a': 'must' });

    // Past 72 hours a removed pick stays removed and the converted mark does not bring it back.
    await alice.put({ interestAdd: [entry('Zeta')] }).expect(200);
    await until(async () => (await alice.row()).interests_json[entry('Zeta')]?.state === 'converted', 'Zeta to convert again');
    await pool.query(
      `UPDATE festival_profiles SET interests_json = jsonb_set(interests_json, ARRAY[$2, 'at'], to_jsonb($3::text)) WHERE id = $1`,
      [alice.profile.id, entry('Zeta'), new Date(Date.now() - 73 * 3600_000).toISOString()],
    );
    await alice.put({ picks: { 'set-a': 'must' } }).expect(200);
    assert.deepEqual(await alice.dbPicks(), { 'set-a': 'must' });
    assert.equal((await alice.row()).interests_json[entry('Zeta')].state, 'converted');
  });

  test('privacy: other attendees and crew mates never get marks, the owner and the export do', async () => {
    const { server, entry, user } = await setup();
    const alice = await user('alice');
    const bob = await user('bob');
    await alice.put({ interestAdd: [entry('Zeta')] }).expect(200);

    const seenByBob = (await server.request.get('/api/v1/profiles/fest-1').set('x-user-token', bob.account.token).expect(200)).body.data;
    assert.equal(seenByBob.find((p: any) => p.id === alice.profile.id).interests, undefined);

    const crew = (
      await server.request.post('/api/v1/crews').set('x-user-token', alice.account.token).send({ name: 'Squad', festivalId: 'fest-1' }).expect(201)
    ).body.data;
    await server.request.post('/api/v1/crews/join').set('x-user-token', bob.account.token).send({ inviteCode: crew.inviteCode }).expect(200);
    const seenByMate = (await server.request.get('/api/v1/profiles/fest-1').set('x-user-token', bob.account.token).expect(200)).body.data;
    assert.equal(seenByMate.find((p: any) => p.id === alice.profile.id).interests, undefined);
    assert.deepEqual(Object.keys((await alice.own()).interests), [entry('Zeta')]);

    const exported = (await server.request.get('/api/v1/account/export').set('x-user-token', alice.account.token).expect(200)).body.data;
    assert.deepEqual(Object.keys(exported.profiles[0].interests), [entry('Zeta')]);
  });

  test('account delete: an admin purge clears marks, a self-service delete keeps them for the grace window', async () => {
    const { server, entry, user, pool } = await setup();
    const alice = await user('alice');
    const bob = await user('bob');
    await alice.put({ interestAdd: [entry('Zeta')] }).expect(200);
    await bob.put({ interestAdd: [entry('Zeta')] }).expect(200);
    const store = createProfilesStore(pool as any, { mapProfileRow: (row: any) => row });

    await store.profiles.deleteByUserId(alice.account.user.id);
    await store.profiles.deleteByUserId(bob.account.user.id, { keepPicks: true, reason: 'account-deleted' });
    const marks = async (id: string) => (await pool.query('SELECT interests_json FROM festival_profiles WHERE id = $1', [id])).rows[0].interests_json;
    assert.deepEqual(await marks(alice.profile.id), {});
    assert.deepEqual(Object.keys(await marks(bob.profile.id)), [entry('Zeta')]);

    await store.profiles.restoreByUserId(bob.account.user.id);
    assert.equal((await pool.query('SELECT 1 FROM festival_profiles WHERE id = $1 AND deleted_at IS NULL', [bob.profile.id])).rowCount, 1);
    assert.ok(server);
  });

  test('interestedProfilesByEntry lists the users whose mark is still open, never a converted one', async () => {
    const { entry, user, importRows, pool } = await setup();
    const alice = await user('alice');
    const bob = await user('bob');
    await alice.put({ interestAdd: [entry('Zeta'), entry('Omega')] }).expect(200);
    await bob.put({ interestAdd: [entry('Zeta')] }).expect(200);
    await importRows([importRow(2, 'Omega', '18:00')]).expect(200);
    await until(async () => (await alice.row()).interests_json[entry('Omega')]?.state === 'converted', 'Omega to convert');

    const store = createProfilesStore(pool as any, { mapProfileRow: (row: any) => row });
    const open = await store.profiles.interestedProfilesByEntry('fest-1', [entry('Zeta'), entry('Omega')]);
    assert.deepEqual([...(open.get(entry('Zeta')) ?? [])].sort(), [alice.account.user.id, bob.account.user.id].sort());
    assert.equal(open.has(entry('Omega')), false);
    assert.equal((await store.profiles.interestedProfilesByEntry('fest-1', [])).size, 0);
  });

  test('the admin count route returns open and converted counts and refuses a non-admin', async () => {
    const { server, admin, entry, user, importRows } = await setup();
    const alice = await user('alice');
    const bob = await user('bob');
    await alice.put({ interestAdd: [entry('Zeta'), entry('Omega')] }).expect(200);
    await bob.put({ interestAdd: [entry('Zeta')] }).expect(200);
    await importRows([importRow(2, 'Omega', '18:00')]).expect(200);
    await until(async () => (await alice.row()).interests_json[entry('Omega')]?.state === 'converted', 'Omega to convert');

    const counts = (
      await server.request.get('/api/v1/admin/festivals/fest-1/lineup-interest').set('x-user-token', admin).expect(200)
    ).body.data.counts;
    assert.deepEqual(counts[entry('Zeta')], { open: 2, converted: 0 });
    assert.deepEqual(counts[entry('Omega')], { open: 0, converted: 1 });

    await server.request.get('/api/v1/admin/festivals/fest-1/lineup-interest').set('x-user-token', alice.account.token).expect(403);
    await server.request.get('/api/v1/admin/festivals/nope/lineup-interest').set('x-user-token', admin).expect(404);
  });
});
