/**
 * T46 P6: GET /festivals/:id serves a set's "moved" mark only while it is under
 * 48 hours old, at depth 1 and depth 2, public and admin. The cached festival
 * record is never mutated, so a later call still filters the stale mark.
 * Mocked deps, no database.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createFestivalsRoutes from '../routes/festivals.js';
import { festivalSetResponseSchema } from '../lib/responseSchemas.js';

const HOUR = 60 * 60 * 1000;
const FRESH_FROM = { dayIndex: 0, stageId: 'sahara', start: '22:00', end: '23:00' };

function cachedFestival(): any {
  return {
    id: 'f-1',
    name: 'Move Fest',
    location: 'Here',
    latitude: null,
    longitude: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
    stages: [{ id: 'sahara', name: 'Sahara', color: '#ff0000', latitude: null, longitude: null }],
    days: [
      {
        dayIndex: 0,
        label: 'Saturday',
        date: '2026-08-22',
        sets: [
          {
            id: 'fresh',
            artist: 'Fresh',
            artists: [],
            stageId: 'sahara',
            startTime: '22:30',
            endTime: '23:30',
            linkUrl: null,
            movedAt: new Date(Date.now() - HOUR).toISOString(),
            movedFrom: FRESH_FROM,
          },
          {
            id: 'stale',
            artist: 'Stale',
            artists: [],
            stageId: 'sahara',
            startTime: '20:00',
            endTime: '21:00',
            linkUrl: null,
            movedAt: new Date(Date.now() - 49 * HOUR).toISOString(),
            movedFrom: { dayIndex: 0, stageId: 'sahara', start: '19:00', end: '20:00' },
          },
          {
            id: 'plain',
            artist: 'Plain',
            artists: [],
            stageId: 'sahara',
            startTime: '18:00',
            endTime: '19:00',
            linkUrl: null,
          },
        ],
      },
    ],
    mapConfig: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function build(admin = false) {
  const cached = cachedFestival();
  const snapshot = structuredClone(cached);
  const pass = (req: any, _res: any, next: any) => {
    req.validatedParams = req.params;
    req.validatedQuery = req.query.depth === undefined ? {} : { depth: Number(req.query.depth) };
    next();
  };
  const deps: any = {
    express,
    config: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
    adminAuth: (_req: any, _res: any, next: any) => next(),
    requireRecentAuth: (_req: any, _res: any, next: any) => next(),
    getFestivalById: async () => cached,
    getUserById: async () => null,
    publishChecklist: () => [],
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, code } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR', INVALID_INPUT: 'INVALID_INPUT' },
    rateLimit: () => pass,
    stores: { festivals: { getEditor: async () => null } },
    schemas: {},
    validate: () => pass,
    validateQuery: () => pass,
    validateParams: () => pass,
  };
  const app = express();
  app.use((req: any, _res, next) => {
    req.isAdmin = admin;
    next();
  });
  app.use(createFestivalsRoutes(deps));
  return { app, cached, snapshot };
}

const setsById = (body: any) => Object.fromEntries(body.data.days[0].sets.map((s: any) => [s.id, s]));

for (const admin of [false, true]) {
  for (const depth of [1, 2]) {
    describe(`GET /:id depth ${depth}, ${admin ? 'admin' : 'public'}`, () => {
      test('sends the fresh mark only and leaves the cached record untouched', async () => {
        const { app, cached, snapshot } = build(admin);
        for (let call = 0; call < 2; call++) {
          const res = await request(app).get(`/f-1?depth=${depth}`);
          assert.equal(res.status, 200);
          const sets = setsById(res.body);
          assert.equal(sets.fresh.movedAt, cached.days[0].sets[0].movedAt);
          assert.deepEqual(sets.fresh.movedFrom, FRESH_FROM);
          for (const id of ['stale', 'plain']) {
            assert.equal('movedAt' in sets[id], false, `${id} has movedAt`);
            assert.equal('movedFrom' in sets[id], false, `${id} has movedFrom`);
          }
          const schema = depth === 1 ? festivalSetResponseSchema.omit({ linkUrl: true }) : festivalSetResponseSchema;
          for (const s of Object.values(sets)) schema.strict().parse(s);
        }
        assert.deepEqual(cached, snapshot);
      });
    });
  }
}
