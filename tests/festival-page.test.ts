import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import sharp from 'sharp';

import createPageRoutes from '../routes/pages';
import { buildFestivalPageDays, festivalTimeZoneLine } from '../lib/festival-page';
import { buildFestivalOgSvg } from '../lib/helpers/share-og-image';

// Public festival page /f/:slug and its preview image (T50). No DB: the routes are
// built with mock deps, as in tests/pages.test.ts.

function createMockRouter() {
  const routes: any[] = [];
  const handler = (method: string) => (pathPattern: string, ...handlers: any[]) => {
    routes.push({ method, path: pathPattern, handlers });
  };
  return { get: handler('GET'), post: handler('POST'), use: handler('USE'), _routes: routes };
}

function mockRes() {
  const res: any = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _sent: null as any,
    _ended: false,
    headersSent: false,
    status(code: number) { res._status = code; return res; },
    setHeader(k: string, v: string) { res._headers[k] = v; return res; },
    send(body: any) { res._sent = body; res.headersSent = true; return res; },
    end() { res._ended = true; res.headersSent = true; return res; },
  };
  return res;
}

const FESTIVAL = {
  id: 'fest 1/x',
  name: 'EDC Orlando',
  location: 'Tinker Field',
  timeZone: 'America/New_York',
  latitude: 28.5,
  longitude: -81.4,
  b2bSeparator: 'x',
  stages: [
    { id: 'main', name: 'Kinetic Field', color: '#ff3366' },
    { id: 'side', name: 'Neon Garden', color: 'red;background:url(x)' },
  ],
  days: [
    {
      label: 'Friday',
      date: '2026-11-06',
      sets: [
        { id: 's1', artist: 'Late Act', stageId: 'main', startTime: '01:00', endTime: '02:00' },
        { id: 's2', artist: 'TBA Act', stageId: 'side', startTime: null, endTime: null },
        { id: 's3', artist: 'Prime Act', stageId: 'main', startTime: '23:00', endTime: '00:30' },
        { id: 's4', artist: '', artists: [{ name: 'Alpha' }, { name: 'Beta' }], stageId: 'side', startTime: '20:00' },
      ],
    },
    { label: '', date: '2026-11-07', sets: [] },
  ],
};

function buildDeps(opts: { festival?: any; publicId?: string | null; throws?: boolean } = {}) {
  const findPublicIdBySlug = mock.fn(async (_slug: string) => {
    if (opts.throws) throw new Error('db down');
    return opts.publicId === undefined ? 'fest 1/x' : opts.publicId;
  });
  const getFestivalById = mock.fn(async () => (opts.festival === undefined ? FESTIVAL : opts.festival));
  const log = { info: mock.fn(), warn: mock.fn(), error: mock.fn(), debug: mock.fn() };
  return {
    deps: {
      express: { Router: () => createMockRouter() },
      config: { PUBLIC_ORIGIN: 'https://festie.us', PUBLIC_DIR: 'C:\\fake\\public' },
      rateLimit: () => (_req: any, _res: any, next: any) => next(),
      pool: { query: async () => ({ rows: [] }) },
      log,
      // Only the festivals store: the page must not read users, picks or crews.
      stores: { festivals: { findPublicIdBySlug } },
      getFestivalById,
    },
    findPublicIdBySlug,
    getFestivalById,
    log,
  };
}

function handlerFor(deps: any, path: string) {
  const route = createPageRoutes(deps)._routes.find((r: any) => r.path === path);
  if (!route) throw new Error(`Route not found: ${path}`);
  return route.handlers[route.handlers.length - 1];
}

async function getPage(deps: any, slug: string) {
  const res = mockRes();
  await handlerFor(deps, '/f/:slug')({ params: { slug }, protocol: 'https', get: () => 'festie.us' }, res);
  return res;
}

async function getOg(deps: any, slug: string) {
  const res = mockRes();
  await handlerFor(deps, '/f/:slug/og.png')({ params: { slug } }, res);
  return res;
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

describe('festival page: routes', () => {
  it('registers /f/:slug and the og image before the SPA catch-all, with their rate limits', () => {
    const calls: any[] = [];
    const { deps } = buildDeps();
    (deps as any).rateLimit = (max: number, key: string) => {
      calls.push({ max, key });
      return (_req: any, _res: any, next: any) => next();
    };
    const paths = createPageRoutes(deps)._routes.map((r: any) => r.path);
    assert.ok(paths.indexOf('/f/:slug') > paths.indexOf('/join/:code'));
    assert.ok(paths.indexOf('/f/:slug') < paths.indexOf('/{*splat}'));
    assert.ok(paths.indexOf('/f/:slug/og.png') < paths.indexOf('/{*splat}'));
    assert.ok(!paths.includes('/sitemap.xml'), 'no festival sitemap until indexing is cleared');
    assert.deepEqual(calls.find((c) => c.key === 'festival-page'), { max: 60, key: 'festival-page' });
    assert.deepEqual(calls.find((c) => c.key === 'festival-og'), { max: 30, key: 'festival-og' });
  });
});

describe('festival page: GET /f/:slug', () => {
  it('renders the page with preview tags, canonical link, JSON-LD and the CTA', async () => {
    const { deps, findPublicIdBySlug } = buildDeps();
    const res = await getPage(deps, 'edc-orlando-2026');
    const html: string = res._sent;
    assert.equal(res._status, 200);
    assert.equal(findPublicIdBySlug.mock.calls[0]!.arguments[0], 'edc-orlando-2026');
    assert.equal(res._headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(res._headers['Cache-Control'], 'public, max-age=300');
    assert.equal(res._headers['Content-Security-Policy'], CSP);
    assert.equal(res._headers['X-Robots-Tag'], 'noindex');
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
    assert.ok(html.includes('<title>EDC Orlando lineup and set times · Festie</title>'));
    assert.ok(html.includes('og:title" content="EDC Orlando lineup and set times"'));
    assert.ok(html.includes('og:image" content="https://festie.us/f/edc-orlando-2026/og.png"'));
    assert.ok(html.includes('og:image:alt" content="EDC Orlando on Festie"'));
    assert.ok(html.includes('<link rel="canonical" href="https://festie.us/f/edc-orlando-2026">'));
    assert.ok(html.includes('application/ld+json'));
    assert.ok(
      html.includes(
        'content="Lineup and set times for EDC Orlando · Nov 6 – Nov 7, 2026 · Tinker Field. Plan your days with Festie."',
      ),
    );
    assert.ok(html.includes('href="https://festie.us/?festival=fest%201%2Fx&amp;ref=festival-page"'));
    assert.ok(html.includes('Plan your days in Festie'));
    assert.ok(html.includes('Times are local to the festival (EST).'));
    assert.ok(html.includes('<h2>Stages</h2>'));
    assert.ok(html.includes('Unofficial guide. Festie is a planning app.'));
    assert.ok(html.includes('<h2>Day 2 <span class="fp-date">Sat, Nov 7</span></h2>'));
    assert.ok(html.includes('Set times to come.'));
    assert.ok(!html.includes('<script>') && !html.includes('<img'), 'no scripts or images');
  });

  it('sorts sets in festival time: 11:00 PM before 1:00 AM, TBA last', async () => {
    const { deps } = buildDeps();
    const html: string = (await getPage(deps, 'edc-orlando-2026'))._sent;
    const order = ['Alpha x Beta', 'Prime Act', 'Late Act', 'TBA Act'].map((name) => html.indexOf(name));
    assert.ok(order.every((i) => i > 0), 'every set is shown');
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(html.indexOf('11:00 PM') < html.indexOf('1:00 AM'));
  });

  it('gives drafts, archived and unknown slugs one identical 404', async () => {
    const unknown = await getPage(buildDeps({ publicId: null }).deps, 'no-such-festival');
    const vanished = await getPage(buildDeps({ festival: null }).deps, 'edc-orlando-2026');
    for (const res of [unknown, vanished]) {
      assert.equal(res._status, 404);
      assert.equal(res._headers['Cache-Control'], 'public, max-age=60');
      assert.equal(res._headers['X-Robots-Tag'], 'noindex');
      assert.equal(res._headers['Content-Security-Policy'], CSP);
      assert.ok(res._sent.includes('<h1>Festival not found</h1>'));
      assert.ok(res._sent.includes('href="https://festie.us/"'));
    }
    assert.equal(unknown._sent, vanished._sent);
    assert.deepEqual(unknown._headers, vanished._headers);
  });

  it('answers a malformed slug with the 404 and no store call', async () => {
    for (const slug of ['BAD_SLUG!', 'Edc-Orlando-2026', 'a'.repeat(81), '-lead', 'double--dash']) {
      const { deps, findPublicIdBySlug } = buildDeps();
      const res = await getPage(deps, slug);
      assert.equal(res._status, 404, slug);
      assert.equal(findPublicIdBySlug.mock.callCount(), 0, slug);
    }
    const { deps, findPublicIdBySlug } = buildDeps();
    await getPage(deps, 'a'.repeat(80));
    assert.equal(findPublicIdBySlug.mock.callCount(), 1);
  });

  it('sends the not-found body with 500 and no-store when the store throws', async () => {
    const { deps, log } = buildDeps({ throws: true });
    const res = await getPage(deps, 'edc-orlando-2026');
    assert.equal(res._status, 500);
    assert.equal(res._headers['Cache-Control'], 'no-store');
    assert.equal(res._headers['X-Robots-Tag'], 'noindex');
    assert.ok(res._sent.includes('Festival not found'));
    assert.equal(log.error.mock.calls[0]!.arguments[0], 'festival page failed');
    assert.deepEqual(log.error.mock.calls[0]!.arguments[1], { error: 'db down', slug: 'edc-orlando-2026' });
  });

  it('renders a hostile name as text and keeps it inside the JSON-LD', async () => {
    const festival = { ...FESTIVAL, name: '</script><b>x', location: '"><i>y' };
    const html: string = (await getPage(buildDeps({ festival }).deps, 'x-2026'))._sent;
    assert.ok(!html.includes('<b>x') && !html.includes('<i>y'));
    assert.ok(html.includes('<h1>&lt;/script&gt;&lt;b&gt;x</h1>'));
    assert.ok(html.includes('\\u003c/script\\u003e\\u003cb\\u003ex'));
    assert.equal(html.split('</script>').length, 2, 'only the JSON-LD block closes a script');
    assert.ok(!html.includes('red;background'), 'a bad stage colour falls back');
  });

  it('adds geo to the JSON-LD only for numeric coordinates', async () => {
    const withGeo: string = (await getPage(buildDeps().deps, 'a'))._sent;
    assert.ok(withGeo.includes('"geo":{"@type":"GeoCoordinates","latitude":28.5,"longitude":-81.4}'));
    const festival = { ...FESTIVAL, latitude: '28.5', longitude: null };
    const noGeo: string = (await getPage(buildDeps({ festival }).deps, 'a'))._sent;
    assert.ok(noGeo.includes('"@type":"Place"'));
    assert.ok(!noGeo.includes('"geo"'));
  });

  it('shows empty states: no days, no stages, no dates', async () => {
    const festival = { id: 'f2', name: 'Soon Fest', location: '', stages: [], days: [] };
    const html: string = (await getPage(buildDeps({ festival }).deps, 'soon-fest'))._sent;
    assert.ok(html.includes("The lineup isn't out yet."));
    assert.ok(!html.includes('<h2>Stages</h2>'));
    assert.ok(!html.includes('class="fp-line"'));
    assert.ok(html.includes('Times are local to the festival.'));
    assert.ok(!html.includes('"startDate"'));
    assert.ok(html.includes('content="Lineup and set times for Soon Fest. Plan your days with Festie."'));
  });
});

describe('festival page: helpers', () => {
  it('festivalTimeZoneLine names the zone only when Intl accepts it', () => {
    const day = [{ date: '2026-07-18' }];
    assert.equal(festivalTimeZoneLine({ timeZone: 'America/New_York', days: day }), 'Times are local to the festival (EDT).');
    assert.equal(festivalTimeZoneLine({ days: day }), 'Times are local to the festival.');
    assert.equal(festivalTimeZoneLine({ timeZone: 'Not/AZone', days: day }), 'Times are local to the festival.');
    assert.match(festivalTimeZoneLine({ timeZone: 'Europe/Berlin', days: [] }), /^Times are local to the festival \(.+\)\.$/);
  });

  it('buildFestivalPageDays escapes text and falls back to Artist TBA', () => {
    const [day] = buildFestivalPageDays({
      stages: [{ id: 'm', name: '<Main>', color: '#abc' }],
      days: [{ date: 'TBA', sets: [{ artist: '', stageId: 'm', startTime: '25:00' }, { artist: 'A&B', stageId: 'zz' }] }],
    });
    assert.equal(day.label, 'Day 1');
    assert.equal(day.date, '');
    assert.deepEqual(day.sets, [
      { timeText: 'Time TBA', artist: 'Artist TBA', stage: '&lt;Main&gt;', stageColor: '#abc' },
      { timeText: 'Time TBA', artist: 'A&amp;B', stage: 'TBD', stageColor: '#666' },
    ]);
  });
});

describe('festival page: GET /f/:slug/og.png', () => {
  it('renders a 1200 x 630 PNG with long cache headers', async () => {
    const res = await getOg(buildDeps().deps, 'edc-orlando-2026');
    assert.equal(res._status, 200);
    assert.equal(res._headers['Content-Type'], 'image/png');
    assert.equal(res._headers['Cache-Control'], 'public, max-age=3600');
    const meta = await sharp(res._sent).metadata();
    assert.equal(meta.format, 'png');
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 630);
  });

  it('answers an empty 404 for an unknown or malformed slug', async () => {
    const unknown = await getOg(buildDeps({ publicId: null }).deps, 'nope');
    assert.equal(unknown._status, 404);
    assert.equal(unknown._sent, null);
    const { deps, findPublicIdBySlug } = buildDeps();
    const bad = await getOg(deps, 'BAD_SLUG!');
    assert.equal(bad._status, 404);
    assert.equal(findPublicIdBySlug.mock.callCount(), 0);
  });

  it('answers an empty 500 with no-store when loading fails', async () => {
    const { deps, log } = buildDeps({ throws: true });
    const res = await getOg(deps, 'edc-orlando-2026');
    assert.equal(res._status, 500);
    assert.equal(res._headers['Cache-Control'], 'no-store');
    assert.equal(res._sent, null);
    assert.equal(log.error.mock.calls[0]!.arguments[0], 'festival og render failed');
  });

  it('buildFestivalOgSvg counts in the singular, drops an empty date line and escapes text', () => {
    const svg = buildFestivalOgSvg({ festivalName: '<x>', dateRange: null, location: '', setCount: 1, stageCount: 1 });
    assert.ok(svg.includes('>1 set · 1 stage<'));
    assert.ok(svg.includes('&lt;x&gt;'));
    assert.equal((svg.match(/<text /g) || []).length, 3);
    const full = buildFestivalOgSvg({
      festivalName: 'N'.repeat(40),
      dateRange: 'Nov 6 – Nov 8, 2026',
      location: 'Tinker Field',
      setCount: 12,
      stageCount: 3,
    });
    assert.ok(full.includes(`>${'N'.repeat(32)}…<`));
    assert.ok(full.includes('>Nov 6 – Nov 8, 2026<'));
    assert.ok(full.includes('>12 sets · 3 stages<'));
    assert.ok(full.includes('text-anchor="end"'));
  });
});
