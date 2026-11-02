/**
 * T46 P2: an admin shifts a stage by 30 minutes in one editor save. The route
 * reads pickers once and emits one scheduleChanged with every moved set, and
 * the push builder turns that into one shift-form alert for the user with picks.
 * Mocked deps, no database.
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createFestivalsRoutes from '../routes/festivals.js';
import { buildSchedulePushes } from '../lib/schedule-diff.js';

const pass = () => (req: any, _res: any, next: any) => {
  req.validatedBody = req.body;
  req.validatedParams = req.params;
  next();
};

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// 20 one-hour sets on Sahara, 30 minutes apart from 12:00, shifted by `shift` minutes.
const sets = (shift: number) =>
  Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`,
    artist: `Artist ${i}`,
    stageId: 'sahara',
    startTime: hhmm(720 + i * 30 + shift),
    endTime: hhmm(780 + i * 30 + shift),
  }));

const stages = [{ id: 'sahara', name: 'Sahara', color: '#ff0000' }];
const day = (shift: number) => [{ label: 'Sat', date: '2026-04-11', sets: sets(shift) }];

function build() {
  const existing: any = {
    id: 'f-1',
    name: 'Coachella',
    publishedAt: '2026-01-01T00:00:00.000Z',
    location: 'Indio',
    latitude: 1,
    longitude: 1,
    stages,
    days: day(0),
  };
  const pickersBySet = mock.fn(
    async () =>
      new Map([
        ['s0', ['A']],
        ['s5', ['A']],
        ['s9', ['A']],
      ]),
  );
  const deps: any = {
    express,
    config: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
    adminAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'admin-1' };
      next();
    },
    hasRecentAuth: () => true,
    requireRecentAuth: (_req: any, _res: any, next: any) => next(),
    getFestivalById: mock.fn(async () => existing),
    validateFestivalIssues: () => [],
    publishChecklist: () => [],
    sanitizeFestivalPayload: (body: any, current: any) => ({ ...current, ...body }),
    getRequestIp: () => '127.0.0.1',
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, code } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR', INVALID_INPUT: 'INVALID_INPUT' },
    rateLimit: pass,
    stores: {
      festivals: {
        update: mock.fn(async (id: string, data: any) => ({ ...existing, id, ...data })),
        getSetTimesOutAt: mock.fn(async () => '2026-01-01T00:00:00.000Z'),
      },
      profiles: { pickersBySet },
      pool: { query: async () => ({ rows: [{ count: '0' }] }) },
    },
    emitter: { festivalCreated: mock.fn(), festivalUpdated: mock.fn(), scheduleChanged: mock.fn() },
    schemas: {},
    validate: pass,
    validateQuery: pass,
    validateParams: pass,
    invalidateFestivalCache: () => {},
    reengagement: { sendSetTimesOut: mock.fn(async () => ({ queued: false })) },
  };
  const app = express();
  app.use(express.json());
  app.use(createFestivalsRoutes(deps));
  return { app, deps, pickersBySet };
}

describe('bulk shift save', () => {
  test('one save reads pickers once, emits once, and alerts only the user with picks', async () => {
    const { app, deps, pickersBySet } = build();

    const res = await request(app)
      .put('/f-1')
      .send({ stages, days: day(30) });

    assert.equal(res.status, 200);
    assert.equal(pickersBySet.mock.calls.length, 1);
    assert.equal((pickersBySet.mock.calls[0]!.arguments as any[])[1].length, 20);
    assert.equal(deps.emitter.scheduleChanged.mock.calls.length, 1);
    const { changes } = deps.emitter.scheduleChanged.mock.calls[0]!.arguments[0];
    assert.equal(changes.length, 20);

    const pushes = buildSchedulePushes(
      'Coachella',
      changes,
      new Map([
        ['s0', ['A']],
        ['s5', ['A']],
        ['s9', ['A']],
      ]),
    );
    assert.deepEqual(
      pushes.map((p) => ({ userId: p.userId, title: p.title })),
      [{ userId: 'A', title: 'Sahara: 3 of your picks moved +30 min' }],
    );
  });
});
