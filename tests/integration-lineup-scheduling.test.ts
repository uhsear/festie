// Lineup scheduling tools against a real database: a new set takes the poster name of the act it
// covers, the import preview names acts that match no set, and cancelling a marked act removes its
// set and counts everyone who is told. The pure rules are in tests/lineup-import-plan.test.ts and
// tests/lineup-cancel.test.ts.
import { afterEach, describe, test } from 'node:test';
import { assert, Pool, startServer, loginAdmin, registerUser, joinFestivalProfile } from './_integration-helpers';

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

const act = (name: string, extra: Record<string, unknown> = {}) => ({ artists: [{ name, links: {} }], dayDate: '2026-06-05', ...extra });
const importRow = (row: number, artist: string, startTime: string) => ({
  row,
  artist,
  stage: 'Main Stage',
  day: 'Friday',
  date: '2026-06-05',
  startTime,
  endTime: `${Number(startTime.slice(0, 2)) + 1}:00`,
});

async function until<T>(check: () => Promise<T | false | undefined | null>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function setup(lineup: Record<string, unknown>[]) {
  const server = await startServer();
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
  await putFestival({ expectedUpdatedAt: (await festival()).updatedAt, lineup }).expect(200);
  const entries: any[] = (await festival()).lineup;
  const entry = (name: string) => entries.find((e) => e.artists[0].name === name).id as string;
  const importPath = (suffix: string) => `/api/v1/admin/festivals/fest-1/import-lineup${suffix}`;
  const preview = (rows: any[]) =>
    server.request.post(importPath('/preview')).set('x-user-token', admin).send({ rows, skipSpotify: true });
  const commit = (rows: any[]) =>
    server.request.post(importPath('')).set('x-user-token', admin).send({ rows, skipSpotify: true });
  async function user(name: string) {
    const account = await registerUser(server, name);
    const profile = await joinFestivalProfile(server, account.token);
    const put = (body: Record<string, unknown>) =>
      server.request.put(`/api/v1/profiles/${profile.id}`).set('x-user-token', account.token).send(body);
    const row = async () =>
      (await pool.query('SELECT interests_json FROM festival_profiles WHERE id = $1', [profile.id])).rows[0];
    return { put, row };
  }
  return { server, admin, pool, festival, putFestival, entry, preview, commit, user };
}

describe('Integration: lineup scheduling tools', { concurrency: 1 }, () => {
  test('a new set keeps the poster name, and the preview names an act that matches no set', async () => {
    const { entry, preview, commit, pool } = await setup([
      act('Zeta', { displayName: 'ZETA (live)' }),
      act('Omega', { displayName: 'OMEGA!' }),
      act('Kappa', { dayDate: '2026-06-06' }),
    ]);
    const rows = [importRow(2, 'Zeta', '16:00'), importRow(3, 'Omegaa', '18:00')];

    const plan = (await preview(rows).expect(200)).body.data;
    assert.equal(plan.rows[0].displayName, 'ZETA (live)');
    assert.equal(plan.rows[1].displayName, undefined);
    assert.deepEqual(plan.unmatchedActs, [{ entryId: entry('Omega'), name: 'OMEGA!', dayLabel: 'Friday' }]);

    await commit(rows).expect(200);
    const names = (await pool.query("SELECT artist, display_name FROM festival_sets WHERE festival_id = 'fest-1' AND artist IN ('Zeta', 'Omegaa') ORDER BY artist")).rows;
    assert.deepEqual(names, [
      { artist: 'Omegaa', display_name: null },
      { artist: 'Zeta', display_name: 'ZETA (live)' },
    ]);
  });

  test('cancelling a marked act with a picked set asks once, removes the set, and counts the marker and the picker', async () => {
    const { server, admin, festival, putFestival, entry, user } = await setup([act('Alpha'), act('Zeta')]);
    const alice = await user('alice');
    const bob = await user('bob');
    // Alpha already has a timetable set, so alice's mark converts to a pick. Zeta has none, so bob's stays open.
    await alice.put({ interestAdd: [entry('Alpha')] }).expect(200);
    await bob.put({ interestAdd: [entry('Zeta')] }).expect(200);
    await until(async () => (await alice.row()).interests_json[entry('Alpha')]?.state === 'converted', 'alice to convert');

    const current = await festival();
    const days = current.days.map((d: any) => ({ ...d, sets: d.sets.filter((s: any) => s.id !== 'set-a') }));
    const body = {
      expectedUpdatedAt: current.updatedAt,
      lineup: current.lineup.map((e: any) => ({ ...e, status: 'cancelled' })),
      days,
    };

    const asked = await putFestival(body).expect(409);
    assert.equal(asked.body.error.code, 'CONFIRM_REMOVALS');
    assert.deepEqual(asked.body.error.removal.cancel, { acts: ['Alpha', 'Zeta'], sets: 1, picked: 1, marked: 1 });

    // An old login must confirm the password before the removal goes through.
    const reauth = await putFestival({ ...body, confirmRemovals: true }).expect(403);
    assert.equal(reauth.body.error.code, 'REAUTH_REQUIRED');
    await server.request.post('/api/v1/auth/reauth').set('x-user-token', admin).send({ password: 'test-admin-password' }).expect(200);
    const saved = await putFestival({ ...body, confirmRemovals: true }).expect(200);
    assert.deepEqual(saved.body.data.scheduleNotice, { changes: 3, people: 2, notified: true, marked: 1 });
    const after = await festival();
    assert.equal(after.days.flatMap((d: any) => d.sets).some((s: any) => s.id === 'set-a'), false);
    assert.deepEqual(after.lineup.map((e: any) => e.status), ['cancelled', 'cancelled']);
  });

  test('a B2B act linked by hand to two solo sets converts a mark onto both', async () => {
    const { festival, putFestival, commit, pool, user } = await setup([
      { artists: [{ name: 'Alpha', links: {} }, { name: 'Zeta', links: {} }], dayDate: '2026-06-05' },
    ]);
    const bob = await user('bob');
    await commit([importRow(2, 'Zeta', '16:00')]).expect(200);
    const zetaSet = (await pool.query("SELECT id FROM festival_sets WHERE festival_id = 'fest-1' AND artist = 'Zeta'")).rows[0].id;
    const current = await festival();
    const [act] = current.lineup;
    await bob.put({ interestAdd: [act.id] }).expect(200);
    // The solo sets share no name-key set with the B2B act, so the mark stays open until a hand link.
    assert.equal((await bob.row()).interests_json[act.id].state, 'open');

    await putFestival({
      expectedUpdatedAt: current.updatedAt,
      lineup: current.lineup.map((e: any) => ({ ...e, linkedSetIds: ['set-a', zetaSet] })),
    }).expect(200);
    const row = await until(async () => {
      const r = await bob.row();
      return r.interests_json[act.id]?.state === 'converted' && r;
    }, 'the B2B mark to convert');
    assert.deepEqual([...row.interests_json[act.id].sets].sort(), ['set-a', zetaSet].sort());
  });
});
