import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Pool } from 'pg';
import { createStores } from '../lib/db/index.js';

// Public festival page /f/:slug against a real server and DB: the route, the
// store filter and express.static order together. Skip-gated like
// integration-festival-slug; the helpers are imported lazily because
// _integration-helpers exits the process without a test DB. Run it only against
// a private test database on port 5434+.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

describe('Integration — public festival page', { skip, concurrency: 1 }, () => {
  let helpers: any;
  let server: any;
  let pool: Pool;

  before(async () => {
    helpers = await import('./_integration-helpers');
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    server = await helpers.startServer();
  });

  after(async () => {
    if (server) await server.close();
    await pool.end();
  });

  const fest = (id: string, name: string, extra: any = {}) => ({
    id,
    name,
    location: 'Field',
    timeZone: 'America/New_York',
    stages: [{ id: `${id}-main`, name: 'Main', color: '#ff3366' }],
    days: [
      {
        label: 'Friday',
        date: '2026-06-05',
        sets: [{ id: `${id}-s1`, artist: 'Alpha', stageId: `${id}-main`, startTime: '20:00', endTime: '21:00' }],
      },
    ],
    ...extra,
  });

  test('a published festival has a page; drafts and archived ones get the same 404', async () => {
    const festivals = createStores(pool).festivals;
    const open = await festivals.create(fest('fp-open', 'Open Page Fest'));
    const archived = await festivals.create(fest('fp-gone', 'Gone Page Fest'));
    await festivals.create(fest('fp-draft', 'Draft Page Fest', { publishedAt: null }));
    // Drafts never get a slug on their own; force one to prove the filter.
    await pool.query("UPDATE festivals SET slug = 'draft-page-fest-2026' WHERE id = 'fp-draft'");
    await festivals.softDelete('fp-gone');

    const page = await server.request.get(`/f/${open.slug}`).expect(200);
    assert.match(page.headers['content-type'], /^text\/html/);
    assert.equal(page.headers['cache-control'], 'public, max-age=300');
    assert.equal(page.headers['x-robots-tag'], 'noindex');
    assert.ok(page.text.includes('<h1>Open Page Fest</h1>'));
    assert.ok(page.text.includes('Alpha'));

    const draft = await server.request.get('/f/draft-page-fest-2026').expect(404);
    const gone = await server.request.get(`/f/${archived.slug}`).expect(404);
    const unknown = await server.request.get('/f/no-such-festival').expect(404);
    // Each request gets its own ephemeral port, so compare bodies with the origin removed.
    const noOrigin = (html: string) => html.replace(/http:\/\/127\.0\.0\.1:\d+/g, 'ORIGIN');
    assert.equal(noOrigin(draft.text), noOrigin(unknown.text));
    assert.equal(noOrigin(gone.text), noOrigin(unknown.text));
    assert.equal(unknown.headers['x-robots-tag'], 'noindex');

    const og = await server.request.get(`/f/${open.slug}/og.png`).expect(200);
    assert.equal(og.headers['content-type'], 'image/png');
  });

  test('the static sitemap lists no festival pages', async () => {
    const sitemap = await server.request.get('/sitemap.xml').expect(200);
    assert.ok(!sitemap.text.includes('/f/'));
  });
});
