// Cancelling an announced act on the festival PUT: who is alerted, the true count in the save notice,
// and the cancel line in the removal confirm. Route level, no database. The alert copy is in
// tests/schedule-diff.test.ts and the end-to-end path is in tests/integration-lineup-scheduling.test.ts.
import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';
import createFestivalsRoutes from '../routes/festivals.js';
import { schemas, validate, sanitizeFestivalPayload } from '../lib/schemas.js';
import { validateFestivalIssues } from '../lib/helpers/validation.js';

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
const entry = (id: string, name: string, extra: any = {}) => ({
  id,
  artists: [{ name, links: {} }],
  displayName: null,
  tier: null,
  dayDate: '2027-02-05',
  status: 'announced',
  announcedAt: '2026-11-01',
  linkedSetIds: [],
  ...extra,
});
const festival = (): any => ({
  id: 'f1',
  name: 'Fest',
  location: 'Orlando',
  timeZone: 'America/New_York',
  latitude: 1,
  longitude: 2,
  updatedAt: UPDATED_AT,
  stages: [{ id: 'st1', name: 'Main', color: '#ff0000' }],
  days: [
    {
      label: 'Fri',
      date: '2027-02-05',
      sets: [{ id: 'set-kai', artist: 'Kai', artists: [{ name: 'Kai', links: {} }], stageId: 'st1', startTime: '20:00', endTime: '21:00' }],
    },
  ],
  lineup: [entry('lu-kai', 'Kai'), entry('lu-mira', 'Mira'), entry('lu-zed', 'Zed')],
});

let counter = 0;
function setup(options: { marks?: Record<string, string[]>; pickers?: Record<string, string[]>; picks?: number } = {}) {
  const existing = festival();
  const emitter = { festivalUpdated: mock.fn(), festivalCreated: mock.fn(), scheduleChanged: mock.fn() };
  const interested = mock.fn(async (_id: string, entryIds: string[]) =>
    new Map(entryIds.filter((id) => options.marks?.[id]).map((id) => [id, options.marks![id]!])),
  );
  const pickersBySet = mock.fn(async (_id: string, setIds: string[]) =>
    new Map(setIds.filter((id) => options.pickers?.[id]).map((id) => [id, options.pickers![id]!])),
  );
  const update = mock.fn(async (id: string, fields: any) => ({ ...existing, id, ...fields }));
  const deps: any = {
    express,
    config,
    log: { info: noop, warn: noop, error: noop, debug: noop },
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string, details?: any) =>
      res.status(status).json({ data: null, error: { message, status, code, ...details } }),
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
    emitter,
    state: { onlineUsers: new Map() },
    getFestivalById: async () => existing,
    validateFestivalIssues,
    sanitizeFestivalPayload: (input: any, ex: any) =>
      sanitizeFestivalPayload(input, ex, config, (prefix: string) => `${prefix}-id${++counter}`),
    stores: {
      pool: { query: async () => ({ rows: [{ count: String(options.picks ?? 0) }] }) },
      festivals: { update },
      profiles: { interestedProfilesByEntry: interested, pickersBySet },
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createFestivalsRoutes(deps));
  return { app, existing, emitter, interested, pickersBySet, update };
}

const cancelBody = (existing: any, ids: string[], extra: any = {}) => ({
  expectedUpdatedAt: UPDATED_AT,
  lineup: existing.lineup.map((e: any) => (ids.includes(e.id) ? { ...e, status: 'cancelled' } : e)),
  ...extra,
});
const withoutSets = (existing: any) => ({ days: existing.days.map((d: any) => ({ ...d, sets: [] })) });

describe('cancelling an announced act', () => {
  test('alerts the people whose mark is open even when nobody picked a set', async () => {
    const { app, existing, emitter, interested } = setup({ marks: { 'lu-mira': ['u1', 'u2'] } });
    const res = await request(app).put('/f1').send(cancelBody(existing, ['lu-mira'])).expect(200);
    assert.deepEqual(res.body.data.scheduleNotice, { changes: 1, people: 2, notified: true, marked: 2 });
    assert.deepEqual((interested.mock.calls[0]!.arguments as any)[1], ['lu-mira']);
    const sent = emitter.scheduleChanged.mock.calls[0]!.arguments[0] as any;
    assert.deepEqual(sent.changes, [{ kind: 'entry_cancelled', entryId: 'lu-mira', artist: 'Mira' }]);
    assert.deepEqual([...sent.interestedByEntry], [['lu-mira', ['u1', 'u2']]]);
  });

  test('respects the notify choice: saved without alerts, people still counted', async () => {
    const { app, existing, emitter } = setup({ marks: { 'lu-mira': ['u1'] } });
    const res = await request(app).put('/f1').send(cancelBody(existing, ['lu-mira'], { notify: false })).expect(200);
    assert.equal(emitter.scheduleChanged.mock.callCount(), 0);
    assert.deepEqual(res.body.data.scheduleNotice, { changes: 1, people: 1, notified: false, marked: 1 });
  });

  test('a cancelled act that nobody marked alerts no one', async () => {
    const { app, existing, emitter } = setup();
    const res = await request(app).put('/f1').send(cancelBody(existing, ['lu-zed'])).expect(200);
    assert.equal(emitter.scheduleChanged.mock.callCount(), 0);
    assert.deepEqual(res.body.data.scheduleNotice, { changes: 1, people: 0, notified: false });
  });

  test('a picker and a marker are each counted once, and a person who both picked and marked only once', async () => {
    const { app, existing, emitter } = setup({
      marks: { 'lu-kai': ['u1', 'u9'] },
      pickers: { 'set-kai': ['u1', 'u2'] },
      picks: 2,
    });
    const body = cancelBody(existing, ['lu-kai'], { ...withoutSets(existing), confirmRemovals: true });
    const res = await request(app).put('/f1').send(body).expect(200);
    // u1 picked and marked: told through the pick. u2 picked. u9 marked only.
    assert.deepEqual(res.body.data.scheduleNotice, { changes: 2, people: 3, notified: true, marked: 1 });
    const sent = emitter.scheduleChanged.mock.calls[0]!.arguments[0] as any;
    assert.deepEqual(sent.changes.map((c: any) => c.kind), ['removed', 'entry_cancelled']);
  });

  test('the removal confirm carries the cancel line data: acts, sets that go, who hears', async () => {
    const { app, existing, update } = setup({ marks: { 'lu-kai': ['u9'], 'lu-mira': ['u8'] }, pickers: { 'set-kai': ['u1', 'u2'] }, picks: 3 });
    const res = await request(app).put('/f1').send(cancelBody(existing, ['lu-kai', 'lu-mira'], withoutSets(existing))).expect(409);
    assert.equal(res.body.error.code, 'CONFIRM_REMOVALS');
    assert.deepEqual(res.body.error.removal, {
      days: 0,
      sets: 1,
      picks: 3,
      ratings: 3,
      cancel: { acts: ['Kai', 'Mira'], sets: 1, picked: 2, marked: 2 },
    });
    assert.equal(update.mock.callCount(), 0);
  });

  test('a removal confirm with no cancelled act has no cancel field', async () => {
    const { app, existing } = setup({ pickers: { 'set-kai': ['u1'] }, picks: 1 });
    const res = await request(app).put('/f1').send({ expectedUpdatedAt: UPDATED_AT, ...withoutSets(existing) }).expect(409);
    assert.equal('cancel' in res.body.error.removal, false);
  });

  test('a set removed on its own does not count as a cancelled act set', async () => {
    const { app, existing } = setup({ marks: { 'lu-mira': ['u8'] }, pickers: { 'set-kai': ['u1'] }, picks: 1 });
    const res = await request(app).put('/f1').send(cancelBody(existing, ['lu-mira'], withoutSets(existing))).expect(409);
    assert.deepEqual(res.body.error.removal.cancel, { acts: ['Mira'], sets: 0, picked: 0, marked: 1 });
  });

  test('un-cancelling and saving a lineup with no new cancel read nothing and alert no one', async () => {
    const { app, existing, emitter, interested } = setup();
    existing.lineup[1].status = 'cancelled';
    await request(app).put('/f1').send({ expectedUpdatedAt: UPDATED_AT, lineup: existing.lineup.map((e: any) => ({ ...e, status: 'announced' })) }).expect(200);
    await request(app).put('/f1').send({ expectedUpdatedAt: UPDATED_AT, lineup: existing.lineup }).expect(200);
    assert.equal(interested.mock.callCount(), 0);
    assert.equal(emitter.scheduleChanged.mock.callCount(), 0);
  });

  test('a PUT with no lineup never looks up marks', async () => {
    const { app, interested } = setup();
    await request(app).put('/f1').send({ location: 'Elsewhere' }).expect(200);
    assert.equal(interested.mock.callCount(), 0);
  });
});
