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

  function backfillApp(sets: any[]) {
    const query = mock.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.startsWith('SELECT id FROM festivals')) return { rows: [{ id: 'f1' }] };
      if (sql.startsWith('SELECT id, artist, artists')) return { rows: sets };
      return { rows: [] };
    });
    const auditInsert = mock.fn(async () => {});
    const deps = baseDeps({ stores: { pool: { query }, auditLog: { insert: auditInsert } } });
    return { app: appFor(createAdminRoutes(deps)), query, auditInsert };
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
      .send({ setIds: ['S'], force: true })
      .expect(200);
    const setQuery = query.mock.calls.find((c: any) => c.arguments[0].startsWith('SELECT id, artist, artists'))!;
    assert.match(setQuery.arguments[0], /id = ANY\(\$2::text\[\]\)/);
    assert.doesNotMatch(setQuery.arguments[0], /link_url IS NULL/);
    assert.deepEqual(setQuery.arguments[1], ['f1', ['S']]);
  });

  test('lists the cleaned names it could not match, B2B parts one by one', async () => {
    const { app, query, auditInsert } = backfillApp([
      { id: 's1', artist: 'Alpha b2b Beta', artists: [{ name: 'Alpha b2b Beta' }] },
      { id: 's2', artist: 'Gamma (DJ Set)', artists: [] },
    ]);
    const res = await request(app).post('/festivals/f1/backfill-spotify').send({}).expect(200);
    assert.deepEqual(res.body.data, { updated: 1, skipped: 1, total: 2, unmatched: ['Beta', 'Gamma'] });

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

  test('without force, picks sets where any artist lacks a link and keeps the linked one', async () => {
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
    assert.deepEqual(res.body.data, { updated: 1, skipped: 0, total: 1, unmatched: [] });
    const update = query.mock.calls.find((c: any) => c.arguments[0].startsWith('UPDATE festival_sets'))!;
    assert.deepEqual(JSON.parse(update.arguments[1]![0] as string), [
      { name: 'Alpha', links: { spotify: 'https://open.spotify.com/artist/a' } },
      { name: 'Beta', links: { spotify: 'https://open.spotify.com/artist/b' } },
    ]);
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
  function linkApp(set: any) {
    const festival = { id: 'f1', days: [{ label: 'Day 1', sets: [set] }] };
    const query = mock.fn(async () => ({ rows: [] }));
    const deps = baseDeps({
      getFestivalById: mock.fn(async () => festival),
      stores: { pool: { query } },
    });
    return { app: appFor(createFestivalsRoutes(deps)), query };
  }
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
    const [sql, params] = query.mock.calls[0]!.arguments as any;
    assert.equal(sql, 'UPDATE festival_sets SET artists = $1, link_url = $2 WHERE id = $3 AND festival_id = $4');
    assert.deepEqual(JSON.parse(params[0]), [
      { name: 'A', links: { spotify: 'https://open.spotify.com/artist/a' } },
      { name: 'B', links: { spotify: 'https://open.spotify.com/artist/x' } },
    ]);
    assert.deepEqual(params.slice(1), ['https://open.spotify.com/artist/a', 's1', 'f1']);
  });

  test('refuses an artist that is not on the set', async () => {
    const { app, query } = linkApp(twoArtists());
    const res = await request(app)
      .put('/f1/sets/s1/link')
      .send({ linkUrl: 'https://open.spotify.com/artist/x', artistIndex: 2 })
      .expect(400);
    assert.equal(res.body.error.message, 'That artist is not on this set.');
    assert.equal(query.mock.callCount(), 0);
  });

  test('builds the artists array for a set saved without one', async () => {
    const { app, query } = linkApp({ id: 's1', artist: 'Solo', artists: [] });
    await request(app).put('/f1/sets/s1/link').send({ linkUrl: 'https://open.spotify.com/artist/s' }).expect(200);
    const params = (query.mock.calls[0]!.arguments as any)[1];
    assert.deepEqual(JSON.parse(params[0]), [
      { name: 'Solo', links: { spotify: 'https://open.spotify.com/artist/s' } },
    ]);
    assert.equal(params[1], 'https://open.spotify.com/artist/s');
  });

  test('removing the first artist link clears link_url', async () => {
    const { app, query } = linkApp(twoArtists());
    await request(app).put('/f1/sets/s1/link').send({ linkUrl: '' }).expect(200);
    const params = (query.mock.calls[0]!.arguments as any)[1];
    assert.deepEqual(JSON.parse(params[0])[0].links, {});
    assert.equal(params[1], null);
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
    const geocodeVenue = mock.fn(async () => null);
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
