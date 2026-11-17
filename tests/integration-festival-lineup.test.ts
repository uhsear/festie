// The announced lineup against a real database: the column round-trips, a save without it keeps it,
// a re-paste keeps every id, and the day split follows its date when days are deleted or reordered.
import { afterEach, describe, test } from 'node:test';
import { assert, startServer, loginAdmin } from './_integration-helpers';

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

const act = (name: string, extra: Record<string, unknown> = {}) => ({ artists: [{ name, links: {} }], ...extra });

async function setup() {
  const server = await startServer();
  servers.push(server);
  const token = await loginAdmin(server);
  const get = async (suffix = '') =>
    (await server.request.get(`/api/v1/admin/festivals/fest-1${suffix}`).set('x-user-token', token).expect(200)).body.data;
  const put = (body: Record<string, unknown>) =>
    server.request.put('/api/v1/admin/festivals/fest-1').set('x-user-token', token).send(body);
  return { server, token, get, put };
}

describe('Integration: announced lineup', { concurrency: 1 }, () => {
  test('an existing festival reads an empty lineup, and a lineup save round-trips', async () => {
    const { get, put } = await setup();
    const before = await get();
    assert.deepEqual(before.lineup, []);

    const res = await put({
      expectedUpdatedAt: before.updatedAt,
      lineup: [act('INFEKT'), act('Kai', { tier: 1, displayName: 'Poster Kai' }), { artists: [{ name: 'A' }, { name: 'B' }] }],
    }).expect(200);
    assert.ok(res.body.data);

    const after = await get();
    assert.equal(after.lineup.length, 3);
    assert.ok(after.lineup.every((e: any) => /^lu-/.test(e.id) && e.status === 'announced'));
    assert.equal(after.lineup[1].tier, 1);
    assert.equal(after.lineup[1].displayName, 'Poster Kai');
    assert.equal(after.lineup[2].artists.length, 2);
  });

  test('depth=1 carries the lineup', async () => {
    const { server, token, get, put } = await setup();
    const loaded = await get();
    await put({ expectedUpdatedAt: loaded.updatedAt, lineup: [act('INFEKT')] }).expect(200);
    const res = await server.request.get('/api/v1/admin/festivals/fest-1?depth=1').set('x-user-token', token).expect(200);
    assert.equal(res.body.data.lineup.length, 1);
  });

  test('a PUT without lineup, even one that sends days, keeps the stored list', async () => {
    const { get, put } = await setup();
    const loaded = await get();
    await put({ expectedUpdatedAt: loaded.updatedAt, lineup: [act('INFEKT'), act('Kai')] }).expect(200);
    const saved = await get();

    // What a pre-A1 mobile build sends: details, stages and days, no lineup, no token.
    await put({ name: 'Renamed', stages: saved.stages, days: saved.days }).expect(200);
    const after = await get();
    assert.equal(after.name, 'Renamed');
    assert.deepEqual(after.lineup, saved.lineup);
  });

  test('a re-paste without ids keeps every id and announcedAt', async () => {
    const { get, put } = await setup();
    const loaded = await get();
    await put({ expectedUpdatedAt: loaded.updatedAt, lineup: [act('INFEKT'), act('Kai'), act('Mira')] }).expect(200);
    const first = await get();

    await put({
      expectedUpdatedAt: first.updatedAt,
      lineup: [act('mira'), act('KAI'), act('INFEKT'), act('Brand New')],
    }).expect(200);
    const second = await get();
    const idOf = (list: any[], name: string) => list.find((e) => e.artists[0].name.toLowerCase() === name.toLowerCase());
    for (const name of ['INFEKT', 'Kai', 'Mira']) {
      assert.equal(idOf(second.lineup, name).id, idOf(first.lineup, name).id, name);
      assert.equal(idOf(second.lineup, name).announcedAt, idOf(first.lineup, name).announcedAt, name);
    }
    assert.equal(second.lineup.length, 4);
  });

  test('deleting and reordering days keeps each entry on its date', async () => {
    const { get, put } = await setup();
    const loaded = await get();
    const [day1, day2] = loaded.days;
    assert.ok(day1.date && day2.date, 'seed festival has two dated days');
    await put({
      expectedUpdatedAt: loaded.updatedAt,
      lineup: [act('On Day 1', { dayDate: day1.date }), act('On Day 2', { dayDate: day2.date })],
    }).expect(200);
    const saved = await get();

    // Reorder: day 2 first. The entries keep their dates, so the date still names the right day.
    await put({ expectedUpdatedAt: saved.updatedAt, stages: saved.stages, days: [day2, day1] }).expect(200);
    const reordered = await get();
    assert.deepEqual(reordered.days.map((d: any) => d.date), [day2.date, day1.date]);
    assert.deepEqual(reordered.lineup.map((e: any) => e.dayDate), [day1.date, day2.date]);

    // Delete day 1: its entry keeps the stored date, which now matches no day.
    await put({ expectedUpdatedAt: reordered.updatedAt, stages: reordered.stages, days: [day2] }).expect(200);
    const trimmed = await get();
    assert.equal(trimmed.days.length, 1);
    assert.deepEqual(trimmed.lineup.map((e: any) => e.dayDate), [day1.date, day2.date]);
  });

  test('a stale token and a duplicate act are refused and change nothing', async () => {
    const { get, put } = await setup();
    const loaded = await get();
    await put({ expectedUpdatedAt: loaded.updatedAt, lineup: [act('INFEKT')] }).expect(200);

    const stale = await put({ expectedUpdatedAt: loaded.updatedAt, lineup: [act('Other')] }).expect(409);
    assert.equal(stale.body.error.code, 'FESTIVAL_CHANGED');

    const fresh = await get();
    await put({ expectedUpdatedAt: fresh.updatedAt, lineup: [act('Dup'), act('dup')] }).expect(400);
    assert.deepEqual((await get()).lineup.map((e: any) => e.artists[0].name), ['INFEKT']);
  });

  test('a new festival takes a lineup on create', async () => {
    const { server, token } = await setup();
    const res = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', token)
      .send({ name: 'Lineup Fest', location: 'Orlando', timeZone: 'America/New_York', lineup: [act('INFEKT'), act('Kai')] })
      .expect(201);
    const loaded = (await server.request.get(`/api/v1/admin/festivals/${res.body.data.id}`).set('x-user-token', token).expect(200)).body.data;
    assert.equal(loaded.lineup.length, 2);
    assert.match(loaded.lineup[0].announcedAt, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('a names-only festival publishes, shows on the list and /f/, and lineupCount drops as sets arrive', async () => {
    const { server, token } = await setup();
    const asAdmin = (req: any) => req.set('x-user-token', token);
    const created = await asAdmin(server.request.post('/api/v1/admin/festivals'))
      .send({
        id: 'fest-names',
        name: 'Names Fest',
        location: 'Field',
        timeZone: 'America/New_York',
        days: [{ label: 'Fri', date: '2026-06-05', sets: [] }],
        lineup: [act('INFEKT'), act('Kai'), act('Gone', { status: 'cancelled' })],
      })
      .expect(201);
    const id = created.body.data.id;

    const published = await asAdmin(server.request.post(`/api/v1/admin/festivals/${id}/publish`)).expect(200);
    const status = (key: string) => published.body.data.checklist.find((item: any) => item.key === key).status;
    assert.equal(status('stages'), 'warn');
    assert.equal(status('sets'), 'warn');

    const listed = async () =>
      (await server.request.get('/api/v1/festivals').expect(200)).body.data.find((festival: any) => festival.id === id);
    const before = await listed();
    assert.equal(before.lineupCount, 2, 'cancelled acts are not counted');

    const page = await server.request.get(`/f/${before.slug}`).expect(200);
    assert.ok(page.text.includes('INFEKT') && page.text.includes('Kai'));
    assert.ok(page.text.includes('<h2>Cancelled</h2>'));

    await asAdmin(server.request.put(`/api/v1/admin/festivals/${id}`))
      .send({
        stages: [{ id: 'main', name: 'Main' }],
        days: [
          {
            label: 'Fri',
            date: '2026-06-05',
            sets: [{ id: 'names-s1', artist: 'infekt', stageId: 'main', startTime: '20:00', endTime: '21:00' }],
          },
        ],
      })
      .expect(200);
    assert.equal((await listed()).lineupCount, 1);
  });
});
