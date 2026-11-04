/**
 * Mock-based route tests for routes/crew-meeting-points.js
 *
 * Covers: PUT /:crewId/home-base, GET /:crewId/meeting-points,
 *         POST /:crewId/meeting-points, PUT /:crewId/meeting-points/:mpId,
 *         DELETE /:crewId/meeting-points/:mpId,
 *         PUT /:crewId/meeting-points/:mpId/coming
 *
 * Mounts the route factory on a minimal Express app with fully stubbed deps.
 * No database required -- all stores are mock.fn() stubs.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

import { createCrewNotifier } from '../lib/notifications/crew-notify.js';

// ── Shared helpers ───────────────────────────────────────────────────

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };

function makeIo() {
  const emitFn = mock.fn(() => {});
  return {
    to: mock.fn(() => ({ emit: emitFn })),
    _emit: emitFn,
  };
}

// getById results are read by the route in snake_case (crew_id, created_by, …).
const DEFAULT_MEETING_POINT = {
  id: 'mp-1',
  crew_id: 'crew-1',
  created_by: 'user-1',
  label: 'Main Stage Left',
  location: 'Near the food trucks',
  type: 'during',
  meet_at: null,
  stage_reference: null,
  created_at: '2026-05-08T00:00:00.000Z',
  active: true,
};

/**
 * Build a deps object tailored for crew-meeting-points.js.
 */
function makeDeps(overrides: any = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getMember: mock.fn(async () => null),
      updateHomeBase: mock.fn(async () => ({ id: 'crew-1', homeBaseLocation: 'Gate A', homeBaseTime: '3pm' })),
      meetingPoints: {
        listByCrew: mock.fn(async () => []),
        countByCrew: mock.fn(async () => 0),
        create: mock.fn(async (data: any) => ({ ...data, active: true, createdAt: '2026-05-08T00:00:00.000Z' })),
        getById: mock.fn(async () => null),
        update: mock.fn(async (id: any, data: any) => ({ ...DEFAULT_MEETING_POINT, ...data, id })),
        deactivate: mock.fn(async () => {}),
        setComing: mock.fn(async (id: any, _crewId: any, userId: any, coming: any) => ({
          ...DEFAULT_MEETING_POINT,
          id,
          coming: coming ? [userId] : [],
        })),
      },
    },
    activity: {
      log: mock.fn(async () => {}),
    },
  };

  // Deep-merge stores
  const stores: any = { ...storesBase };
  if (overrides.stores) {
    const crewOverrides = overrides.stores.crews || {};
    const mpOverrides = crewOverrides.meetingPoints || {};
    stores.crews = {
      ...storesBase.crews,
      ...crewOverrides,
      meetingPoints: { ...storesBase.crews.meetingPoints, ...mpOverrides },
    };
    if (overrides.stores.activity) {
      stores.activity = { ...storesBase.activity, ...overrides.stores.activity };
    }
  }

  const deps = {
    express,
    log: overrides.log || noopLog,
    userAuth:
      overrides.userAuth ||
      ((req: any, _res: any, next: any) => {
        req.user = { userId: 'user-1', username: 'testuser' };
        next();
      }),
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s: any) => (typeof s === 'string' ? s.trim() : '')),
    createOpaqueId: overrides.createOpaqueId || mock.fn(() => 'mp-new-1'),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) =>
      res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || (() => (_req: any, _res: any, next: any) => next()),
    validate:
      overrides.validate ||
      (() => (req: any, _res: any, next: any) => {
        req.validatedBody = req.body;
        next();
      }),
    validateParams:
      overrides.validateParams ||
      (() => (req: any, _res: any, next: any) => {
        req.validatedParams = req.params;
        next();
      }),
    schemas: {
      crewIdParams: {},
      crewIdMpIdParams: {},
      crewHomeBase: {},
      meetingPointCreate: {},
      meetingPointUpdate: {},
      meetingPointComing: {},
    },
    io: overrides.io !== undefined ? overrides.io : ioObj,
    emitter: { crewActivityLogged: mock.fn(() => {}) },
    crewNotify: overrides.crewNotify,
    stores,
  };

  return deps;
}

async function buildApp(overrides: any = {}) {
  const deps = makeDeps(overrides);
  const { default: createRoutes } = await import('../routes/crew-meeting-points.js');
  // The factory now takes a typed RouteDeps; the test supplies a purpose-built
  // partial mock, so cast through `any` at the boundary.
  const router = createRoutes(deps as any);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  PUT /:crewId/home-base -- set crew home base (owner only)
// =====================================================================
describe('routes/crew-meeting-points.js -- PUT /:crewId/home-base', () => {
  test('factory returns an Express router', async () => {
    const { app } = await buildApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('owner can set home base location and time', async () => {
    const updateHomeBase = mock.fn(async () => ({
      id: 'crew-1',
      homeBaseLocation: 'Gate A',
      homeBaseTime: '3pm',
    }));
    const { app, deps } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase,
        },
      },
    });

    const res = await request(app).put('/crew-1/home-base').send({ location: 'Gate A', time: '3pm' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.ok(res.body.data.crew);
    assert.equal(updateHomeBase.mock.calls.length, 1);
    assert.equal((updateHomeBase.mock.calls as any[])[0].arguments[0], 'crew-1');
    assert.deepEqual((updateHomeBase.mock.calls as any[])[0].arguments[1], {
      location: 'Gate A',
      time: '3pm',
      planB: undefined,
    });
  });

  test('broadcasts crew:home-base-updated via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1' })),
        },
      },
    });

    await request(app).put('/crew-1/home-base').send({ location: 'Gate A', time: '3pm' });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:home-base-updated');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], {
      crewId: 'crew-1',
      location: 'Gate A',
      time: '3pm',
      planB: null,
    });
  });

  test('logs activity after setting home base', async () => {
    const activityLog = mock.fn(async () => {});
    const { app, deps } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1' })),
        },
        activity: { log: activityLog },
      },
    });

    await request(app).put('/crew-1/home-base').send({ location: 'Gate A', time: '3pm' });

    assert.equal(activityLog.mock.calls.length, 1);
    const logArg = (activityLog.mock.calls as any[])[0].arguments[0];
    assert.equal(logArg.crewId, 'crew-1');
    assert.equal(logArg.userId, 'user-1');
    assert.equal(logArg.type, 'home-base-updated');
    assert.equal(logArg.detail, 'Gate A');
    // The same write broadcasts crew:activity so the feed refreshes live.
    const activityEmit = (deps.emitter.crewActivityLogged as any).mock.calls;
    assert.equal(activityEmit.length, 1);
    assert.equal(activityEmit[0].arguments[0].crewId, 'crew-1');
    assert.equal(activityEmit[0].arguments[0].item.type, 'home-base-updated');
  });

  // ── Permission checks ─────────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).put('/crew-1/home-base').send({ location: 'Gate A' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a crew member/);
  });

  test('returns 403 when user is a member but not owner', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
      },
    });

    const res = await request(app).put('/crew-1/home-base').send({ location: 'Gate A' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only owner/);
  });

  // ── Edge cases ────────────────────────────────────────────────────
  test('allows setting home base with null location', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1' })),
        },
      },
    });

    const res = await request(app).put('/crew-1/home-base').send({ location: null, time: null });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  test('activity log detail is null when location is falsy', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          updateHomeBase: mock.fn(async () => ({ id: 'crew-1' })),
        },
        activity: { log: activityLog },
      },
    });

    await request(app).put('/crew-1/home-base').send({ time: '3pm' });

    assert.equal((activityLog.mock.calls as any[])[0].arguments[0].detail, null);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).put('/crew-1/home-base').send({ location: 'Gate A' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  GET /:crewId/meeting-points -- list meeting points
// =====================================================================
describe('routes/crew-meeting-points.js -- GET /:crewId/meeting-points', () => {
  test('returns meeting points for crew member', async () => {
    const points = [{ ...DEFAULT_MEETING_POINT }, { ...DEFAULT_MEETING_POINT, id: 'mp-2', label: 'Ferris Wheel' }];
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            listByCrew: mock.fn(async () => points),
          },
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.meetingPoints.length, 2);
    assert.equal(res.body.data.meetingPoints[0].id, 'mp-1');
    assert.equal(res.body.data.meetingPoints[1].id, 'mp-2');
  });

  test('returns empty array when crew has no meeting points', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            listByCrew: mock.fn(async () => []),
          },
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.meetingPoints, []);
  });

  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

describe('routes/crew-meeting-points.js -- GET /:crewId/meeting-points/past', () => {
  test('returns recently expired points for a crew member', async () => {
    const listRecentlyExpired = mock.fn(async () => [{ ...DEFAULT_MEETING_POINT, id: 'mp-old' }]);
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: { listRecentlyExpired },
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points/past');

    assert.equal(res.status, 200);
    assert.equal(res.body.data.meetingPoints.length, 1);
    assert.equal(res.body.data.meetingPoints[0].id, 'mp-old');
    assert.equal((listRecentlyExpired.mock.calls as any[])[0].arguments[0], 'crew-1');
  });

  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildApp({
      stores: { crews: { getMember: mock.fn(async () => null) } },
    });

    const res = await request(app).get('/crew-1/meeting-points/past');

    assert.equal(res.status, 403);
  });

  test('returns 500 on store error', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            listRecentlyExpired: mock.fn(async () => {
              throw new Error('db down');
            }),
          },
        },
      },
    });

    const res = await request(app).get('/crew-1/meeting-points/past');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/meeting-points -- create meeting point
// =====================================================================
describe('routes/crew-meeting-points.js -- POST /:crewId/meeting-points', () => {
  test('creates meeting point for crew member', async () => {
    const createFn = mock.fn(async (data: any) => ({ ...data, active: true, createdAt: '2026-05-08T00:00:00.000Z' }));
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Main Stage', location: 'Left side', type: 'during' });

    assert.equal(res.status, 201);
    assert.equal(res.body.error, null);
    assert.ok(res.body.data.meetingPoint);
    assert.equal(res.body.data.meetingPoint.label, 'Main Stage');
    assert.equal(res.body.data.meetingPoint.crewId, 'crew-1');
    assert.equal(res.body.data.meetingPoint.createdBy, 'user-1');
    assert.equal(createFn.mock.calls.length, 1);
  });

  test('uses createOpaqueId to generate meeting point id', async () => {
    const createOpaqueId = mock.fn(() => 'mp-generated');
    const createFn = mock.fn(async (data: any) => data);
    const { app } = await buildApp({
      createOpaqueId,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app).post('/crew-1/meeting-points').send({ label: 'Test', location: 'Here' });

    assert.equal((createOpaqueId.mock.calls as any[])[0].arguments[0], 'mp');
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].id, 'mp-generated');
  });

  test('defaults type to during when not provided', async () => {
    const createFn = mock.fn(async (data: any) => data);
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app).post('/crew-1/meeting-points').send({ label: 'Test', location: 'Here' });

    assert.equal((createFn.mock.calls as any[])[0].arguments[0].type, 'during');
  });

  test('calculates expiresAt as meetAt + 30 minutes when meetAt is provided', async () => {
    const createFn = mock.fn(async (data: any) => data);
    const meetAt = '2026-06-15T14:00:00.000Z';
    const expectedExpiry = new Date(new Date(meetAt).getTime() + 30 * 60_000).toISOString();

    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app).post('/crew-1/meeting-points').send({ label: 'Test', location: 'Here', meetAt });

    assert.equal((createFn.mock.calls as any[])[0].arguments[0].expiresAt, expectedExpiry);
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].meetAt, meetAt);
  });

  // 055: a recurring point must NOT auto-expire, even with a meetAt — otherwise
  // expireStale() would deactivate it after the first occurrence.
  test('leaves expiresAt null for a recurring point even when meetAt is provided', async () => {
    const createFn = mock.fn(async (data: any) => data);
    const meetAt = '2026-06-15T14:00:00.000Z';

    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Tree', location: 'North', meetAt, recursDaily: true });

    assert.equal((createFn.mock.calls as any[])[0].arguments[0].expiresAt, null);
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].recursDaily, true);
  });

  // 055: daily recurrence flag threads through to the store on create.
  test('threads 055 recursDaily through to meetingPoints.create', async () => {
    const createFn = mock.fn(async (data: any) => ({ ...data, active: true }));
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app).post('/crew-1/meeting-points').send({ label: 'Tree', location: 'North', recursDaily: true });

    assert.equal((createFn.mock.calls as any[])[0].arguments[0].recursDaily, true);
  });

  test('defaults recursDaily to false when omitted on create', async () => {
    const createFn = mock.fn(async (data: any) => data);
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app).post('/crew-1/meeting-points').send({ label: 'Test', location: 'Here' });

    assert.equal((createFn.mock.calls as any[])[0].arguments[0].recursDaily, false);
  });

  test('sets expiresAt to null when meetAt is not provided', async () => {
    const createFn = mock.fn(async (data: any) => data);
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            create: createFn,
          },
        },
      },
    });

    await request(app).post('/crew-1/meeting-points').send({ label: 'Test', location: 'Here' });

    assert.equal((createFn.mock.calls as any[])[0].arguments[0].expiresAt, null);
  });

  test('broadcasts crew:meeting-point-created via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 0),
            // The real store returns the snake_case DB row, not the camelCase
            // argument — the emitted payload IS that row (lib/db/stores/crews.ts).
            create: mock.fn(async (data: any) => ({
              ...DEFAULT_MEETING_POINT,
              id: data.id,
              label: data.label,
              location: data.location,
            })),
          },
        },
      },
    });

    await request(app).post('/crew-1/meeting-points').send({ label: 'Stage B', location: 'Right side' });

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:meeting-point-created');
    const created = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(created.crew_id, 'crew-1');
    assert.equal(created.crewId, undefined, 'payload is the raw row; no camelCase duplicate');
  });

  // ── Max limit ─────────────────────────────────────────────────────
  test('returns 400 when max meeting points limit is reached', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            countByCrew: mock.fn(async () => 20),
          },
        },
      },
    });

    const res = await request(app).post('/crew-1/meeting-points').send({ label: 'One more', location: 'Nope' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.match(res.body.error.message, /Maximum 20/);
  });

  // ── Permission checks ─────────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).post('/crew-1/meeting-points').send({ label: 'Test', location: 'Here' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).post('/crew-1/meeting-points').send({ label: 'Test', location: 'Here' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  PUT /:crewId/meeting-points/:mpId -- update meeting point
// =====================================================================
describe('routes/crew-meeting-points.js -- PUT /:crewId/meeting-points/:mpId', () => {
  test('creator can update their own meeting point', async () => {
    const updateFn = mock.fn(async (id: any, data: any) => ({ ...DEFAULT_MEETING_POINT, ...data, id }));
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            update: updateFn,
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Updated Label' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.meetingPoint.label, 'Updated Label');
    assert.equal((updateFn.mock.calls as any[])[0].arguments[0], 'mp-1');
  });

  // 055: recurs_daily toggle flows through the body to meetingPoints.update.
  test('threads 055 recursDaily through to meetingPoints.update', async () => {
    const updateFn = mock.fn(async (id: any, data: any) => ({ ...DEFAULT_MEETING_POINT, ...data, id }));
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            update: updateFn,
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ recursDaily: true });

    assert.equal(res.status, 200);
    assert.equal((updateFn.mock.calls as any[])[0].arguments[1].recursDaily, true);
  });

  // 055/056 regression: the PUT handler must recompute expires_at from the
  // effective (post-merge) meetAt + recurrence, or an edit strands a stale
  // expiry and the expireStale() sweep deactivates the point at the wrong time.
  test('toggling a timed one-shot point to recurring clears expires_at', async () => {
    const updateFn = mock.fn(async (id: any, data: any) => ({ ...DEFAULT_MEETING_POINT, ...data, id }));
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({
              ...DEFAULT_MEETING_POINT,
              meet_at: '2026-06-15T14:00:00.000Z',
              recurs_daily: false,
              expires_at: '2026-06-15T14:30:00.000Z',
            })),
            update: updateFn,
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ recursDaily: true });

    assert.equal(res.status, 200);
    assert.equal((updateFn.mock.calls as any[])[0].arguments[1].expiresAt, null);
  });

  test('editing meetAt on a one-shot point recomputes expires_at to newMeetAt + 30min', async () => {
    const updateFn = mock.fn(async (id: any, data: any) => ({ ...DEFAULT_MEETING_POINT, ...data, id }));
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({
              ...DEFAULT_MEETING_POINT,
              meet_at: '2026-06-15T14:00:00.000Z',
              recurs_daily: false,
              expires_at: '2026-06-15T14:30:00.000Z',
            })),
            update: updateFn,
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ meetAt: '2026-06-15T20:00:00.000Z' });

    assert.equal(res.status, 200);
    assert.equal((updateFn.mock.calls as any[])[0].arguments[1].expiresAt, '2026-06-15T20:30:00.000Z');
  });

  test('a label-only edit on a recurring point keeps expires_at null', async () => {
    const updateFn = mock.fn(async (id: any, data: any) => ({ ...DEFAULT_MEETING_POINT, ...data, id }));
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({
              ...DEFAULT_MEETING_POINT,
              meet_at: '2026-06-15T15:00:00.000Z',
              recurs_daily: true,
              expires_at: null,
            })),
            update: updateFn,
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Tree (north)' });

    assert.equal(res.status, 200);
    assert.equal((updateFn.mock.calls as any[])[0].arguments[1].expiresAt, null);
  });

  test('crew owner can update any meeting point', async () => {
    const mpByOtherUser = { ...DEFAULT_MEETING_POINT, created_by: 'user-2' };
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          meetingPoints: {
            getById: mock.fn(async () => mpByOtherUser),
            update: mock.fn(async (id: any, data: any) => ({ ...mpByOtherUser, ...data, id })),
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Owner Edit' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  test('broadcasts crew:meeting-point-updated via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            update: mock.fn(async (id: any, data: any) => ({ ...DEFAULT_MEETING_POINT, ...data, id })),
          },
        },
      },
    });

    await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Updated' });

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:meeting-point-updated');
    const updatedPayload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(updatedPayload.crew_id, 'crew-1');
    assert.equal(updatedPayload.crewId, undefined, 'payload is the raw row; no camelCase duplicate');
  });

  // ── Not found cases ───────────────────────────────────────────────
  test('returns 404 when meeting point does not exist', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => null),
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-nonexistent').send({ label: 'Updated' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 404 when meeting point belongs to different crew', async () => {
    const mpFromOtherCrew = { ...DEFAULT_MEETING_POINT, crew_id: 'crew-other' };
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => mpFromOtherCrew),
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Updated' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 404 when meeting point is inactive', async () => {
    const inactiveMp = { ...DEFAULT_MEETING_POINT, active: false };
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => inactiveMp),
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Updated' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Permission checks ─────────────────────────────────────────────
  test('returns 403 when non-creator non-owner tries to update', async () => {
    const mpByOtherUser = { ...DEFAULT_MEETING_POINT, created_by: 'user-2' };
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => mpByOtherUser),
          },
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Updated' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /creator or crew owner/);
  });

  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Updated' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'Updated' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  DELETE /:crewId/meeting-points/:mpId -- deactivate meeting point
// =====================================================================
describe('routes/crew-meeting-points.js -- DELETE /:crewId/meeting-points/:mpId', () => {
  test('creator can delete their own meeting point', async () => {
    const deactivateFn = mock.fn(async () => {});
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            deactivate: deactivateFn,
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.removed, true);
    assert.equal(deactivateFn.mock.calls.length, 1);
    assert.equal((deactivateFn.mock.calls as any[])[0].arguments[0], 'mp-1');
  });

  test('crew owner can delete any meeting point', async () => {
    const mpByOther = { ...DEFAULT_MEETING_POINT, created_by: 'user-2' };
    const deactivateFn = mock.fn(async () => {});
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          meetingPoints: {
            getById: mock.fn(async () => mpByOther),
            deactivate: deactivateFn,
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.data.removed, true);
    assert.equal(deactivateFn.mock.calls.length, 1);
  });

  test('broadcasts crew:meeting-point-removed via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            deactivate: mock.fn(async () => {}),
          },
        },
      },
    });

    await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:meeting-point-removed');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], { id: 'mp-1', crewId: 'crew-1' });
  });

  test('returns 404 when meeting point does not exist', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => null),
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-nonexistent');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 404 when meeting point belongs to different crew', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, crew_id: 'crew-other' })),
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 404 when meeting point is already inactive', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, active: false })),
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 403 when non-creator non-owner tries to delete', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, created_by: 'user-2' })),
          },
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /creator or crew owner/);
  });

  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  test('returns 500 on internal error', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => {
            throw new Error('db down');
          }),
        },
      },
    });

    const res = await request(app).delete('/crew-1/meeting-points/mp-1');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

describe('routes/crew-meeting-points.js -- feed rows and pushes', () => {
  const member = { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) };
  const mkNotify = () => ({ now: mock.fn(async () => {}) });
  const mkLog = () => mock.fn(async () => 'act-1');

  test('create writes meeting-point-added and pushes now with key mp:<id>', async () => {
    const log = mkLog();
    const crewNotify = mkNotify();
    const { app } = await buildApp({ crewNotify, stores: { crews: member, activity: { log } } });
    const res = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'Main Stage', location: 'Left', meetAt: '2026-05-08T20:00:00.000Z' });
    assert.equal(res.status, 201);
    assert.equal((log.mock.calls as any[])[0].arguments[0].type, 'meeting-point-added');
    assert.equal((log.mock.calls as any[])[0].arguments[0].detail, 'Main Stage');
    const push = (crewNotify.now.mock.calls as any[])[0].arguments[0];
    assert.equal(push.key, 'mp:mp-new-1');
    assert.equal(push.actorId, 'user-1');
    assert.equal(push.text, 'testuser set a meeting point: Main Stage');
  });

  test('update of only the label writes a row and does not push', async () => {
    const log = mkLog();
    const crewNotify = mkNotify();
    const { app } = await buildApp({
      crewNotify,
      stores: {
        crews: { ...member, meetingPoints: { getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })) } },
        activity: { log },
      },
    });
    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ label: 'New name' });
    assert.equal(res.status, 200);
    assert.equal((log.mock.calls as any[])[0].arguments[0].type, 'meeting-point-updated');
    assert.equal((log.mock.calls as any[])[0].arguments[0].detail, 'New name');
    assert.equal(crewNotify.now.mock.calls.length, 0);
  });

  test('update that resends the same meetAt (stored as a Date) does not push', async () => {
    const crewNotify = mkNotify();
    const { app } = await buildApp({
      crewNotify,
      stores: {
        crews: {
          ...member,
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, meet_at: new Date('2026-05-08T21:00:00.000Z') })),
          },
        },
      },
    });
    const res = await request(app)
      .put('/crew-1/meeting-points/mp-1')
      .send({ label: 'New name', meetAt: '2026-05-08T21:00:00.000Z' });
    assert.equal(res.status, 200);
    assert.equal(crewNotify.now.mock.calls.length, 0);
  });

  test('update that changes meetAt pushes', async () => {
    const crewNotify = mkNotify();
    const { app } = await buildApp({
      crewNotify,
      stores: {
        crews: { ...member, meetingPoints: { getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })) } },
      },
    });
    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ meetAt: '2026-05-08T21:00:00.000Z' });
    assert.equal(res.status, 200);
    const push = (crewNotify.now.mock.calls as any[])[0].arguments[0];
    assert.equal(push.key, 'mp-move:mp-1:2026-05-08T21:00:00.000Z:Near the food trucks::');
    assert.equal(push.meetAt, '2026-05-08T21:00:00.000Z');
    assert.equal(push.userIds, undefined, 'no taps: the whole crew hears about the move');
    assert.match(push.text, /^testuser moved .+ to$/);
  });

  test('delete writes meeting-point-removed', async () => {
    const log = mkLog();
    const { app } = await buildApp({
      stores: {
        crews: { ...member, meetingPoints: { getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })) } },
        activity: { log },
      },
    });
    const res = await request(app).delete('/crew-1/meeting-points/mp-1');
    assert.equal(res.status, 200);
    const row = (log.mock.calls as any[])[0].arguments[0];
    assert.equal(row.type, 'meeting-point-removed');
    assert.equal(row.detail, DEFAULT_MEETING_POINT.label);
  });

  test('responses do not wait for a slow push, and a failing push is logged', async () => {
    const never = new Promise<void>(() => {});
    const slow = { now: mock.fn(() => never) };
    const stores = {
      crews: {
        ...member,
        meetingPoints: {
          getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, coming: ['user-2'] })),
        },
      },
    };
    const { app } = await buildApp({ crewNotify: slow, stores });
    const created = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'A', location: 'B', meetAt: '2026-05-08T20:00:00.000Z' });
    const updated = await request(app).put('/crew-1/meeting-points/mp-1').send({ meetAt: '2026-05-08T21:00:00.000Z' });
    const removed = await request(app).delete('/crew-1/meeting-points/mp-1');
    assert.deepEqual([created.status, updated.status, removed.status], [201, 200, 200]);
    assert.equal(slow.now.mock.callCount(), 3);

    const warn = mock.fn();
    const failing = { now: mock.fn(async () => Promise.reject(new Error('push down'))) };
    const failed = await buildApp({ crewNotify: failing, stores, log: { warn } });
    const res = await request(failed.app)
      .post('/crew-1/meeting-points')
      .send({ label: 'A', location: 'B', meetAt: '2026-05-08T20:00:00.000Z' });
    assert.equal(res.status, 201);
    await new Promise((r) => setImmediate(r));
    assert.equal(warn.mock.callCount(), 1);
  });

  test('missing crewNotify still returns 201 and 200', async () => {
    const { app } = await buildApp({
      stores: {
        crews: { ...member, meetingPoints: { getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })) } },
      },
    });
    const created = await request(app)
      .post('/crew-1/meeting-points')
      .send({ label: 'A', location: 'B', meetAt: '2026-05-08T20:00:00.000Z' });
    assert.equal(created.status, 201);
    const updated = await request(app).put('/crew-1/meeting-points/mp-1').send({ location: 'Elsewhere' });
    assert.equal(updated.status, 200);
  });
});

describe("routes/crew-meeting-points.js -- I'll be there alerts", () => {
  const member = { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) };
  const mkNotify = () => ({ now: mock.fn(async () => {}) });
  const tapped = (coming: string[]) => mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, coming }));

  test('a move with two tappers targets those two', async () => {
    const crewNotify = mkNotify();
    const { app } = await buildApp({
      crewNotify,
      stores: { crews: { ...member, meetingPoints: { getById: tapped(['user-2', 'user-3']) } } },
    });
    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ location: 'Gate B' });
    assert.equal(res.status, 200);
    const push = (crewNotify.now.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(push.userIds, ['user-2', 'user-3']);
    assert.equal(push.key, 'mp-move:mp-1::Gate B::');
  });

  test('a cancel with tappers pushes "cancelled" to them only', async () => {
    const crewNotify = mkNotify();
    const { app } = await buildApp({
      crewNotify,
      stores: { crews: { ...member, meetingPoints: { getById: tapped(['user-2']) } } },
    });
    const res = await request(app).delete('/crew-1/meeting-points/mp-1');
    assert.equal(res.status, 200);
    const push = (crewNotify.now.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(push.userIds, ['user-2']);
    assert.equal(push.key, 'mp-cancel:mp-1');
    assert.equal(push.text, 'testuser cancelled Main Stage Left');
    assert.equal(push.actorId, 'user-1');
  });

  test('a cancel with no tappers pushes nothing', async () => {
    const crewNotify = mkNotify();
    const { app } = await buildApp({
      crewNotify,
      stores: { crews: { ...member, meetingPoints: { getById: tapped([]) } } },
    });
    const res = await request(app).delete('/crew-1/meeting-points/mp-1');
    assert.equal(res.status, 200);
    assert.equal(crewNotify.now.mock.callCount(), 0);
  });

  test('two different moves inside 2 minutes both push; the same move twice pushes once', async () => {
    const send = mock.fn(async () => ({ sent: 1 }));
    const crewNotify = createCrewNotifier({
      stores: {
        crews: {
          getById: async () => ({ id: 'crew-1', name: 'Crew' }),
          getMembers: async () => [{ userId: 'user-1' }, { userId: 'user-2' }, { userId: 'user-3' }],
        },
        notificationPrefs: { get: async () => null },
        pool: { query: async () => ({ rows: [{ time_zone: 'UTC' }] }) },
      },
      notificationService: { isConfigured: true, send },
      log: noopLog,
    });
    const { app } = await buildApp({
      crewNotify,
      stores: { crews: { ...member, meetingPoints: { getById: tapped(['user-2']) } } },
    });
    await request(app).put('/crew-1/meeting-points/mp-1').send({ meetAt: '2026-05-08T21:00:00.000Z' });
    await request(app).put('/crew-1/meeting-points/mp-1').send({ meetAt: '2026-05-08T22:00:00.000Z' });
    assert.equal(send.mock.callCount(), 2);
    await request(app).put('/crew-1/meeting-points/mp-1').send({ meetAt: '2026-05-08T22:00:00.000Z' });
    assert.equal(send.mock.callCount(), 2, 'the repeat of the same move is deduped');
    const userIds = (send.mock.calls as any[]).map((c) => c.arguments[0].userId);
    assert.deepEqual(userIds, ['user-2', 'user-2']);
  });
});

describe('routes/crew-meeting-points.js -- PUT /:crewId/meeting-points/:mpId/coming', () => {
  const member = { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) };
  const active = () => mock.fn(async () => ({ ...DEFAULT_MEETING_POINT }));

  test('true taps me in, emits meeting-point-updated, and does not push or log', async () => {
    const ioObj = makeIo();
    const crewNotify = { now: mock.fn(async () => {}) };
    const log = mock.fn(async () => {});
    const { app, deps } = await buildApp({
      io: ioObj,
      crewNotify,
      stores: { crews: { ...member, meetingPoints: { getById: active() } }, activity: { log } },
    });
    const res = await request(app).put('/crew-1/meeting-points/mp-1/coming').send({ coming: true });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.meetingPoint.coming, ['user-1']);
    const args = (deps.stores.crews.meetingPoints.setComing.mock.calls as any[])[0].arguments;
    assert.deepEqual(args, ['mp-1', 'crew-1', 'user-1', true]);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:meeting-point-updated');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1].coming, ['user-1']);
    assert.equal(crewNotify.now.mock.callCount(), 0);
    assert.equal(log.mock.callCount(), 0);
  });

  test('false removes my tap', async () => {
    const { app, deps } = await buildApp({ stores: { crews: { ...member, meetingPoints: { getById: active() } } } });
    const res = await request(app).put('/crew-1/meeting-points/mp-1/coming').send({ coming: false });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.meetingPoint.coming, []);
    assert.equal((deps.stores.crews.meetingPoints.setComing.mock.calls as any[])[0].arguments[3], false);
  });

  test('an inactive point is 404', async () => {
    const { app, deps } = await buildApp({
      stores: {
        crews: {
          ...member,
          meetingPoints: { getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, active: false })) },
        },
      },
    });
    const res = await request(app).put('/crew-1/meeting-points/mp-1/coming').send({ coming: true });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.message, 'Meeting point not found');
    assert.equal(deps.stores.crews.meetingPoints.setComing.mock.callCount(), 0);
  });

  test('a point in another crew is 404', async () => {
    const { app } = await buildApp({
      stores: {
        crews: {
          ...member,
          meetingPoints: { getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, crew_id: 'crew-2' })) },
        },
      },
    });
    const res = await request(app).put('/crew-1/meeting-points/mp-1/coming').send({ coming: true });
    assert.equal(res.status, 404);
  });

  test('a non-member is 403', async () => {
    const { app, deps } = await buildApp();
    const res = await request(app).put('/crew-1/meeting-points/mp-1/coming').send({ coming: true });
    assert.equal(res.status, 403);
    assert.equal(deps.stores.crews.meetingPoints.setComing.mock.callCount(), 0);
  });
});

// =====================================================================
//  T54: Plan B on Home Base
// =====================================================================
describe('routes/crew-meeting-points.js -- Home Base Plan B', () => {
  const owner = { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })) };

  async function putHomeBase(body: any, stored: string | null) {
    const ioObj = makeIo();
    const updateHomeBase = mock.fn(async () => ({ id: 'crew-1', homeBasePlanB: stored }));
    const { app } = await buildApp({ io: ioObj, stores: { crews: { ...owner, updateHomeBase } } });
    const res = await request(app).put('/crew-1/home-base').send(body);
    assert.equal(res.status, 200);
    return {
      storeArg: (updateHomeBase.mock.calls as any[])[0].arguments[1],
      emitted: (ioObj._emit.mock.calls as any[])[0].arguments[1],
    };
  }

  test('an omitted planB reaches the store as undefined and the emit carries the kept value', async () => {
    const { storeArg, emitted } = await putHomeBase({ location: 'Gate A', time: '3pm' }, 'Top of each hour');
    assert.ok('planB' in storeArg);
    assert.equal(storeArg.planB, undefined);
    assert.equal(emitted.planB, 'Top of each hour');
  });

  test('planB null reaches the store and the emit carries null', async () => {
    const { storeArg, emitted } = await putHomeBase({ location: 'Gate A', time: '3pm', planB: null }, null);
    assert.equal(storeArg.planB, null);
    assert.equal(emitted.planB, null);
  });

  test('a Plan B text is written and broadcast', async () => {
    const { storeArg, emitted } = await putHomeBase(
      { location: 'Gate A', time: '3pm', planB: 'Top of each hour' },
      'Top of each hour',
    );
    assert.equal(storeArg.planB, 'Top of each hour');
    assert.deepEqual(emitted, { crewId: 'crew-1', location: 'Gate A', time: '3pm', planB: 'Top of each hour' });
  });

  test('removing Home Base broadcasts planB null from the stored row', async () => {
    const { storeArg, emitted } = await putHomeBase({ location: null, time: null }, null);
    assert.equal(storeArg.location, null);
    assert.equal(emitted.planB, null);
  });
});

// =====================================================================
//  T54: meeting point edit trail ("Edited by ana, was ...")
// =====================================================================
describe('routes/crew-meeting-points.js -- edit trail', () => {
  const OLD_AT = '2026-06-15T15:00:00.000Z';
  const member = { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) };

  async function put(body: any, existing: any = {}) {
    const ioObj = makeIo();
    const crewNotify = { now: mock.fn(async () => {}) };
    const update = mock.fn(async (id: any, data: any) => ({ ...DEFAULT_MEETING_POINT, ...data, id }));
    const { app } = await buildApp({
      io: ioObj,
      crewNotify,
      stores: {
        crews: {
          ...member,
          meetingPoints: { getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT, ...existing })), update },
        },
      },
    });
    const res = await request(app).put('/crew-1/meeting-points/mp-1').send(body);
    assert.equal(res.status, 200);
    return { crewNotify, data: (update.mock.calls as any[])[0].arguments[1] };
  }

  function assertNoTrail(data: any) {
    assert.equal('editedBy' in data, false);
    assert.equal('editedAt' in data, false);
    assert.equal('editWas' in data, false);
  }

  test('a rename never changes the time and writes no trail or push', async () => {
    const existing = { meet_at: new Date(OLD_AT), recurs_daily: false, expires_at: '2026-06-15T15:30:00.000Z' };
    const { data, crewNotify } = await put({ label: 'Tree (north)' }, existing);
    assert.equal('meetAt' in data, false);
    assert.equal(data.expiresAt, '2026-06-15T15:30:00.000Z');
    assertNoTrail(data);
    assert.equal(crewNotify.now.mock.calls.length, 0);
  });

  test('a time-only change writes editWas.meetAt as the old ISO instant', async () => {
    const { data } = await put({ meetAt: '2026-06-15T20:00:00.000Z' }, { meet_at: new Date(OLD_AT) });
    assert.equal(data.editedBy, 'user-1');
    assert.ok(!Number.isNaN(Date.parse(data.editedAt)));
    assert.deepEqual(data.editWas, { meetAt: OLD_AT });
  });

  test('a place-only change writes editWas.location as the old text', async () => {
    const { data } = await put({ location: 'North gate' });
    assert.equal(data.editedBy, 'user-1');
    assert.deepEqual(data.editWas, { location: 'Near the food trucks' });
  });

  test('a time and place change writes both keys', async () => {
    const { data } = await put({ location: 'North gate', meetAt: '2026-06-15T20:00:00.000Z' }, { meet_at: OLD_AT });
    assert.deepEqual(data.editWas, { location: 'Near the food trucks', meetAt: OLD_AT });
  });

  test('clearing the time writes the old time', async () => {
    const { data } = await put({ meetAt: null }, { meet_at: new Date(OLD_AT) });
    assert.deepEqual(data.editWas, { meetAt: OLD_AT });
  });

  test('setting a time on a point with none writes meetAt null', async () => {
    const { data } = await put({ meetAt: '2026-06-15T20:00:00.000Z' }, { meet_at: null });
    assert.deepEqual(data.editWas, { meetAt: null });
  });

  test('a coordinate-only change writes no trail but still pushes', async () => {
    const { data, crewNotify } = await put({ latitude: 28.5, longitude: -81.4 }, { latitude: 28.4, longitude: -81.3 });
    assertNoTrail(data);
    assert.equal(crewNotify.now.mock.calls.length, 1);
  });

  test('re-sending the same time and place writes no trail', async () => {
    const { data, crewNotify } = await put(
      { label: 'Renamed', location: 'Near the food trucks', meetAt: OLD_AT, recursDaily: false },
      { meet_at: new Date(OLD_AT) },
    );
    assertNoTrail(data);
    assert.equal(crewNotify.now.mock.calls.length, 0);
  });

  test('the response and the emit carry the store row unchanged', async () => {
    const row = {
      ...DEFAULT_MEETING_POINT,
      location: 'North gate',
      edited_by: 'user-1',
      edited_at: '2026-06-15T19:00:00.000Z',
      edit_was: { location: 'Near the food trucks' },
      editor_name: 'ana',
    };
    const ioObj = makeIo();
    const { app } = await buildApp({
      io: ioObj,
      stores: {
        crews: {
          ...member,
          meetingPoints: {
            getById: mock.fn(async () => ({ ...DEFAULT_MEETING_POINT })),
            update: mock.fn(async () => row),
          },
        },
      },
    });
    const res = await request(app).put('/crew-1/meeting-points/mp-1').send({ location: 'North gate' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.meetingPoint, row);
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[1], row);
  });
});
