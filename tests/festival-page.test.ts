import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import sharp from 'sharp';

import createPageRoutes from '../routes/pages';
import { buildFestivalPageDays, buildFestivalPageLineup, festivalTimeZoneLine, renderFestivalPage } from '../lib/festival-page';
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

async function getPage(deps: any, slug: string, query: Record<string, unknown> = {}) {
  const res = mockRes();
  await handlerFor(deps, '/f/:slug')({ params: { slug }, query, protocol: 'https', get: () => 'festie.us' }, res);
  return res;
}

async function getOg(deps: any, slug: string, handler = handlerFor(deps, '/f/:slug/og.png')) {
  const res = mockRes();
  await handler({ params: { slug } }, res);
  return res;
}

const CSP = "default-src 'none'; img-src 'self'; font-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'";

describe('festival page: routes', () => {
  it('registers /f/:slug and the og image before the SPA catch-all, with their rate limits', () => {
    const calls: any[] = [];
    const { deps } = buildDeps();
    (deps as any).rateLimit = (max: number, key: string) => {
      calls.push({ max, key });
      return (_req: any, _res: any, next: any) => next();
    };
    const paths = createPageRoutes(deps as any)._routes.map((r: any) => r.path);
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

  it('uses the brand shell: token CTA, inline mark, folded lineup, no legacy crimson or coral', async () => {
    const html = (await getPage(buildDeps().deps, 'edc-orlando-2026'))._sent as string;
    assert.ok(html.includes('class="ds-cta"') && html.includes('class="ds-lockup"'));
    assert.ok(html.includes('<details class="fp-full"><summary>Full lineup</summary>'));
    assert.ok(html.includes('rel="apple-touch-icon"'));
    assert.ok(!/d6154f|ff5c85|border-top: 4px/i.test(html), 'no legacy colours');
    assert.ok(!html.includes('fp-eyebrow'));
    const empty = (await getPage(buildDeps({ festival: { ...FESTIVAL, days: [] } }).deps, 'edc-orlando-2026'))._sent as string;
    assert.ok(!empty.includes('<details') && empty.includes("The lineup isn't out yet."));
  });

  it('passes an allow-listed ref through the CTA and falls back to festival-page for anything else', async () => {
    const cta = async (query: Record<string, unknown>) => {
      const html: string = (await getPage(buildDeps().deps, 'edc-orlando-2026', query))._sent;
      return /href="[^"]*\?festival=[^"]*&amp;ref=([^"]*)"/.exec(html)?.[1];
    };
    for (const ref of ['share-festival', 'share-wrap', 'share-picks', 'crew-invite']) assert.equal(await cta({ ref }), ref);
    for (const ref of ['evil', 'festival-page-follow', 'SHARE-FESTIVAL', '"><script>', ['share-wrap'], { a: 1 }, undefined]) {
      assert.equal(await cta({ ref }), 'festival-page', JSON.stringify(ref));
    }
  });

  it('links "Get alerts (free account)" to the app, carrying a share tag or festival-page-follow', async () => {
    const follow = async (query: Record<string, unknown>) => {
      const html: string = (await getPage(buildDeps().deps, 'edc-orlando-2026', query))._sent;
      const [, href, label] = /<a class="fp-link" href="([^"]*)">([^<]*)<\/a>/.exec(html) ?? [];
      return { href, label };
    };
    const tagged = await follow({ ref: 'share-festival' });
    assert.equal(tagged.label, 'Get alerts (free account)');
    assert.equal(tagged.href, 'https://festie.us/?festival=fest%201%2Fx&amp;ref=share-festival');
    for (const ref of ['evil', 'festival-page', '"><script>', undefined]) {
      assert.equal((await follow({ ref })).href, 'https://festie.us/?festival=fest%201%2Fx&amp;ref=festival-page-follow');
    }
  });

  it('keeps "You can start without an account." next to the planning button only', async () => {
    const html: string = (await getPage(buildDeps().deps, 'edc-orlando-2026'))._sent;
    assert.equal(html.split('You can start without an account.').length - 1, 1);
    assert.ok(!/Get alerts[^<]*without an account/.test(html));
  });

  it('shows the billed name on a set row, ahead of the joined artists', async () => {
    const festival = {
      ...FESTIVAL,
      days: [
        {
          label: 'Day 1',
          date: '2026-11-06',
          sets: [{ id: 'b', artist: 'Alpha b2b Beta', displayName: 'Alpha & Beta <live>', artists: [{ name: 'Alpha' }, { name: 'Beta' }], startTime: '20:00', endTime: '21:00', stageId: 'main' }],
        },
      ],
    };
    const html: string = (await getPage(buildDeps({ festival }).deps, 'edc-orlando-2026'))._sent;
    assert.ok(html.includes('Alpha &amp; Beta &lt;live&gt;'));
    assert.ok(!html.includes('Alpha b2b Beta'));
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
    assert.ok(html.includes('content="Lineup for Soon Fest. Plan your days with Festie."'));
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

  it('buildFestivalPageDays shows the flat artist when it differs from the joined artists, as the app does', () => {
    const [day] = buildFestivalPageDays({
      stages: [{ id: 'm', name: 'Main', color: '#abc' }],
      days: [{ date: '2026-11-06', sets: [{ artist: 'Jeanie and Vampa', artists: [{ name: 'Jeanie' }, { name: 'Vampa' }], stageId: 'm', startTime: '20:00' }] }],
    });
    assert.equal(day.sets[0].artist, 'Jeanie and Vampa');
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

  it('serves a second request inside 10 minutes from the cache and renders again after', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const { deps } = buildDeps();
    const og = handlerFor(deps, '/f/:slug/og.png');
    const first = await getOg(deps, 'edc-orlando-2026', og);
    t.mock.timers.tick(9 * 60 * 1000);
    const second = await getOg(deps, 'edc-orlando-2026', og);
    assert.equal(second._sent, first._sent, 'same buffer: sharp skipped');
    t.mock.timers.tick(61 * 1000);
    const third = await getOg(deps, 'edc-orlando-2026', og);
    assert.notEqual(third._sent, first._sent, 'rendered again after the TTL');
    assert.equal(third._headers['Content-Type'], 'image/png');
  });

  it('does not serve a cached image once the festival stops being public', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const { deps, findPublicIdBySlug } = buildDeps();
    const og = handlerFor(deps, '/f/:slug/og.png');
    await getOg(deps, 'edc-orlando-2026', og);
    findPublicIdBySlug.mock.mockImplementation(async () => null);
    const res = await getOg(deps, 'edc-orlando-2026', og);
    assert.equal(res._status, 404);
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

  it('buildFestivalOgSvg reads "42 acts announced" when there are no sets', () => {
    const base = { festivalName: 'Wasteland', dateRange: null, location: '', setCount: 0, stageCount: 0 };
    assert.ok(buildFestivalOgSvg({ ...base, announcedCount: 42 }).includes('>42 acts announced<'));
    assert.ok(buildFestivalOgSvg({ ...base, announcedCount: 1 }).includes('>1 act announced<'));
    assert.ok(buildFestivalOgSvg({ ...base, announcedCount: 42, stageCount: 2 }).includes('>42 acts announced · 2 stages<'));
    // No announced acts keeps the old line; sets win over announced acts.
    assert.ok(buildFestivalOgSvg(base).includes('>0 sets · 0 stages<'));
    assert.ok(buildFestivalOgSvg({ ...base, setCount: 3, announcedCount: 42 }).includes('>3 sets · 0 stages<'));
  });

  it('buildFestivalOgSvg counts in the singular, drops an empty date line and escapes text', () => {
    const svg = buildFestivalOgSvg({ festivalName: '<x>', dateRange: null, location: '', setCount: 1, stageCount: 1 });
    assert.ok(svg.includes('>1 set · 1 stage<'));
    assert.ok(svg.includes('&lt;x&gt;'));
    assert.equal((svg.match(/<text /g) || []).length, 2);
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
    assert.ok(full.includes('>Tinker Field<'));
  });
});

describe('festival page: announced lineup', () => {
  const entry = (id: string, names: string[], extra: any = {}) => ({
    id,
    artists: names.map((name) => ({ name, links: {} })),
    displayName: null,
    tier: null,
    dayDate: null,
    status: 'announced',
    announcedAt: '2026-11-20',
    linkedSetIds: [],
    ...extra,
  });
  const base = (lineup: any[], days: any[]) => ({
    id: 'f-1',
    name: 'Names Fest',
    location: 'Field',
    b2bSeparator: 'b2b',
    stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
    days,
    lineup,
  });
  const render = (festival: any) => renderFestivalPage({ festival, origin: 'https://festie.us', slug: 'names-fest' });
  const noSets = [
    { label: 'Fri', date: '2026-11-06', sets: [] },
    { label: 'Sat', date: '2026-11-07', sets: [] },
  ];

  it('places entries under their day, in the announced section by tier, and in the cancelled list', () => {
    const lineup = [
      entry('lu-1', ['Low Tier'], { tier: 3 }),
      entry('lu-2', ['Top Tier'], { tier: 1 }),
      entry('lu-3', ['No Tier']),
      entry('lu-4', ['Friday Act'], { dayDate: '2026-11-06' }),
      entry('lu-5', ['Gone Act'], { status: 'cancelled' }),
      entry('lu-6', ['Moved Day'], { dayDate: '2030-01-01' }),
    ];
    const lineupParts = buildFestivalPageLineup(base(lineup, noSets));
    assert.deepEqual(lineupParts.perDay, [['Friday Act'], []]);
    assert.deepEqual(lineupParts.undated, ['Top Tier', 'Low Tier', 'No Tier', 'Moved Day']);
    assert.deepEqual(lineupParts.cancelled, ['Gone Act']);

    const html = render(base(lineup, noSets));
    assert.ok(html.includes('Stages and times to come.'));
    assert.ok(html.includes('<h2>Announced lineup</h2>'));
    assert.ok(html.includes('Days and times to come.'));
    assert.ok(html.includes('<h2>Cancelled</h2>'));
    assert.ok(html.includes('Set times to come.'), 'Saturday has no sets and no acts');
    assert.ok(html.indexOf('Top Tier') < html.indexOf('Low Tier'));
    assert.ok(html.indexOf('Announced lineup') < html.indexOf('Cancelled'));
  });

  it('leaves out a covered entry, since its set is already listed, and says "Lineup for" with no sets', () => {
    const days = [{ label: 'Fri', date: '2026-11-06', sets: [{ id: 's1', artist: 'Covered Act', stageId: 'main', startTime: '20:00', endTime: '21:00' }] }];
    const festival = base([entry('lu-1', ['Covered Act'], { dayDate: '2026-11-06' }), entry('lu-2', ['Still Open'])], days);
    const html = render(festival);
    assert.equal(html.split('Covered Act').length - 1, 1, 'the covered act shows once, as a set');
    assert.ok(html.includes('Still Open'));
    assert.ok(html.includes('content="Lineup and set times for Names Fest'));
    assert.ok(render(base([entry('lu-1', ['Still Open'])], noSets)).includes('content="Lineup for Names Fest'));
  });

  it('prints organizer text escaped, and prints no links', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = render(
      base(
        [
          entry('lu-1', [evil, 'Plain'], { artists: [{ name: evil, links: { web: 'javascript:alert(1)' } }] }),
          entry('lu-2', ['A'], { displayName: '<script>alert(2)</script>', status: 'cancelled' }),
        ],
        noSets,
      ),
    );
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<script>alert(2)'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));
    assert.ok(!html.includes('javascript:alert(1)'));
  });

  it("keeps the empty-lineup line only when there are no days and no entries", () => {
    assert.ok(render(base([], [])).includes("The lineup isn't out yet."));
    assert.ok(!render(base([entry('lu-1', ['Solo'])], [])).includes("The lineup isn't out yet."));
  });
});
