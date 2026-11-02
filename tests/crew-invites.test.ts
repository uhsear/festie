/**
 * Mock-based route tests for routes/crew-invites.js
 *
 * Covers: POST /join, POST /:crewId/invite, GET /join/:inviteCode (301)
 * Mounts the route factory on a minimal Express app with fully stubbed deps.
 * No database required — all stores are mock.fn() stubs.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';

// ── Shared helpers ───────────────────────────────────────────────────

function noop() {}
const noopLog = { info: noop, warn: noop, error: noop, debug: noop };
const DAY_MS = 24 * 60 * 60 * 1000;

function makeIo() {
  const emitFn = mock.fn(() => {});
  return {
    to: mock.fn(() => ({ emit: emitFn })),
    _emit: emitFn,
  };
}

const DEFAULT_CREW = {
  id: 'crew-1',
  festivalId: 'fest-1',
  name: 'Test Crew',
  createdBy: 'owner-1',
  maxMembers: 10,
  inviteCode: 'ABC123',
  inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const DEFAULT_MEMBERS = [
  { userId: 'owner-1', username: 'crewowner', role: 'owner', joinedAt: '2026-01-01' },
];

/**
 * Build a deps object tailored for crew-invites.js.
 * The route is mounted as a sub-router of crews.js so it needs _crewHelpers.
 */
function makeInviteDeps(overrides: any = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getById: mock.fn(async () => null),
      getByInviteCode: mock.fn(async () => null),
      getExpiredByInviteCode: mock.fn(async () => null),
      listByUserAndFestival: mock.fn(async () => []),
      getMembers: mock.fn(async () => [...DEFAULT_MEMBERS]),
      getMember: mock.fn(async () => null),
      getMemberCount: mock.fn(async () => 1),
      addMember: mock.fn(async () => {}),
      regenerateInviteCode: mock.fn(async () => {}),
    },
    profiles: {
      readByUserAndFestival: mock.fn(async () => ({ id: 'prof-1', userId: 'user-1' })),
      claimOrphan: mock.fn(async () => null),
      countByFestival: mock.fn(async () => 0),
      create: mock.fn(async (p: any) => p),
    },
  };

  // Deep-merge stores
  const stores: any = { ...storesBase };
  if (overrides.stores) {
    stores.crews = { ...storesBase.crews, ...overrides.stores.crews };
    stores.profiles = { ...storesBase.profiles, ...overrides.stores.profiles };
  }
  stores.activity = overrides.activity || { log: mock.fn(async () => 'act-1') };

  // resolveCrewOwnership mock — returns { crew, membership } by default
  const resolveCrewOwnership = overrides.resolveCrewOwnership || mock.fn(async (_res: any, crewId: any) => {
    const crew = await stores.crews.getById(crewId);
    if (!crew) return null;
    return { crew, membership: { role: 'owner' } };
  });

  const serializeCrewWithMembers = overrides.serializeCrewWithMembers || ((crew: any, members: any, requestingUserId: any) => {
    const membership = members.find((m: any) => m.userId === requestingUserId);
    return {
      id: crew.id,
      festivalId: crew.festivalId,
      name: crew.name,
      createdBy: crew.createdBy,
      maxMembers: crew.maxMembers,
      role: membership?.role || 'member',
      members: members.map((m: any) => ({
        userId: m.userId,
        username: m.username,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      memberCount: members.length,
    };
  });

  const deps = {
    express,
    config: { NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000', MAX_PROFILES_PER_FESTIVAL: 100 },
    log: noopLog,
    // ensureFestivalProfile (lib/festival-profile.ts) reads these.
    getUserFestivalProfile: overrides.getUserFestivalProfile || mock.fn(async () => ({ id: 'prof-1', userId: 'user-1' })),
    getUserById: mock.fn(async (id: any) => ({ id, username: 'testuser' })),
    getProfiles: mock.fn(async () => []),
    createOpaqueId: (prefix: any) => `${prefix}-new`,
    emitter: { profileCreated: mock.fn() },
    userAuth: overrides.userAuth || ((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', username: 'testuser' };
      next();
    }),
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s: any, _max?: any) => (typeof s === 'string' ? s.trim() : '')),
    getFestivalById: overrides.getFestivalById || mock.fn(async (id: any) => ({ id, name: 'Test Festival' })),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      MAX_LIMIT_REACHED: 'MAX_LIMIT_REACHED',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || (() => (_req: any, _res: any, next: any) => next()),
    validate: overrides.validate || (() => (req: any, _res: any, next: any) => { req.validatedBody = req.body; next(); }),
    validateParams: overrides.validateParams || (() => (req: any, _res: any, next: any) => { req.validatedParams = req.params; next(); }),
    schemas: { crewJoin: {}, crewIdParams: {} },
    io: overrides.io !== undefined ? overrides.io : ioObj,
    crewNotify: overrides.crewNotify,
    stores,
    _crewHelpers: {
      resolveCrewOwnership,
      serializeCrewWithMembers,
      MAX_CREWS_PER_USER_PER_FESTIVAL: overrides.maxCrewsPerUser || 3,
    },
  };

  return deps;
}

async function buildInviteApp(overrides: any = {}) {
  const deps = makeInviteDeps(overrides);
  const { default: createCrewInviteRoutes } = await import('../routes/crew-invites.js');
  const router = createCrewInviteRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  POST /join — Join a crew via invite code
// =====================================================================
describe('routes/crew-invites.js — POST /join', () => {

  test('factory returns an Express router', async () => {
    const { app } = await buildInviteApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('joins crew successfully with valid invite code', async () => {
    const addMember = mock.fn(async () => {});
    const newMembers = [
      ...DEFAULT_MEMBERS,
      { userId: 'user-1', username: 'testuser', role: 'member', joinedAt: '2026-05-08' },
    ];
    const { app, deps } = await buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember,
          getMembers: mock.fn(async () => newMembers),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.id, 'crew-1');
    assert.equal(res.body.data.memberCount, 2);
    assert.equal(addMember.mock.calls.length, 1);
    assert.equal((addMember.mock.calls as any[])[0].arguments[0].crewId, 'crew-1');
    assert.equal((addMember.mock.calls as any[])[0].arguments[0].userId, 'user-1');
    assert.equal((addMember.mock.calls as any[])[0].arguments[0].role, 'member');
  });

  test('normalizes invite code to uppercase and trims whitespace', async () => {
    const getByInviteCode = mock.fn(async (code: any) => {
      if (code === 'ABC123') return { ...DEFAULT_CREW };
      return null;
    });
    const { app } = await buildInviteApp({
      stores: {
        crews: {
          getByInviteCode,
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember: mock.fn(async () => {}),
          getMembers: mock.fn(async () => DEFAULT_MEMBERS),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: '  abc123  ' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal((getByInviteCode.mock.calls as any[])[0].arguments[0], 'ABC123');
  });

  test('emits crew:member-joined via Socket.IO on success', async () => {
    const ioObj = makeIo();
    const { app } = await buildInviteApp({
      io: ioObj,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember: mock.fn(async () => {}),
          getMembers: mock.fn(async () => DEFAULT_MEMBERS),
        },
      },
    });

    await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal(ioObj._emit.mock.calls.length, 1);
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:member-joined');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], {
      crewId: 'crew-1',
      userId: 'user-1',
      username: 'testuser',
    });
  });

  // ── Invalid / expired invite codes ────────────────────────────────
  test('returns 404 for non-existent invite code', async () => {
    const { app } = await buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
          getExpiredByInviteCode: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'BADCODE' });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.match(res.body.error.message, /Invalid invite code/i);
  });

  test('returns 410 for expired invite code', async () => {
    const { app } = await buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
          getExpiredByInviteCode: mock.fn(async () => ({
            ...DEFAULT_CREW,
            inviteExpiresAt: '2025-01-01T00:00:00.000Z',
          })),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'EXPRD1' });

    assert.equal(res.status, 410);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'This invite has expired. Ask the crew owner for a new link.');
  });

  // ── Edge case: user has no festival profile ───────────────────────
  test('creates the profile in crew.festivalId, then joins', async () => {
    const create = mock.fn(async (p: any) => p);
    const addMember = mock.fn(async () => {});
    const { app, deps } = await buildInviteApp({
      getUserFestivalProfile: mock.fn(async () => null),
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW, festivalId: 'fest-crew' })),
          addMember,
        },
        profiles: { create },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 200);
    assert.equal(create.mock.calls.length, 1);
    const created = (create.mock.calls as any[])[0].arguments[0];
    assert.equal(created.festivalId, 'fest-crew');
    assert.equal(created.userId, 'user-1');
    assert.equal(deps.emitter.profileCreated.mock.calls.length, 1);
    assert.equal(addMember.mock.calls.length, 1);
  });

  test('returns 400 MAX_LIMIT_REACHED when the festival is at its profile cap', async () => {
    const create = mock.fn(async (p: any) => p);
    const addMember = mock.fn(async () => {});
    const { app } = await buildInviteApp({
      getUserFestivalProfile: mock.fn(async () => null),
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          addMember,
        },
        profiles: { countByFestival: mock.fn(async () => 100), create },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MAX_LIMIT_REACHED');
    assert.equal(res.body.error.message, 'This festival has reached its member limit on Festie.');
    assert.equal(create.mock.calls.length, 0);
    assert.equal(addMember.mock.calls.length, 0);
  });

  test('no profile is created when the crew is full', async () => {
    const create = mock.fn(async (p: any) => p);
    const getUserFestivalProfile = mock.fn(async () => null);
    const { app } = await buildInviteApp({
      getUserFestivalProfile,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW, maxMembers: 5 })),
          getMemberCount: mock.fn(async () => 5),
        },
        profiles: { create },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /full/i);
    assert.equal(getUserFestivalProfile.mock.calls.length, 0);
    assert.equal(create.mock.calls.length, 0);
  });

  // ── Edge case: already a member ───────────────────────────────────
  test('returns 200 + alreadyMember when the user is already in the crew', async () => {
    const ioObj = makeIo();
    const addMember = mock.fn(async () => {});
    const getUserFestivalProfile = mock.fn(async () => null);
    const { app } = await buildInviteApp({
      io: ioObj,
      getUserFestivalProfile,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
          getMembers: mock.fn(async () => [
            ...DEFAULT_MEMBERS,
            { userId: 'user-1', username: 'testuser', role: 'member', joinedAt: '2026-05-08' },
          ]),
          addMember,
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.id, 'crew-1');
    assert.equal(res.body.data.alreadyMember, true);
    assert.equal(res.body.data.memberCount, 2);
    assert.equal(addMember.mock.calls.length, 0);
    assert.equal(getUserFestivalProfile.mock.calls.length, 0);
    assert.equal(ioObj._emit.mock.calls.length, 0, 'no crew:member-joined for an existing member');
  });

  test('a fresh join has no alreadyMember flag', async () => {
    const { app } = await buildInviteApp({
      stores: { crews: { getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })) } },
    });
    const res = await request(app).post('/join').send({ inviteCode: 'ABC123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.alreadyMember, undefined);
  });

  // ── Edge case: max crews per festival ─────────────────────────────
  test('returns 400 when user has reached max crews per festival', async () => {
    const { app } = await buildInviteApp({
      maxCrewsPerUser: 3,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => [
            { id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' },
          ]),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MAX_LIMIT_REACHED');
    assert.equal(res.body.error.message, "You're already in 3 crews for this festival. Leave one to join this crew.");
  });

  // ── Edge case: crew is full ───────────────────────────────────────
  test('returns 400 when crew is full', async () => {
    const fullCrew = { ...DEFAULT_CREW, maxMembers: 5 };
    const { app } = await buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => fullCrew),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 5),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MAX_LIMIT_REACHED');
    assert.match(res.body.error.message, /full/i);
  });

  // ── Edge case: io is null (no Socket.IO) ──────────────────────────
  test('succeeds when io is null (Socket.IO disabled)', async () => {
    const { app } = await buildInviteApp({
      io: null,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember: mock.fn(async () => {}),
          getMembers: mock.fn(async () => DEFAULT_MEMBERS),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildInviteApp({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/join')
      .send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/invite — Regenerate invite code (owner only)
// =====================================================================
describe('routes/crew-invites.js — POST /:crewId/invite', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('regenerates invite code for crew owner', async () => {
    const regenerateInviteCode = mock.fn(async () => {});
    const { app } = await buildInviteApp({
      stores: {
        crews: {
          getById: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          getByInviteCode: mock.fn(async () => null),
          regenerateInviteCode,
        },
      },
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
    });

    const res = await request(app)
      .post('/crew-1/invite');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.ok(res.body.data.inviteCode);
    assert.ok(res.body.data.inviteExpiresAt);
    assert.equal(regenerateInviteCode.mock.calls.length, 1);
  });

  test('passes inviteExpiryFor(crew festival) to the store', async () => {
    const regenerateInviteCode = mock.fn(async () => {});
    const lastDay = new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10);
    const getFestivalById = mock.fn(async (id: any) => ({ id, name: 'F', days: [{ date: lastDay }] }));
    const { app } = await buildInviteApp({
      getFestivalById,
      stores: { crews: { getByInviteCode: mock.fn(async () => null), regenerateInviteCode } },
      resolveCrewOwnership: mock.fn(async () => ({ crew: { ...DEFAULT_CREW }, membership: { role: 'owner' } })),
    });

    const res = await request(app).post('/crew-1/invite');

    assert.equal(res.status, 200);
    assert.equal((getFestivalById.mock.calls as any[])[0].arguments[0], 'fest-1');
    const [, newCode, expiresAt] = (regenerateInviteCode.mock.calls as any[])[0].arguments;
    assert.equal(newCode, res.body.data.inviteCode);
    assert.ok(expiresAt instanceof Date);
    assert.equal(expiresAt.getTime(), Date.parse(`${lastDay}T00:00:00Z`) + 2 * DAY_MS);
    assert.equal(res.body.data.inviteExpiresAt, expiresAt.toISOString());
  });

  // ── Invalid crew ID ───────────────────────────────────────────────
  test('returns 400 for empty/invalid crew ID', async () => {
    const { app } = await buildInviteApp({
      sanitizeIdentifier: () => '',
    });

    const res = await request(app)
      .post('/%20/invite');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  // ── Not the owner ─────────────────────────────────────────────────
  test('returns error when user is not the crew owner', async () => {
    const { app } = await buildInviteApp({
      resolveCrewOwnership: mock.fn(async (res: any) => {
        // resolveCrewOwnership sends the error and returns null
        res.status(403).json({ data: null, error: { message: 'Only the crew owner can regenerate invite codes', status: 403, code: 'FORBIDDEN' } });
        return null;
      }),
    });

    const res = await request(app)
      .post('/crew-1/invite');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Crew not found ────────────────────────────────────────────────
  test('returns error when crew does not exist', async () => {
    const { app } = await buildInviteApp({
      resolveCrewOwnership: mock.fn(async (res: any) => {
        res.status(404).json({ data: null, error: { message: 'Crew not found', status: 404, code: 'NOT_FOUND' } });
        return null;
      }),
    });

    const res = await request(app)
      .post('/crew-nonexistent/invite');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error during regeneration', async () => {
    const { app } = await buildInviteApp({
      resolveCrewOwnership: mock.fn(async () => ({
        crew: { ...DEFAULT_CREW },
        membership: { role: 'owner' },
      })),
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/invite');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  GET /join/:inviteCode — moved to the /join/:code invite page (301)
// =====================================================================
describe('routes/crew-invites.js — GET /join/:inviteCode', () => {
  test('301s a valid code to /join/:code', async () => {
    const { app } = await buildInviteApp();
    const res = await request(app).get('/join/ABC123');
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, '/join/ABC123');
  });

  test('strips non-alphanumeric characters and caps the code at 12', async () => {
    const { app } = await buildInviteApp();
    const stripped = await request(app).get('/join/AB-C!23');
    assert.equal(stripped.headers.location, '/join/ABC23');
    const long = await request(app).get('/join/ABCDEFGHIJKLMNOP');
    assert.equal(long.headers.location, '/join/ABCDEFGHIJKL');
  });

  test('301s to / when nothing is left of the code', async () => {
    const { app } = await buildInviteApp();
    const res = await request(app).get('/join/!!!');
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, '/');
  });
});

// =====================================================================
//  Rate limiting
// =====================================================================
describe('routes/crew-invites.js — rate limiting', () => {

  test('applies rate limit middleware to POST /join', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildInviteApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
          getExpiredByInviteCode: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .post('/join')
      .send({ inviteCode: 'TEST12' });

    const joinLimit = rateLimitCalls.find((c) => c.key === 'crew-join');
    assert.ok(joinLimit, 'crew-join rate limit should be applied');
    assert.equal(joinLimit.max, 10);
  });

  test('applies rate limit middleware to POST /:crewId/invite', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildInviteApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      resolveCrewOwnership: mock.fn(async (res: any) => {
        res.status(404).json({ data: null, error: { message: 'Crew not found', status: 404, code: 'NOT_FOUND' } });
        return null;
      }),
    });

    await request(app)
      .post('/crew-1/invite');

    const inviteLimit = rateLimitCalls.find((c) => c.key === 'crew-invite');
    assert.ok(inviteLimit, 'crew-invite rate limit should be applied');
    assert.equal(inviteLimit.max, 5);
  });

  test('applies rate limit middleware to GET /join/:inviteCode', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildInviteApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .get('/join/ABCDEF');

    const pageLimit = rateLimitCalls.find((c) => c.key === 'crew-invite-page');
    assert.ok(pageLimit, 'crew-invite-page rate limit should be applied');
    assert.equal(pageLimit.max, 30);
  });
});

// =====================================================================
//  Exported helper: generateUniqueInviteCode
// =====================================================================
describe('invite-code.js — generateUniqueInviteCode export', () => {

  test('inviteExpiryFor: a future festival expires 2 days after its last day', async () => {
    const { inviteExpiryFor } = await import('../lib/invite-code.js');
    const now = Date.parse('2026-11-01T12:00:00Z');
    const festival = { days: [{ date: '2026-12-01' }, { date: '2026-11-29' }, { date: '2026-11-30' }] };
    assert.equal(inviteExpiryFor(festival, now).toISOString(), '2026-12-03T00:00:00.000Z');
  });

  test('inviteExpiryFor: a past or near festival gets now + 7 days', async () => {
    const { inviteExpiryFor } = await import('../lib/invite-code.js');
    const now = Date.parse('2026-11-01T12:00:00Z');
    const sevenDays = new Date(now + 7 * DAY_MS).toISOString();
    assert.equal(inviteExpiryFor({ days: [{ date: '2026-06-01' }] }, now).toISOString(), sevenDays);
    assert.equal(inviteExpiryFor({ days: [{ date: '2026-11-03' }] }, now).toISOString(), sevenDays);
  });

  test('inviteExpiryFor: no festival or no days gives now + 7 days', async () => {
    const { inviteExpiryFor } = await import('../lib/invite-code.js');
    const now = Date.parse('2026-11-01T12:00:00Z');
    const sevenDays = new Date(now + 7 * DAY_MS).toISOString();
    assert.equal(inviteExpiryFor(null, now).toISOString(), sevenDays);
    assert.equal(inviteExpiryFor(undefined, now).toISOString(), sevenDays);
    assert.equal(inviteExpiryFor({ days: [] }, now).toISOString(), sevenDays);
    assert.equal(inviteExpiryFor({ days: [{ date: null }, { date: 'garbage' }] }, now).toISOString(), sevenDays);
  });

  test('module exports generateUniqueInviteCode function', async () => {
    const mod = await import('../lib/invite-code.js');
    assert.equal(typeof mod.generateUniqueInviteCode, 'function');
  });

  test('generateUniqueInviteCode returns a 6-char code', async () => {
    const { generateUniqueInviteCode } = await import('../lib/invite-code.js');
    const mockStores = {
      crews: {
        getByInviteCode: mock.fn(async () => null),
      },
    };

    const code = await generateUniqueInviteCode(mockStores);

    assert.equal(typeof code, 'string');
    assert.equal(code.length, 6);
    // Characters should only be from the allowed set (no I, O, 0, 1)
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  test('generateUniqueInviteCode retries on collision', async () => {
    const { generateUniqueInviteCode } = await import('../lib/invite-code.js');
    let callCount = 0;
    const mockStores = {
      crews: {
        getByInviteCode: mock.fn(async () => {
          callCount++;
          // First 3 codes "collide", then succeed
          if (callCount <= 3) return { id: 'existing-crew' };
          return null;
        }),
      },
    };

    const code = await generateUniqueInviteCode(mockStores);

    assert.equal(typeof code, 'string');
    assert.equal(code.length, 6);
    assert.ok(callCount >= 4, 'should have retried at least 3 times before succeeding');
  });

  test('generateUniqueInviteCode throws after 10 failed attempts', async () => {
    const { generateUniqueInviteCode } = await import('../lib/invite-code.js');
    const mockStores = {
      crews: {
        getByInviteCode: mock.fn(async () => ({ id: 'always-collides' })),
      },
    };

    await assert.rejects(
      () => generateUniqueInviteCode(mockStores),
      { message: 'Failed to generate unique invite code' },
    );

    assert.equal(mockStores.crews.getByInviteCode.mock.calls.length, 10);
  });
});

describe('routes/crew-invites.js -- feed row and push on join', () => {
  test('join writes member-joined and queues a member item with the joiner as actor', async () => {
    const activity = { log: mock.fn(async () => 'act-1') };
    const crewNotify = { queue: mock.fn() };
    const { app } = await buildInviteApp({
      activity,
      crewNotify,
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => ({ ...DEFAULT_CREW })),
          getMember: mock.fn(async () => null),
          listByUserAndFestival: mock.fn(async () => []),
          getMemberCount: mock.fn(async () => 1),
          addMember: mock.fn(async () => {}),
          getMembers: mock.fn(async () => DEFAULT_MEMBERS),
        },
      },
    });

    const res = await request(app).post('/join').send({ inviteCode: 'ABC123' });

    assert.equal(res.status, 200);
    const row = (activity.log.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(row, { crewId: 'crew-1', userId: 'user-1', type: 'member-joined' });
    assert.deepEqual((crewNotify.queue.mock.calls as any[])[0].arguments[0], {
      crewId: 'crew-1',
      actorId: 'user-1',
      kind: 'member',
      text: 'testuser joined',
    });
  });
});
