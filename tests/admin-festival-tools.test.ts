// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

// Admin festival tools (T34 P1): Spotify backfill body, setIds and unmatched;
// per-artist set links; the festival venue rule and its geocode condition;
// per-set engagement. All dependencies are mocked; no database is needed.

import assert from 'node:assert/strict';
import { describe, test, mock, beforeEach, afterEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import createAdminRoutes from '../routes/admin.js';
import createFestivalsRoutes from '../routes/festivals.js';
import { schemas, validate, sanitizeFestivalPayload } from '../lib/schemas.js';

const ErrorCodes = {
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  CONFIRM_REMOVALS: 'CONFIRM_REMOVALS',
  FESTIVAL_CHANGED: 'FESTIVAL_CHANGED',
};

const noop = () => {};
const pass = (_req: any, _res: any, next: any) => next();

function baseDeps(overrides: any = {}) {
  return {
    express,
    config: {
      ADMIN_WRITE_RATE_LIMIT_MAX: 100,
      SPOTIFY_CLIENT_ID: 'cid',
      SPOTIFY_CLIENT_SECRET: 'csecret',
      MAX_STAGES: 20,
      MAX_DAYS: 10,
      MAX_SETS_PER_DAY: 200,
    },
    log: { info: noop, warn: noop, error: noop, debug: noop },
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, status, code } }),
    ErrorCodes,
    adminAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'admin-1' };
      next();
    },
    hasRecentAuth: () => true,
    requireRecentAuth: pass,
    rateLimit: () => pass,
    setNoStore: noop,
    getRequestIp: () => '127.0.0.1',
    schemas,
    validate,
    validateQuery: () => pass,
    validateParams: () => (req: any, _res: any, next: any) => {
      req.validatedParams = req.params;
      next();
    },
    invalidateFestivalCache: noop,
    io: { to: () => ({ emit: noop }) },
    emitter: { festivalUpdated: mock.fn(), festivalCreated: mock.fn(), scheduleChanged: mock.fn() },
    state: { onlineUsers: new Map() },
    ...overrides,
  };
}

function appFor(router: any) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

/**
 * A pool whose connect() hands out a client that shares one query mock, so a route that runs in
 * withTransactionRetry is observable. `answer` returns rows for a statement; BEGIN and COMMIT answer empty.
 */
function txPool(answer: (sql: string, params?: unknown[]) => any) {
  const query = mock.fn(async (sql: string, params?: unknown[]) => answer(sql, params) ?? { rows: [], rowCount: 0 });
  const pool = { query, connect: async () => ({ query, release: noop }) };
  return { pool, query };
}
const statements = (query: any) => query.mock.calls.map((c: any) => String(c.arguments[0]));

// ── Spotify backfill ────────────────────────────────────────────────

describe('POST /festivals/:id/backfill-spotify', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // Spotify finds "Alpha" only.
    globalThis.fetch = (async (url: string) => {
      if (url.includes('accounts.spotify.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
      const items =
        q === 'Alpha'
          ? [{ id: 'a', name: 'Alpha', external_urls: { spotify: 'https://open.spotify.com/artist/a' } }]
          : [];
      return { ok: true, status: 200, json: async () => ({ artists: { items } }) };
    }) as any;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function backfillApp(
    sets: any[],
    extra: { shared?: string[]; sharedUnderLock?: string[]; fill?: any; currentArtists?: (set: any) => any } = {},
  ) {
    const { pool, query } = txPool((sql) => {
      if (sql.startsWith('SELECT id FROM festivals')) return { rows: [{ id: 'f1' }] };
      if (sql.startsWith('SELECT id, artist, artists')) return { rows: sets };
      if (sql.startsWith('SELECT id, published_at, deleted_at FROM festivals')) return { rows: [{ id: 'f1', deleted_at: null }] };
      if (sql.startsWith('SELECT id, artists FROM festival_sets')) {
        return { rows: sets.map((set) => ({ id: set.id, artists: extra.currentArtists ? extra.currentArtists(set) : set.artists })) };
      }
      return null;
    });
    const auditInsert = mock.fn(async () => {});
    const artists = {
      // The first call is the read before the transaction; the second, made with the locked client, is the check that counts.
      sharedElsewhere: mock.fn(async (_festivalId: string, _ids: string[], db?: unknown) =>
        new Set(db ? (extra.sharedUnderLock ?? extra.shared ?? []) : (extra.shared ?? [])),
      ),
      fillEmpty: mock.fn(extra.fill ?? (async () => null)),
    };
    const deps = baseDeps({ stores: { pool, auditLog: { insert: auditInsert }, artists } });
    return { app: appFor(createAdminRoutes(deps)), query, auditInsert, artists };
  }

  test('accepts a request with no body (old mobile bundles)', async () => {
    const { app } = backfillApp([]);
    const res = await request(app).post('/festivals/f1/backfill-spotify').expect(200);
    assert.deepEqual(res.body.data.unmatched, []);
    assert.equal(res.body.data.total, 0);
  });

  test('rejects an override that is not an https link', async () => {
    const { app, query } = backfillApp([]);
    const res = await request(app)
      .post('/festivals/f1/backfill-spotify')
      .send({ overrides: { X: 'javascript:alert(1)' } })
      .expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(query.mock.callCount(), 0);
  });

  test('rejects more than 500 setIds', async () => {
    const { app } = backfillApp([]);
    const setIds = Array.from({ length: 501 }, (_, i) => `s${i}`);
    await request(app).post('/festivals/f1/backfill-spotify').send({ setIds }).expect(400);
  });

  test('passes setIds to the set query as the second parameter', async () => {
    const { app, query } = backfillApp([]);
    await request(app)
      .post('/festivals/f1/backfill-spotify')
      .send({ setIds: ['S'] })
      .expect(200);
    const setQuery = query.mock.calls.find((c: any) => c.arguments[0].startsWith('SELECT id, artist, artists'))!;
    assert.match(setQuery.arguments[0], /id = ANY\(\$2::text\[\]\)/);
    assert.deepEqual(setQuery.arguments[1], ['f1', ['S']]);
  });

  test('lists the cleaned names it could not match, B2B parts one by one', async () => {
    const { app, query, auditInsert } = backfillApp([
      { id: 's1', artist: 'Alpha b2b Beta', artists: [{ name: 'Alpha b2b Beta' }] },
      { id: 's2', artist: 'Gamma (DJ Set)', artists: [] },
    ]);
    const res = await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    assert.deepEqual(res.body.data, { updated: 1, skipped: 1, total: 2, unmatched: ['Beta', 'Gamma'], skippedShared: [] });

    const update = query.mock.calls.find((c: any) => c.arguments[0].startsWith('UPDATE festival_sets'))!;
    assert.equal(update.arguments[1]![2], 's1');
    const details = JSON.parse((auditInsert.mock.calls[0]!.arguments as any)[0].detailsJson);
    assert.equal(details.unmatched, 2);
    assert.equal(details.setIds, null);
  });

  test('does not list an artist that already has a link', async () => {
    const { app } = backfillApp([
      {
        id: 's1',
        artist: 'Delta',
        artists: [{ name: 'Delta', links: { spotify: 'https://open.spotify.com/artist/d' } }],
      },
    ]);
    const res = await request(app).post('/festivals/f1/backfill-spotify').expect(200);
    assert.deepEqual(res.body.data.unmatched, []);
  });

  test('picks sets where any artist lacks a link and keeps the linked one', async () => {
    const { app, query } = backfillApp([
      {
        id: 's1',
        artist: 'Alpha b2b Beta',
        artists: [{ name: 'Alpha' }, { name: 'Beta', links: { spotify: 'https://open.spotify.com/artist/b' } }],
      },
    ]);
    const res = await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    const setQuery = query.mock.calls.find((c: any) => c.arguments[0].startsWith('SELECT id, artist, artists'))!;
    assert.match(setQuery.arguments[0], /link_url IS NULL OR link_url = '' OR EXISTS/);
    assert.match(setQuery.arguments[0], /a->'links'->>'spotify'/);
    assert.deepEqual(res.body.data, { updated: 1, skipped: 0, total: 1, unmatched: [], skippedShared: [] });
    const update = query.mock.calls.find((c: any) => c.arguments[0].startsWith('UPDATE festival_sets'))!;
    assert.deepEqual(JSON.parse(update.arguments[1]![0] as string), [
      { name: 'Alpha', links: { spotify: 'https://open.spotify.com/artist/a' } },
      { name: 'Beta', links: { spotify: 'https://open.spotify.com/artist/b' } },
    ]);
  });

  test('force is gone: an old client that sends it never re-links a linked artist', async () => {
    const { app, query } = backfillApp([
      { id: 's1', artist: 'Alpha', artists: [{ name: 'Alpha', links: { spotify: 'https://open.spotify.com/artist/old' } }] },
    ]);
    const res = await request(app).post('/festivals/f1/backfill-spotify').send({ force: true }).expect(200);
    const setQuery = query.mock.calls.find((c: any) => c.arguments[0].startsWith('SELECT id, artist, artists'))!;
    assert.match(setQuery.arguments[0], /link_url IS NULL OR link_url = '' OR EXISTS/);
    assert.equal(res.body.data.updated, 0);
    assert.ok(!statements(query).some((sql: string) => sql.startsWith('UPDATE festival_sets')));
  });

  test('writes in one transaction under the festival lock, and bumps edited_at', async () => {
    const { app, query } = backfillApp([{ id: 's1', artist: 'Alpha', artists: [{ name: 'Alpha' }] }]);
    await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    const sql = statements(query);
    const at = (prefix: string) => sql.findIndex((statement: string) => statement.startsWith(prefix));
    assert.ok(at('BEGIN') < at('SELECT id, published_at, deleted_at FROM festivals'));
    assert.ok(at('SELECT id, published_at, deleted_at FROM festivals') < at('SELECT id, artists FROM festival_sets'));
    assert.ok(at('SELECT id, artists FROM festival_sets') < at('UPDATE festival_sets'));
    assert.ok(at('UPDATE festival_sets') < at('UPDATE festivals SET updated_at = NOW(), edited_at = NOW()'));
    assert.ok(at('UPDATE festivals SET updated_at = NOW(), edited_at = NOW()') < at('COMMIT'));
  });

  test('a set that changed after it was read is left for the next run', async () => {
    const { app, query } = backfillApp([{ id: 's1', artist: 'Alpha', artists: [{ name: 'Alpha' }] }], {
      currentArtists: () => [{ name: 'Alpha Edited' }],
    });
    const res = await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    assert.equal(res.body.data.updated, 0);
    assert.ok(!statements(query).some((sql: string) => sql.startsWith('UPDATE festival_sets')));
  });

  test('an artist that is on other festivals is left alone and listed', async () => {
    const { app, query, artists } = backfillApp(
      [{ id: 's1', artist: 'Alpha', artists: [{ id: 'art-1', name: 'Alpha' }] }],
      { shared: ['art-1'] },
    );
    const res = await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    assert.equal(res.body.data.updated, 0);
    assert.deepEqual(res.body.data.skippedShared, ['Alpha']);
    assert.equal(artists.fillEmpty.mock.callCount(), 0);
    assert.ok(!statements(query).some((sql: string) => sql.startsWith('UPDATE festival_sets')));
  });

  test('a guess goes into the artist row, and a Spotify id another artist holds is reported, not a 500', async () => {
    const { app, artists } = backfillApp(
      [{ id: 's1', artist: 'Alpha', artists: [{ id: 'art-1', name: 'Alpha' }] }],
      { fill: async () => ({ artist: { links: {}, photo: null, genres: [] }, skippedSpotify: true }) },
    );
    const res = await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    assert.equal(artists.fillEmpty.mock.callCount(), 1);
    assert.deepEqual((artists.fillEmpty.mock.calls[0]!.arguments as any)[2].spotifyUrl, 'https://open.spotify.com/artist/a');
    assert.deepEqual(res.body.data.unmatched, ['Alpha']);
  });

  test('an artist that another festival gained after the first read is left alone under the locks', async () => {
    const { app, query, artists } = backfillApp(
      [{ id: 's1', artist: 'Alpha', artists: [{ id: 'art-1', name: 'Alpha' }] }],
      { sharedUnderLock: ['art-1'], fill: async () => ({ artist: { links: {}, photo: null, genres: [] }, skippedSpotify: false, changed: true }) },
    );
    const res = await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    assert.equal(res.body.data.updated, 0);
    assert.deepEqual(res.body.data.skippedShared, ['Alpha']);
    assert.equal(artists.fillEmpty.mock.callCount(), 0);
    assert.ok(!statements(query).some((sql: string) => sql.startsWith('UPDATE festival_sets')));
    const sql = statements(query);
    assert.ok(sql.findIndex((s: string) => s.startsWith('SELECT id FROM artists')) < sql.length, 'the artist rows were locked');
    assert.equal(artists.sharedElsewhere.mock.calls.at(-1)!.arguments.length, 3, 'the check ran with the transaction client');
  });

  test('a filled artist has every copy in the festival rewritten from its row, in the same transaction', async () => {
    const filledArtist = { id: 'art-1', name: 'Alpha', links: { spotify: 'https://open.spotify.com/artist/a' }, photo: null, genres: [] };
    const { app, query } = backfillApp([{ id: 's1', artist: 'Alpha', artists: [{ id: 'art-1', name: 'Alpha' }] }], {
      fill: async () => ({ artist: filledArtist, skippedSpotify: false, changed: true }),
    });
    await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    const sql = statements(query);
    const rewrite = sql.findIndex((s: string) => s.includes('FROM festivals WHERE id = ANY'));
    assert.ok(rewrite > sql.findIndex((s: string) => s.startsWith('UPDATE festival_sets SET artists = $1')), 'rewrites after the set write');
    assert.ok(rewrite < sql.indexOf('COMMIT'));
    assert.deepEqual(query.mock.calls[rewrite]!.arguments[1], [['f1']]);
  });
});


// ── Set engagement ──────────────────────────────────────────────────

describe('GET /festivals/:id/set-engagement', () => {
  test('merges picks and reminders per set', async () => {
    const query = mock.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.startsWith('SELECT id FROM festivals')) return { rows: [{ id: 'f1' }] };
      if (sql.includes('festival_profile_picks'))
        return {
          rows: [
            { setId: 's1', picks: 3 },
            { setId: 's2', picks: 1 },
          ],
        };
      return {
        rows: [
          { setId: 's1', reminders: 1 },
          { setId: 's3', reminders: 2 },
          { setId: '__proto__', reminders: 1 },
        ],
      };
    });
    const app = appFor(createAdminRoutes(baseDeps({ stores: { pool: { query } } })));
    const res = await request(app).get('/festivals/f1/set-engagement').expect(200);
    assert.deepEqual(res.body.data, {
      s1: { picks: 3, reminders: 1 },
      s2: { picks: 1, reminders: 0 },
      s3: { picks: 0, reminders: 2 },
      ['__proto__']: { picks: 0, reminders: 1 },
    });
    for (const call of query.mock.calls.slice(1)) assert.deepEqual(call.arguments[1], ['f1']);
  });

  test('returns 404 for a missing or deleted festival', async () => {
    const query = mock.fn(async () => ({ rows: [] }));
    const app = appFor(createAdminRoutes(baseDeps({ stores: { pool: { query } } })));
    await request(app).get('/festivals/gone/set-engagement').expect(404);
    assert.equal(query.mock.callCount(), 1);
  });
});

// ── Set link per artist ─────────────────────────────────────────────

describe('PUT /:festivalId/sets/:setId/link', () => {
  function linkApp(set: any, extra: { hasArtistRow?: boolean } = {}) {
    const festival = { id: 'f1', days: [{ label: 'Day 1', sets: [set] }] };
    const { pool, query } = txPool((sql) => {
      if (sql.startsWith('SELECT id, published_at, deleted_at FROM festivals')) return { rows: [{ id: 'f1', deleted_at: null }] };
      if (sql.startsWith('SELECT artist, artists FROM festival_sets')) return { rows: [{ artist: set.artist, artists: set.artists }] };
      if (sql.startsWith('SELECT 1 FROM artists')) return { rows: extra.hasArtistRow ? [{}] : [], rowCount: extra.hasArtistRow ? 1 : 0 };
      return null;
    });
    const artists = {
      getById: mock.fn(async () => ({ updated_at: new Date('2026-06-01T00:00:00.123Z') })),
      update: mock.fn(async () => ({ synced: [] })),
    };
    const deps = baseDeps({ getFestivalById: mock.fn(async () => festival), stores: { pool, artists } });
    return { app: appFor(createFestivalsRoutes(deps)), query, artists };
  }
  const writeOf = (query: any) => query.mock.calls.find((c: any) => String(c.arguments[0]).startsWith('UPDATE festival_sets'))!;
  const twoArtists = () => ({
    id: 's1',
    artist: 'A b2b B',
    artists: [
      { name: 'A', links: { spotify: 'https://open.spotify.com/artist/a' } },
      { name: 'B', links: {} },
    ],
  });

  test('changes only the chosen artist and keeps link_url on the first', async () => {
    const { app, query } = linkApp(twoArtists());
    const res = await request(app)
      .put('/f1/sets/s1/link')
      .send({ linkUrl: 'https://open.spotify.com/artist/x', artistIndex: 1 })
      .expect(200);
    assert.deepEqual(res.body.data, { setId: 's1', artistIndex: 1, linkUrl: 'https://open.spotify.com/artist/x' });
    const [sql, params] = writeOf(query).arguments as any;
    assert.equal(sql, 'UPDATE festival_sets SET artists = $1, link_url = $2 WHERE id = $3 AND festival_id = $4');
    assert.deepEqual(JSON.parse(params[0]), [
      { name: 'A', links: { spotify: 'https://open.spotify.com/artist/a' } },
      { name: 'B', links: { spotify: 'https://open.spotify.com/artist/x' } },
    ]);
    assert.deepEqual(params.slice(1), ['https://open.spotify.com/artist/a', 's1', 'f1']);
  });

  test('runs in one transaction: lock the festival, read the set row, write, bump edited_at, commit', async () => {
    const { app, query } = linkApp(twoArtists());
    await request(app).put('/f1/sets/s1/link').send({ linkUrl: 'https://open.spotify.com/artist/x', artistIndex: 1 }).expect(200);
    const sql = statements(query);
    const order = [
      'BEGIN',
      'SELECT id, published_at, deleted_at FROM festivals',
      'SELECT artist, artists FROM festival_sets',
      'UPDATE festival_sets',
      'UPDATE festivals SET updated_at = NOW(), edited_at = NOW()',
      'COMMIT',
    ].map((prefix) => sql.findIndex((statement: string) => statement.startsWith(prefix)));
    assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]!)), sql.join(' | '));
    assert.match(sql.find((statement: string) => statement.startsWith('SELECT artist, artists FROM festival_sets'))!, /FOR UPDATE/);
  });

  test('refuses an artist that is not on the set', async () => {
    const { app, query } = linkApp(twoArtists());
    const res = await request(app)
      .put('/f1/sets/s1/link')
      .send({ linkUrl: 'https://open.spotify.com/artist/x', artistIndex: 2 })
      .expect(400);
    assert.equal(res.body.error.message, 'That artist is not on this set.');
    assert.ok(!statements(query).some((sql: string) => sql.startsWith('UPDATE festival_sets')));
  });

  test('builds the artists array for a set saved without one', async () => {
    const { app, query } = linkApp({ id: 's1', artist: 'Solo', artists: [] });
    await request(app).put('/f1/sets/s1/link').send({ linkUrl: 'https://open.spotify.com/artist/s' }).expect(200);
    const params = (writeOf(query).arguments as any)[1];
    assert.deepEqual(JSON.parse(params[0]), [
      { name: 'Solo', links: { spotify: 'https://open.spotify.com/artist/s' } },
    ]);
    assert.equal(params[1], 'https://open.spotify.com/artist/s');
  });

  test('removing the first artist link clears link_url', async () => {
    const { app, query } = linkApp(twoArtists());
    await request(app).put('/f1/sets/s1/link').send({ linkUrl: '' }).expect(200);
    const params = (writeOf(query).arguments as any)[1];
    assert.deepEqual(JSON.parse(params[0])[0].links, {});
    assert.equal(params[1], null);
  });

  test('an artist that has a row owns the link: the row is edited, which rewrites every festival', async () => {
    const set = { id: 's1', artist: 'A', artists: [{ id: 'art-1', name: 'A', links: {} }] };
    const { app, query, artists } = linkApp(set, { hasArtistRow: true });
    await request(app).put('/f1/sets/s1/link').send({ linkUrl: 'https://open.spotify.com/artist/x' }).expect(200);
    assert.ok(!statements(query).some((sql: string) => sql.startsWith('UPDATE festival_sets')));
    const [artistId, input] = artists.update.mock.calls[0]!.arguments as any;
    assert.equal(artistId, 'art-1');
    assert.equal(input.expectedUpdatedAt, '2026-06-01T00:00:00.123Z');
    assert.deepEqual(input.changes, { spotifyLink: 'https://open.spotify.com/artist/x' });
  });
});

// ── Venue ───────────────────────────────────────────────────────────

describe('sanitizeFestivalPayload venue rule', () => {
  const stored = { id: 'f1', name: 'Fest', latitude: 10, longitude: 20 };
  const run = (input: any) => {
    const r = sanitizeFestivalPayload({ name: 'Fest', ...input }, stored, { MAX_STAGES: 20, MAX_DAYS: 10 }, () => 'x');
    return [r.latitude, r.longitude];
  };

  test('keeps the stored venue when neither value is sent', () => {
    assert.deepEqual(run({}), [10, 20]);
  });
  test('uses a valid pair', () => {
    assert.deepEqual(run({ latitude: 28.5383, longitude: -81.3792 }), [28.5383, -81.3792]);
  });
  test('clears both when one is missing', () => {
    assert.deepEqual(run({ latitude: 28.5 }), [null, null]);
  });
  test('clears both when one is out of range', () => {
    assert.deepEqual(run({ latitude: 28.5, longitude: 200 }), [null, null]);
  });
  test('clears both on null', () => {
    assert.deepEqual(run({ latitude: null, longitude: null }), [null, null]);
  });
});

describe('PUT /:id venue and geocoding', () => {
  function festivalApp(existing: any) {
    const update = mock.fn(async (id: string, fields: any) => ({ ...existing, id, ...fields }));
    const geocodeVenue = mock.fn(async (): Promise<any> => null);
    const deps = baseDeps({
      getFestivalById: mock.fn(async () => existing),
      validateFestivalIssues: () => [],
      sanitizeFestivalPayload: (input: any, ex: any) =>
        sanitizeFestivalPayload(input, ex, { MAX_STAGES: 20, MAX_DAYS: 10, MAX_SETS_PER_DAY: 200 }, () => 'x'),
      geocodeVenue,
      stores: { festivals: { update }, pool: { query: async () => ({ rows: [] }) } },
    });
    return { app: appFor(createFestivalsRoutes(deps)), update, geocodeVenue };
  }
  const existing = () => ({
    id: 'f1',
    name: 'Fest',
    location: 'Orlando',
    latitude: 1,
    longitude: 2,
    stages: [],
    days: [],
  });

  test('stores an admin-set venue and does not geocode', async () => {
    const { app, update, geocodeVenue } = festivalApp(existing());
    await request(app).put('/f1').send({ latitude: 28.5383, longitude: -81.3792 }).expect(200);
    const fields = (update.mock.calls[0]!.arguments as any)[1];
    assert.equal(fields.latitude, 28.5383);
    assert.equal(fields.longitude, -81.3792);
    assert.equal(geocodeVenue.mock.callCount(), 0);
  });

  test('a location change without a venue geocodes again', async () => {
    const { app, update, geocodeVenue } = festivalApp(existing());
    await request(app).put('/f1').send({ location: 'Tampa' }).expect(200);
    const fields = (update.mock.calls[0]!.arguments as any)[1];
    assert.equal('latitude' in fields, false);
    assert.equal(geocodeVenue.mock.callCount(), 1);
  });

  test('a weak geocode match is stored and flagged in the save response', async () => {
    const { app, update, geocodeVenue } = festivalApp(existing());
    geocodeVenue.mock.mockImplementation(async () => ({ latitude: 28.5, longitude: -81.4, guessed: true }));
    const res = await request(app).put('/f1').send({ location: 'Tampa' }).expect(200);
    assert.equal(res.body.data.venueGuessed, true);
    const geocodeFields = (update.mock.calls.at(-1)!.arguments as any)[1];
    assert.deepEqual(geocodeFields, { latitude: 28.5, longitude: -81.4 });
  });

  test('a firm geocode match carries no venueGuessed flag', async () => {
    const { app, geocodeVenue } = festivalApp(existing());
    geocodeVenue.mock.mockImplementation(async () => ({ latitude: 28.5, longitude: -81.4, guessed: false }));
    const res = await request(app).put('/f1').send({ location: 'Tampa' }).expect(200);
    assert.equal('venueGuessed' in res.body.data, false);
  });

  test('a save without venue or location change leaves the venue alone', async () => {
    const { app, update, geocodeVenue } = festivalApp(existing());
    await request(app).put('/f1').send({ name: 'Renamed' }).expect(200);
    assert.equal('latitude' in (update.mock.calls[0]!.arguments as any)[1], false);
    assert.equal(geocodeVenue.mock.callCount(), 0);
  });

  test('a half-sent venue stores null for both', async () => {
    const { app, update } = festivalApp(existing());
    await request(app).put('/f1').send({ latitude: 28.5 }).expect(200);
    const fields = (update.mock.calls[0]!.arguments as any)[1];
    assert.equal(fields.latitude, null);
    assert.equal(fields.longitude, null);
  });
});
