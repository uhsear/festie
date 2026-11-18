// The follow loop against a real database: the lineup audience split, the "Announce days" dry run and
// its refusals, and the picker's schedule badge. The push and email logic has unit tests in
// reengagement.test.ts; these check the SQL and the routes together.
import { afterEach, describe, test } from 'node:test';
import { assert, startServer, loginAdmin, registerUser, joinFestivalProfile, Pool } from './_integration-helpers';

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

const message = (res: any) => res.body.error?.message ?? res.body.error;
const act = (name: string, dayDate: string | null = null) => ({ artists: [{ name, links: {} }], dayDate });

async function setup() {
  const server = await startServer();
  servers.push(server);
  const token = await loginAdmin(server);
  const admin = (req: any) => req.set('x-user-token', token);
  const createFestival = async (body: Record<string, unknown>, publish = true) => {
    const created = await admin(server.request.post('/api/v1/admin/festivals'))
      .send({ location: 'Field', timeZone: 'America/New_York', ...body })
      .expect(201);
    const id = created.body.data.id;
    if (publish) await admin(server.request.post(`/api/v1/admin/festivals/${id}/publish`)).expect(200);
    return id as string;
  };
  const follow = (userToken: string, id: string) =>
    server.request.put(`/api/v1/festivals/${id}/follow`).set('x-user-token', userToken).expect(200);
  const sql = async (text: string, params: unknown[] = []) => {
    const pool = new Pool({ connectionString: server.databaseUrl, statement_timeout: 5000 });
    try {
      return (await pool.query(text, params)).rows;
    } finally {
      await pool.end();
    }
  };
  const days = [
    { label: 'Fri', date: '2027-02-05', sets: [] },
    { label: 'Sat', date: '2027-02-06', sets: [] },
  ];
  return { server, admin, createFestival, follow, sql, days };
}

describe('Integration: follow loop', { concurrency: 1 }, () => {
  test('the lineup dry run splits followers from past-edition users and names the matched editions', async () => {
    const { server, admin, createFestival, follow, days } = await setup();
    const past = await createFestival({ id: 'nc-2025', name: 'North Coast 2025', days, lineup: [act('Kai')] });
    const current = await createFestival({ id: 'nc-2026', name: 'North Coast 2026', days, lineup: [act('Kai')] });
    const [a, b, c, d] = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((name) => registerUser(server, name)));
    await joinFestivalProfile(server, a.token, past); // went before, does not follow
    await joinFestivalProfile(server, c.token, past); // went before and follows
    await follow(b.token, current); // follows only
    await follow(c.token, current);
    await joinFestivalProfile(server, d.token, current); // already joined: neither audience
    await follow(d.token, current);

    const res = await admin(server.request.get(`/api/v1/admin/festivals/${current}/lineup-announcement`)).expect(200);
    assert.equal(res.body.data.followers, 2, 'bob and cat follow and have not joined');
    assert.equal(res.body.data.priorAttendees, 1, 'ann went before and does not follow');
    assert.equal(res.body.data.recipients, 3);
    assert.deepEqual(res.body.data.matchedFestivalNames, ['North Coast 2025']);
    assert.equal(res.body.data.emailOff, 'no_postal_address');
    assert.equal(res.body.data.emailRecipients, 0);
  });

  test('"Announce days": a save sends nothing, the dry run counts the split, and it refuses until days exist', async () => {
    const { server, admin, createFestival, follow, sql, days } = await setup();
    const id = await createFestival({ id: 'wl-2027', name: 'Wasteland 2027', days, lineup: [act('A'), act('B'), act('C')] });
    const [bob, cat, dan] = await Promise.all(['bob', 'cat', 'dan'].map((name) => registerUser(server, name)));
    await follow(bob.token, id);
    await follow(cat.token, id);
    await joinFestivalProfile(server, dan.token, id);
    await follow(dan.token, id); // follows and joined: one person
    const url = `/api/v1/admin/festivals/${id}/days-announcement`;

    const none = await admin(server.request.get(url)).expect(200);
    assert.equal(none.body.data.reason, 'no_days');
    const refused = await admin(server.request.post(url)).expect(400);
    assert.equal(message(refused), 'Give acts a day before you announce days.');

    // Giving act 1 of 3 a day, by save, sends nothing.
    const festival = (await admin(server.request.get(`/api/v1/admin/festivals/${id}`)).expect(200)).body.data;
    const lineup = festival.lineup.map((entry: any, i: number) => ({ ...entry, dayDate: i === 0 ? '2027-02-05' : null }));
    await admin(server.request.put(`/api/v1/admin/festivals/${id}`)).send({ lineup, expectedUpdatedAt: festival.updatedAt }).expect(200);
    assert.deepEqual(await sql("SELECT id FROM notification_log WHERE type = 'days_out'"), []);

    const partial = (await admin(server.request.get(url)).expect(200)).body.data;
    assert.equal(partial.actsWithDay, 1);
    assert.equal(partial.actsTotal, 3);
    assert.equal(partial.recipients, 3, 'bob, cat and dan, once each');
    assert.equal(partial.reason, undefined);
    assert.deepEqual(await sql("SELECT id FROM notification_log WHERE type = 'days_out'"), []);

    // With every act on a day, the button sends and writes one audit row.
    const saved = (await admin(server.request.get(`/api/v1/admin/festivals/${id}`)).expect(200)).body.data;
    const full = saved.lineup.map((entry: any) => ({ ...entry, dayDate: '2027-02-06' }));
    await admin(server.request.put(`/api/v1/admin/festivals/${id}`)).send({ lineup: full, expectedUpdatedAt: saved.updatedAt }).expect(200);
    const sent = await admin(server.request.post(url)).expect(200);
    assert.equal(sent.body.data.queued, true);
    assert.equal(sent.body.data.recipients, 3);
    const audit = await sql("SELECT details_json FROM audit_log WHERE action = 'festival.days.announced'");
    assert.equal(audit.length, 1);
  });

  test('"Announce days" refuses a draft and a festival whose set times are out, and leaves the picker badge honest', async () => {
    const { server, admin, createFestival, sql, days } = await setup();
    const withDays = [act('A', '2027-02-05')];
    const draft = await createFestival({ id: 'draft-fest', name: 'Draft Fest', days, lineup: withDays }, false);
    const out = await createFestival({ id: 'out-fest', name: 'Out Fest', days, lineup: withDays });
    const open = await createFestival({ id: 'open-fest', name: 'Open Fest', days, lineup: [act('A')] });
    await sql('UPDATE festivals SET set_times_out_at = NOW() WHERE id = $1', [out]);

    const draftRes = await admin(server.request.post(`/api/v1/admin/festivals/${draft}/days-announcement`)).expect(409);
    assert.equal(message(draftRes), 'Publish the festival before you announce its days.');
    const outRes = await admin(server.request.post(`/api/v1/admin/festivals/${out}/days-announcement`)).expect(409);
    assert.equal(message(outRes), 'Set times are already out. The set-times alert covered this.');
    await admin(server.request.get('/api/v1/admin/festivals/nope/days-announcement')).expect(404);

    // The picker badge: an act with a day reads "days", an act with no day reads "lineup".
    const list = (await server.request.get('/api/v1/festivals').expect(200)).body.data;
    const progress = (id: string) => list.find((festival: any) => festival.id === id)?.scheduleProgress;
    assert.equal(progress(out), 'days');
    assert.equal(progress(open), 'lineup');
    assert.equal(progress('fest-1'), 'times', 'the seeded festival has timed sets');
    assert.equal(progress(draft), undefined, 'a draft is not on the public list');
  });
});
