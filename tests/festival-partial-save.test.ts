// Admin festival saves: a partial PUT body is checked against the stored festival.
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
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  CONFIRM_REMOVALS: 'CONFIRM_REMOVALS',
  FESTIVAL_CHANGED: 'FESTIVAL_CHANGED',
};

const existing = {
  id: 'f1',
  name: 'Fest',
  location: 'Orlando',
  latitude: 1,
  longitude: 2,
  stages: [{ id: 'st1', name: 'Main', color: '#ff0000' }],
  days: [{ label: 'Fri', date: '2026-11-06', sets: [{ id: 's1', artist: 'A', artists: [{ name: 'A' }], stageId: 'st1' }] }],
};

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
    sanitizeFestivalPayload: (input: any, ex: any) => sanitizeFestivalPayload(input, ex, config, () => 'x'),
    stores: { pool: { query: async () => ({ rows: [] }) }, ...stores },
  };
  const app = express();
  app.use(express.json());
  app.use(createFestivalsRoutes(deps));
  return app;
}

describe('festival save validation', () => {
  test('PUT accepts a body that omits the name', async () => {
    const update = mock.fn(async (id: string, fields: any) => ({ ...existing, id, ...fields }));
    const app = appFor({ festivals: { update } });
    await request(app).put('/f1').send({ location: 'QA Land 3' }).expect(200);
    assert.equal((update.mock.calls[0]!.arguments as any)[1].location, 'QA Land 3');
  });
});
