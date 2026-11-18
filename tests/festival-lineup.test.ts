// The announced lineup on the festival routes: a save that omits it keeps it, a save that sends it
// needs the token, entries get ids, and duplicates are refused. Route level, no database.
import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';
import createFestivalsRoutes from '../routes/festivals.js';
import { schemas, validate, sanitizeFestivalPayload } from '../lib/schemas.js';
import { validateFestivalIssues } from '../lib/helpers/validation.js';
import { FestivalChangedError } from '../lib/db/stores/festivals.js';

const noop = () => {};
const pass = (_req: any, _res: any, next: any) => next();
const config = { MAX_STAGES: 20, MAX_DAYS: 10, MAX_SETS_PER_DAY: 200 };
const ErrorCodes = {
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  CONFIRM_REMOVALS: 'CONFIRM_REMOVALS',
  FESTIVAL_CHANGED: 'FESTIVAL_CHANGED',
};

const UPDATED_AT = '2026-11-16T12:00:00.000Z';
const storedEntry = {
  id: 'lu-kept',
  artists: [{ name: 'Kai', links: {} }],
  displayName: null,
  tier: null,
  dayDate: null,
  status: 'announced',
  announcedAt: '2026-11-01',
  linkedSetIds: [],
};
const existing: any = {
  id: 'f1',
  name: 'Fest',
  location: 'Orlando',
  timeZone: 'America/New_York',
  latitude: 1,
  longitude: 2,
  updatedAt: UPDATED_AT,
  stages: [{ id: 'st1', name: 'Main', color: '#ff0000' }],
  days: [{ label: 'Fri', date: '2027-02-05', sets: [] }],
  lineup: [storedEntry],
};

let counter = 0;
function appFor(stores: any) {
  const deps: any = {
    express,
    config,
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
    getFestivalById: async () => existing,
    validateFestivalIssues,
    sanitizeFestivalPayload: (input: any, ex: any) =>
      sanitizeFestivalPayload(input, ex, config, (prefix: string) => `${prefix}-id${++counter}`),
    stores: { pool: { query: async () => ({ rows: [] }) }, ...stores },
  };
  deps.festivalAccess = () => deps.adminAuth;
  const app = express();
  app.use(express.json());
  app.use(createFestivalsRoutes(deps));
  return app;
}

const updateStore = () => mock.fn(async (id: string, fields: any) => ({ ...existing, id, ...fields }));

describe('festival lineup saves', () => {
  test('a PUT without lineup keeps the stored list: the store gets no lineup field', async () => {
    const update = updateStore();
    const app = appFor({ festivals: { update } });
    await request(app).put('/f1').send({ location: 'Elsewhere' }).expect(200);
    assert.equal('lineup' in (update.mock.calls[0]!.arguments as any)[1], false);
  });

  test('a map-style PUT with a token and no lineup keeps it too', async () => {
    const update = updateStore();
    const app = appFor({ festivals: { update } });
    await request(app)
      .put('/f1')
      .send({ name: 'Fest', expectedUpdatedAt: UPDATED_AT, stages: existing.stages })
      .expect(200);
    assert.equal('lineup' in (update.mock.calls[0]!.arguments as any)[1], false);
  });

  test('a stored lineup is not re-checked: a PUT without lineup saves even if the stored list has a duplicate', async () => {
    const update = updateStore();
    const dup = { ...existing, lineup: [storedEntry, { ...storedEntry, id: 'lu-twin' }] };
    const app = appFor({ festivals: { update } });
    (existing as any).lineup = dup.lineup;
    try {
      await request(app).put('/f1').send({ location: 'Elsewhere' }).expect(200);
    } finally {
      (existing as any).lineup = [storedEntry];
    }
  });

  test('a PUT with lineup and no expectedUpdatedAt is refused', async () => {
    const update = updateStore();
    const app = appFor({ festivals: { update } });
    const res = await request(app).put('/f1').send({ lineup: [{ artists: [{ name: 'A' }] }] }).expect(400);
    assert.match(res.body.error.message, /expectedUpdatedAt/);
    assert.equal(update.mock.callCount(), 0);
  });

  test('a PUT whose token the save refuses answers FESTIVAL_CHANGED', async () => {
    // The token is checked inside the store's transaction, under the row lock (tests/festival-edit-token.test.ts).
    const update = mock.fn(async () => {
      throw new FestivalChangedError();
    });
    const app = appFor({ festivals: { update } });
    const res = await request(app)
      .put('/f1')
      .send({ lineup: [{ artists: [{ name: 'A' }] }], expectedUpdatedAt: '2026-11-01T00:00:00.000Z' })
      .expect(409);
    assert.equal(res.body.error.code, 'FESTIVAL_CHANGED');
  });

  test('a PUT with lineup writes normalized entries and keeps a re-pasted id', async () => {
    const update = updateStore();
    const app = appFor({ festivals: { update } });
    await request(app)
      .put('/f1')
      .send({
        expectedUpdatedAt: UPDATED_AT,
        lineup: [{ artists: [{ name: 'kai' }] }, { artists: [{ name: 'New Act' }, { name: 'Other' }], displayName: 'Poster' }],
      })
      .expect(200);
    const written = (update.mock.calls[0]!.arguments as any)[1].lineup;
    assert.equal(written.length, 2);
    assert.equal(written[0].id, 'lu-kept');
    assert.equal(written[0].announcedAt, '2026-11-01');
    assert.match(written[1].id, /^lu-id/);
    assert.equal(written[1].displayName, 'Poster');
    assert.match(written[1].announcedAt, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('an empty lineup clears the list', async () => {
    const update = updateStore();
    const app = appFor({ festivals: { update } });
    await request(app).put('/f1').send({ expectedUpdatedAt: UPDATED_AT, lineup: [] }).expect(200);
    assert.deepEqual((update.mock.calls[0]!.arguments as any)[1].lineup, []);
  });

  test('more than 500 entries is refused', async () => {
    const lineup = Array.from({ length: 501 }, (_, i) => ({ artists: [{ name: `Act ${i}` }] }));
    const app = appFor({ festivals: { update: updateStore() } });
    await request(app).put('/f1').send({ expectedUpdatedAt: UPDATED_AT, lineup }).expect(400);
  });

  test('five artists on one entry is refused', async () => {
    const artists = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name }));
    const app = appFor({ festivals: { update: updateStore() } });
    await request(app).put('/f1').send({ expectedUpdatedAt: UPDATED_AT, lineup: [{ artists }] }).expect(400);
  });

  test('a duplicate act is refused with the line numbers', async () => {
    const update = updateStore();
    const app = appFor({ festivals: { update } });
    const res = await request(app)
      .put('/f1')
      .send({ expectedUpdatedAt: UPDATED_AT, lineup: [{ artists: [{ name: 'INFEKT' }] }, { artists: [{ name: 'Zed' }] }, { artists: [{ name: 'infekt' }] }] })
      .expect(400);
    assert.match(res.body.error.message, /lines 1, 3/);
    assert.equal(update.mock.callCount(), 0);
  });

  test('a bad dayDate, tier or status is refused', async () => {
    const app = appFor({ festivals: { update: updateStore() } });
    for (const bad of [{ dayDate: 'Friday' }, { tier: 10 }, { tier: 0 }, { status: 'scheduled' }]) {
      await request(app)
        .put('/f1')
        .send({ expectedUpdatedAt: UPDATED_AT, lineup: [{ artists: [{ name: 'A' }], ...bad }] })
        .expect(400);
    }
  });

  test('POST with a lineup stores normalized entries', async () => {
    const create = mock.fn(async (festival: any) => festival);
    const app = appFor({ festivals: { create } });
    await request(app)
      .post('/')
      .send({ name: 'New', timeZone: 'America/New_York', lineup: [{ artists: [{ name: 'A' }, { name: 'B' }] }] })
      .expect(201);
    const lineup = (create.mock.calls[0]!.arguments as any)[0].lineup;
    assert.equal(lineup.length, 1);
    assert.match(lineup[0].id, /^lu-id/);
    assert.equal(lineup[0].status, 'announced');
  });

});
