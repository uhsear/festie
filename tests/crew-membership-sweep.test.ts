/**
 * Sweep: every `/:crewId` route of the crew routers refuses an authenticated
 * non-member with 403 'Not a crew member'. Routes are read from each router's
 * stack, so a new route that skips the crewMember gate fails here.
 * Mock deps, real Zod schemas and validation middleware. No database.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

import { schemas, validate, validateParams, validateQuery } from '../lib/schemas.js';
import { ioEmitter } from './_io-emitter';

const noop = () => {};

function buildDeps() {
  return {
    log: { info: noop, warn: noop, error: noop, debug: noop },
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'outsider', username: 'outsider' };
      next();
    },
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) =>
      res.status(status).json({ data: null, error: { message, status, code } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    },
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    sanitizeIdentifier: (s: string) => s,
    createOpaqueId: () => 'opaque-1',
    schemas,
    validate,
    validateParams,
    validateQuery,
    // Flags on, so no handler short-circuits before the membership gate matters.
    config: { SOS_ENABLED: true, LIVE_LOCATION_ENABLED: true },
    redis: {},
    io: { to: () => ({ emit: noop }) },
    emitter: ioEmitter({ to: () => ({ emit: noop }) }),
    crewNotify: mock.fn(),
    stores: { crews: { getMember: mock.fn(async () => null) } },
  };
}

const ROUTERS: Array<[string, () => Promise<any>]> = [
  ['activity', async () => (await import('../routes/activity.js')).default],
  ['crew-checkin', async () => (await import('../routes/crew-checkin.js')).default],
  ['crew-days', async () => (await import('../routes/crew-days.js')).default],
  ['crew-live-location', async () => (await import('../routes/crew-live-location.js')).default],
  ['crew-meeting-points', async () => (await import('../routes/crew-meeting-points.js')).default],
  ['crew-packing', async () => (await import('../routes/crew-packing.js')).default],
  ['crew-polls', async () => (await import('../routes/crew-polls.js')).default],
  ['crew-rides', async () => (await import('../routes/crew-rides.js')).default],
  ['crew-sos', async () => (await import('../routes/crew-sos.js')).default],
  ['crew-status', async () => (await import('../routes/crew-status.js')).default],
  ['expenses', async () => (await import('../routes/expenses.js')).default],
  ['ratings', async () => (await import('../routes/ratings.js')).createRatingsRoutes],
];

// Every (method, path) pair of a router whose path has a :crewId segment.
function crewRoutes(router: any): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const layer of router.stack) {
    if (!layer.route || !String(layer.route.path).includes(':crewId')) continue;
    for (const method of Object.keys(layer.route.methods)) {
      found.push([method, String(layer.route.path).replace(/:\w+/g, 'id-1')]);
    }
  }
  return found;
}

// Body validation runs before the gate, so routes with a required body need a valid one.
// A new body-validated route that is missing here fails with a 400, naming the route.
const BODIES: Record<string, object> = {
  'POST /id-1/checkin': { minutes: 30 },
  'PUT /id-1/days': { days: [] },
  'PUT /id-1/home-base': { location: 'Camp B' },
  'PUT /id-1/photo-album': { photoAlbumUrl: 'https://photos.example.com/a' },
  'POST /id-1/rides': { note: 'x' },
  'POST /id-1/live-location': { lat: 1, lng: 1, capturedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z' },
  'POST /id-1/meeting-points': { label: 'Gate', location: 'Main gate' },
  'PUT /id-1/meeting-points/id-1': { label: 'Gate' },
  'PUT /id-1/meeting-points/id-1/coming': { coming: true },
  'POST /id-1/packing': { label: 'Tent' },
  'POST /id-1/packing/batch': { labels: ['Tent'] },
  'PUT /id-1/packing/id-1': { label: 'Tent' },
  'POST /id-1/polls': { question: 'Where?', options: ['A', 'B'] },
  'POST /id-1/polls/id-1/vote': { optionIndex: 0 },
  'PUT /id-1/rides/id-1': { note: 'x' },
  'POST /id-1/sos/seen': { raiserId: 'user-x' },
  'PUT /id-1/status': { status: 'here' },
  'POST /crews/id-1/expenses': { description: 'Tent', amount: 10, splitWith: ['user-a'] },
  'PUT /crews/id-1/expenses/currency': { currency: 'USD' },
  'PUT /crews/id-1/expenses/id-1': { description: 'Dinner', amount: 45, splitWith: ['user-a'] },
  'POST /crews/id-1/expenses/settle': { toUserId: 'user-b', amount: 20 },
  'POST /crews/id-1/expenses/id-1/confirm': { received: true },
  'POST /crews/id-1/expenses/remind': { userId: 'user-b' },
};

let covered = 0;

for (const [name, load] of ROUTERS) {
  describe(`${name}: non-member is refused on every /:crewId route`, () => {
    test('all routes return 403 Not a crew member', async () => {
      const deps = buildDeps();
      const router = (await load())(deps);
      const routes = crewRoutes(router);
      assert.ok(routes.length > 0, `${name} exposes no /:crewId routes`);

      const app = express();
      app.use(express.json());
      app.use(router);

      const refused: string[] = [];
      for (const [method, path] of routes) {
        const res = await (request(app) as any)[method](path).send(BODIES[`${method.toUpperCase()} ${path}`] ?? {});
        if (res.status !== 403 || res.body.error?.message !== 'Not a crew member') {
          refused.push(`${method.toUpperCase()} ${path} -> ${res.status} ${JSON.stringify(res.body.error)}`);
        }
      }
      assert.deepEqual(refused, []);
      covered += routes.length;
    });
  });
}

test('sweep did not lose routes', () => {
  console.log(`crew-membership sweep covered ${covered} routes`);
  assert.ok(covered >= 50, `only ${covered} routes covered`);
});
