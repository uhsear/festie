import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createStores } from '../lib/db/index.js';
import createFestivalsStore from '../lib/db/stores/festivals.js';

// Festival slugs (migration 094): the slug rule, publish/create lifecycle and the
// public lookups. The real-DB part is skip-gated like integration-festival-follows;
// the helpers are imported lazily because _integration-helpers exits the process
// without a test DB. Run it only against a private test database on port 5434+.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(__dirname, '..', 'migrations', '094_festival_slug.sql');

describe('festivals.publish slug race (mocked pool)', () => {
  const raced = () => Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
  const row = { publishedAt: '2026-11-02T00:00:00.000Z', slug: 'x-2026-2' };

  test('retries once on 23505 and returns the second result', async () => {
    let calls = 0;
    const query = mock.fn(async () => {
      calls++;
      if (calls === 1) throw raced();
      return { rows: [row] };
    });
    const store = createFestivalsStore({ query } as any, {});
    assert.deepEqual(await store.publish('f-1', 'admin-1'), row);
    assert.equal(query.mock.calls.length, 2);
  });

  test('rethrows a second 23505', async () => {
    const query = mock.fn(async () => {
      throw raced();
    });
    const store = createFestivalsStore({ query } as any, {});
    await assert.rejects(store.publish('f-1', 'admin-1'), { code: '23505' });
    assert.equal(query.mock.calls.length, 2);
  });

  test('does not retry other errors', async () => {
    const query = mock.fn(async () => {
      throw Object.assign(new Error('boom'), { code: '57014' });
    });
    const store = createFestivalsStore({ query } as any, {});
    await assert.rejects(store.publish('f-1', 'admin-1'), { code: '57014' });
    assert.equal(query.mock.calls.length, 1);
  });
});

describe('Integration — festival slugs', { skip, concurrency: 1 }, () => {
  let helpers: any;
  let server: any;
  let pool: Pool;
  let festivals: any;

  before(async () => {
    helpers = await import('./_integration-helpers');
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    festivals = createStores(pool).festivals;
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

  const slugOf = async (id: string) =>
    (await pool.query('SELECT slug FROM festivals WHERE id = $1', [id])).rows[0]?.slug ?? null;

  const fest = (id: string, name: string, date: string | null, extra: any = {}) => ({
    id,
    name,
    location: 'Field',
    stages: [],
    days: date === null ? [] : [{ label: 'Friday', date, sets: [] }],
    ...extra,
  });

  test('094 applies twice and backfills published festivals, archived included, not drafts', async () => {
    await freshServer();
    await pool.query("INSERT INTO festivals (id, name, published_at) VALUES ('bf-draft', 'Draft Fest', NULL)");
    await pool.query("INSERT INTO festivals (id, name, deleted_at) VALUES ('bf-archived', 'Gone Fest', NOW())");
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    await pool.query(sql);
    await pool.query(sql);
    assert.equal(await slugOf('fest-1'), 'test-fest-2026');
    assert.equal(await slugOf('bf-archived'), 'gone-fest');
    assert.equal(await slugOf('bf-draft'), null);
  });

  test('festival_slug_base follows the rule', async () => {
    await freshServer();
    const cases: Array<[string, string | null, string]> = [
      ['EDC Orlando', '2026-07-18', 'edc-orlando-2026'],
      ['Café Fest 2026', '2026-05-01', 'cafe-fest-2026'],
      ['Crème Brûlée', '2027-03-02', 'creme-brulee-2027'],
      ['フジロック', '2026-07-24', 'festival-2026'],
      ['EDC Orlando 2026', '2026-11-01', 'edc-orlando-2026'],
      ['  --Big   Beat!!  ', null, 'big-beat'],
      ['No Dates Fest', 'TBA', 'no-dates-fest'],
    ];
    for (const [name, date, expected] of cases) {
      const { rows } = await pool.query('SELECT festival_slug_base($1, $2) AS slug', [name, date]);
      assert.equal(rows[0].slug, expected, `${name} / ${date}`);
    }
    const long = (await pool.query('SELECT festival_slug_base($1, NULL) AS slug', ['a'.repeat(59) + ' b'])).rows[0]
      .slug;
    assert.equal(long, 'a'.repeat(59));
  });

  test('create publishes with a slug, collisions get a suffix, drafts get none', async () => {
    await freshServer();
    const a = await festivals.create(fest('slug-a', 'Same Fest', '2026-06-05'));
    const b = await festivals.create(fest('slug-b', 'Same Fest', '2026-08-01'));
    const draft = await festivals.create(fest('slug-c', 'Same Fest', '2026-06-05', { publishedAt: null }));
    const undated = await festivals.create(fest('slug-u', 'Undated Fest', null));
    assert.equal(a.slug, 'same-fest-2026');
    assert.equal(b.slug, 'same-fest-2026-2');
    assert.equal(draft.slug, null);
    assert.equal(undated.slug, 'undated-fest');
  });

  test('publish sets the slug once; rename, republish, archive and restore keep it', async () => {
    await freshServer();
    await festivals.create(fest('slug-p', 'Publish Me', '2026-06-05', { publishedAt: null }));
    assert.equal(await slugOf('slug-p'), null);

    const first = await festivals.publish('slug-p', null);
    assert.equal(first.slug, 'publish-me-2026');
    assert.ok(first.publishedAt);

    await festivals.update('slug-p', { name: 'Renamed Fest' });
    const second = await festivals.publish('slug-p', null);
    assert.equal(second.slug, 'publish-me-2026');

    await festivals.softDelete('slug-p');
    assert.equal(await festivals.publish('slug-p', null), null);
    await festivals.restore('slug-p', null);
    assert.equal(await slugOf('slug-p'), 'publish-me-2026');
  });

  test('findPublicIdBySlug and listPublicSlugs skip drafts, archived and unknown slugs', async () => {
    await freshServer();
    await festivals.create(fest('pub-1', 'Open Fest', '2026-06-05'));
    await festivals.create(fest('arch-1', 'Closed Fest', '2026-06-05'));
    await festivals.create(fest('draft-1', 'Hidden Fest', '2026-06-05', { publishedAt: null }));
    // Drafts never get a slug on their own; force one to prove the filter.
    await pool.query("UPDATE festivals SET slug = 'hidden-fest-2026' WHERE id = 'draft-1'");
    await festivals.softDelete('arch-1');

    assert.equal(await festivals.findPublicIdBySlug('open-fest-2026'), 'pub-1');
    assert.equal(await festivals.findPublicIdBySlug('closed-fest-2026'), null);
    assert.equal(await festivals.findPublicIdBySlug('hidden-fest-2026'), null);
    assert.equal(await festivals.findPublicIdBySlug('no-such-festival'), null);

    const rows = await festivals.listPublicSlugs();
    assert.deepEqual(
      rows.map((r: any) => r.slug),
      ['open-fest-2026'],
    );
    assert.match(rows[0].updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('GET /api/v1/festivals and ?depth=1 carry the slug after an admin publish', async () => {
    await freshServer();
    const token = await helpers.loginAdmin(server);
    const admin = (req: any) => req.set('x-user-token', token).set(helpers.TRUSTED_MUTATION_HEADER, '1');
    await admin(server.request.post('/api/v1/admin/festivals'))
      .send({
        id: 'fest-route',
        name: 'Slug Route Fest',
        location: 'Field',
        timeZone: 'America/New_York',
        stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
        days: [
          {
            label: 'Friday',
            date: '2026-06-05',
            sets: [{ id: 'fest-route-s1', artist: 'Alpha', stageId: 'main', startTime: '20:00', endTime: '21:00' }],
          },
        ],
      })
      .expect(201);
    assert.equal(await slugOf('fest-route'), null);

    const published = await admin(server.request.post('/api/v1/admin/festivals/fest-route/publish')).expect(200);
    assert.deepEqual(Object.keys(published.body.data).sort(), ['checklist', 'publishedAt']);

    const list = await server.request.get('/api/v1/festivals').expect(200);
    const item = list.body.data.find((f: any) => f.id === 'fest-route');
    assert.equal(item.slug, 'slug-route-fest-2026');
    assert.equal(list.body.data.find((f: any) => f.id === 'fest-1').slug, null);

    const depth1 = await server.request.get('/api/v1/festivals/fest-route?depth=1').expect(200);
    assert.equal(depth1.body.data.slug, 'slug-route-fest-2026');
  });
});
