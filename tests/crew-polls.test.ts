/**
 * Mock-based route tests for routes/crew-polls.js
 *
 * Covers: GET /:crewId/polls, POST /:crewId/polls,
 *         POST /:crewId/polls/:pollId/vote, DELETE /:crewId/polls/:pollId,
 *         POST /:crewId/polls/:pollId/nudge
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

function makeIo() {
  const emitFn = mock.fn(() => {});
  return {
    to: mock.fn(() => ({ emit: emitFn })),
    _emit: emitFn,
  };
}

const DEFAULT_POLL = {
  id: 'poll-1',
  crew_id: 'crew-1',
  created_by: 'user-1',
  question: 'Where should we camp?',
  options: ['North field', 'South field', 'East lot'],
  closed_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

/**
 * Build a deps object tailored for crew-polls.js.
 */
function makePollDeps(overrides: any = {}) {
  const ioObj = makeIo();
  const storesBase = {
    crews: {
      getMember: mock.fn(async () => null),
      meetingPoints: {
        countByCrew: mock.fn(async () => 0),
        create: mock.fn(async (d: any) => ({ id: d.id, crew_id: d.crewId, label: d.label })),
      },
    },
    polls: {
      tallyVotes: mock.fn(async () => []),
      listByCrew: mock.fn(async () => []),
      countActiveByCrew: mock.fn(async () => 0),
      create: mock.fn(async (data: any) => ({
        id: 'poll-new',
        crew_id: data.crewId,
        created_by: data.createdBy,
        question: data.question,
        options: data.options,
        closed_at: null,
        created_at: new Date().toISOString(),
      })),
      getById: mock.fn(async () => null),
      vote: mock.fn(async () => {}),
      removeVote: mock.fn(async () => {}),
      nonVoterIds: mock.fn(async () => []),
      markNudged: mock.fn(async () => true),
      close: mock.fn(async () => ({ ...DEFAULT_POLL, closed_at: new Date().toISOString() })),
    },
    activity: {
      log: mock.fn(async () => {}),
    },
  };

  // Deep-merge stores
  const stores: any = { ...storesBase };
  if (overrides.stores) {
    stores.crews = { ...storesBase.crews, ...overrides.stores.crews };
    stores.polls = { ...storesBase.polls, ...overrides.stores.polls };
    stores.activity = { ...storesBase.activity, ...overrides.stores.activity };
  }

  const deps = {
    express,
    log: noopLog,
    userAuth: overrides.userAuth || ((req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', username: 'testuser' };
      next();
    }),
    createOpaqueId: (prefix: string) => `${prefix}-test`,
    sanitizeIdentifier: overrides.sanitizeIdentifier || ((s: any) => (typeof s === 'string' ? s.trim() : '')),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: {
      INVALID_INPUT: 'INVALID_INPUT',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    rateLimit: overrides.rateLimit || ((_max: any, _key: any) => (_req: any, _res: any, next: any) => next()),
    schemas: {
      crewIdParams: {},
      crewIdPollIdParams: {},
      pollCreate: {},
      pollVote: {},
    },
    validate: overrides.validate || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedBody = req.body; next(); }),
    validateParams: overrides.validateParams || ((_schema: any) => (req: any, _res: any, next: any) => { req.validatedParams = req.params; next(); }),
    io: overrides.io !== undefined ? overrides.io : ioObj,
    emitter: { crewActivityLogged: mock.fn(() => {}) },
    stores,
    ...(overrides.pollCloser ? { pollCloser: overrides.pollCloser } : {}),
    ...(overrides.crewNotify ? { crewNotify: overrides.crewNotify } : {}),
  };

  return deps;
}

async function buildPollApp(overrides: any = {}) {
  const deps = makePollDeps(overrides);
  const { default: createCrewPollRoutes } = await import('../routes/crew-polls.js');
  const router = createCrewPollRoutes(deps);
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return { app, deps };
}

// =====================================================================
//  GET /:crewId/polls — List polls for a crew
// =====================================================================
describe('routes/crew-polls.js — GET /:crewId/polls', () => {

  test('factory returns an Express router', async () => {
    const { app } = await buildPollApp();
    assert.ok(app);
  });

  // ── Happy path ────────────────────────────────────────────────────
  test('returns polls list for a crew member', async () => {
    const polls = [
      { ...DEFAULT_POLL },
      { ...DEFAULT_POLL, id: 'poll-2', question: 'What time to meet?', closed_at: '2026-01-02T00:00:00.000Z' },
    ];
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          listByCrew: mock.fn(async () => polls),
        },
      },
    });

    const res = await request(app).get('/crew-1/polls');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.polls.length, 2);
    assert.equal(res.body.data.polls[0].id, 'poll-1');
    assert.equal(res.body.data.polls[1].id, 'poll-2');
  });

  test('returns empty array when crew has no polls', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          listByCrew: mock.fn(async () => []),
        },
      },
    });

    const res = await request(app).get('/crew-1/polls');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.deepEqual(res.body.data.polls, []);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).get('/crew-1/polls');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Not a crew member/i);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).get('/crew-1/polls');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/polls — Create a poll
// =====================================================================
describe('routes/crew-polls.js — POST /:crewId/polls', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('creates a poll successfully', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'poll-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      question: data.question,
      options: data.options,
      closed_at: null,
    }));
    const { app, deps } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Where to camp?', options: ['North', 'South'] });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.poll.id, 'poll-new');
    assert.equal(res.body.data.poll.question, 'Where to camp?');
    assert.equal(createFn.mock.calls.length, 1);
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].crewId, 'crew-1');
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].createdBy, 'user-1');
  });

  test('creates a poll with closesAt timestamp', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'poll-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      question: data.question,
      options: data.options,
      closes_at: data.closesAt,
    }));
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    const closesAt = '2099-06-01T12:00:00.000Z';
    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Meeting time?', options: ['10am', '2pm'], closesAt });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    // closesAt should be passed as a Date to the store
    const passedClosesAt = (createFn.mock.calls as any[])[0].arguments[0].closesAt;
    assert.ok(passedClosesAt instanceof Date);
    assert.equal(passedClosesAt.toISOString(), closesAt);
  });

  test('passes setRefs to stores.polls.create', async () => {
    const createFn = mock.fn(async (data: any) => ({ id: 'poll-new', question: data.question, options: data.options }));
    const { app } = await buildPollApp({
      stores: {
        crews: { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) },
        polls: { countActiveByCrew: mock.fn(async () => 0), create: createFn },
      },
    });
    const setRefs = [{ setId: 's0', label: 'A', stageReference: null, meetAt: null }, null];
    await request(app).post('/crew-1/polls').send({ question: 'Q?', options: ['A', 'B'], setRefs });
    assert.deepEqual((createFn.mock.calls as any[])[0].arguments[0].setRefs, setRefs);
  });

  test('rejects a closesAt in the past with 400', async () => {
    const createFn = mock.fn(async () => ({ id: 'poll-new' }));
    const { app } = await buildPollApp({
      stores: {
        crews: { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) },
        polls: { countActiveByCrew: mock.fn(async () => 0), create: createFn },
      },
    });
    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Q?', options: ['A', 'B'], closesAt: '2020-01-01T00:00:00.000Z' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.equal(res.body.error.message, 'Pick an end time in the future.');
    assert.equal(createFn.mock.calls.length, 0);
  });

  test('passes multiAnswer to create and queues a new-poll push', async () => {
    const createFn = mock.fn(async (data: any) => ({ id: 'poll-new', question: data.question, options: data.options }));
    const crewNotify = { queue: mock.fn(() => {}) };
    const { app } = await buildPollApp({
      crewNotify,
      stores: {
        crews: { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) },
        polls: { countActiveByCrew: mock.fn(async () => 0), create: createFn },
      },
    });
    const res = await request(app).post('/crew-1/polls').send({ question: 'Dinner?', options: ['A', 'B'], multiAnswer: true });
    assert.equal(res.status, 200);
    assert.equal((createFn.mock.calls as any[])[0].arguments[0].multiAnswer, true);
    assert.deepEqual((crewNotify.queue.mock.calls as any[])[0].arguments[0], {
      crewId: 'crew-1',
      actorId: 'user-1',
      kind: 'poll',
      text: 'New poll: Dinner?',
    });
  });

  test('creates a poll with null closesAt when not provided', async () => {
    const createFn = mock.fn(async (data: any) => ({
      id: 'poll-new',
      crew_id: data.crewId,
      created_by: data.createdBy,
      question: data.question,
      options: data.options,
      closes_at: data.closesAt,
    }));
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: createFn,
        },
      },
    });

    await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Favorite band?', options: ['A', 'B'] });

    assert.equal((createFn.mock.calls as any[])[0].arguments[0].closesAt, null);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:poll-created via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildPollApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'poll-new',
            question: data.question,
            options: data.options,
          })),
        },
      },
    });

    await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Where?', options: ['A', 'B'] });

    assert.equal(ioObj.to.mock.calls.length, 1);
    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:poll-created');
    const payload = (ioObj._emit.mock.calls as any[])[0].arguments[1];
    assert.equal(payload.pollId, 'poll-new');
    assert.equal(payload.question, 'Where?');
    assert.deepEqual(payload.options, ['A', 'B']);
    assert.equal(payload.createdBy, 'user-1');
  });

  // ── Activity logging ──────────────────────────────────────────────
  test('logs poll-created activity', async () => {
    const activityLog = mock.fn(async () => {});
    const { app, deps } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'poll-new',
            question: data.question,
            options: data.options,
          })),
        },
        activity: {
          log: activityLog,
        },
      },
    });

    await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Where?', options: ['A', 'B'] });

    assert.equal(activityLog.mock.calls.length, 1);
    const logArgs = (activityLog.mock.calls as any[])[0].arguments[0];
    assert.equal(logArgs.crewId, 'crew-1');
    assert.equal(logArgs.userId, 'user-1');
    assert.equal(logArgs.type, 'poll-created');
    assert.equal(logArgs.detail, 'Where?');

    // The same write broadcasts crew:activity so the feed refreshes live.
    const activityEmit = (deps.emitter.crewActivityLogged as any).mock.calls;
    assert.equal(activityEmit.length, 1);
    assert.equal(activityEmit[0].arguments[0].crewId, 'crew-1');
    assert.equal(activityEmit[0].arguments[0].item.type, 'poll-created');
  });

  // ── Max active polls limit ────────────────────────────────────────
  test('returns 409 when crew already has 3 active polls', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 3),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Too many?', options: ['Yes', 'No'] });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
    assert.match(res.body.error.message, /Max 3 active polls/i);
  });

  test('allows creating a poll when crew has fewer than 3 active polls', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 2),
          create: mock.fn(async (data: any) => ({
            id: 'poll-new',
            question: data.question,
            options: data.options,
          })),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Almost full?', options: ['Yes', 'No'] });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Where?', options: ['A', 'B'] });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Activity log failure does not break response ──────────────────
  test('succeeds even when activity logging fails', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => 0),
          create: mock.fn(async (data: any) => ({
            id: 'poll-new',
            question: data.question,
            options: data.options,
          })),
        },
        activity: {
          log: mock.fn(async () => { throw new Error('activity store down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Still works?', options: ['Yes', 'No'] });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          countActiveByCrew: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Crash?', options: ['Yes', 'No'] });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/polls/:pollId/vote — Vote on a poll
// =====================================================================
describe('routes/crew-polls.js — POST /:crewId/polls/:pollId/vote', () => {

  // ── Happy path ────────────────────────────────────────────────────
  test('casts a vote successfully', async () => {
    const voteFn = mock.fn(async () => {});
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          vote: voteFn,
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 1 });

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.voted, true);
    assert.equal(voteFn.mock.calls.length, 1);
    assert.equal((voteFn.mock.calls as any[])[0].arguments[0], 'poll-1');
    assert.equal((voteFn.mock.calls as any[])[0].arguments[1], 'user-1');
    assert.deepEqual((voteFn.mock.calls as any[])[0].arguments[2], [1]);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:poll-voted via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildPollApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          vote: mock.fn(async () => {}),
        },
      },
    });

    await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:poll-voted');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], {
      pollId: 'poll-1',
      userId: 'user-1',
      optionIndex: 0,
      optionIndexes: [0],
    });
  });

  // ── Activity logging ──────────────────────────────────────────────
  test('writes no poll-voted activity row', async () => {
    const activityLog = mock.fn(async () => {});
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          vote: mock.fn(async () => {}),
        },
        activity: {
          log: activityLog,
        },
      },
    });

    await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 2 });

    assert.equal(activityLog.mock.calls.length, 0);
  });

  // ── Multi-answer and taking a vote back ───────────────────────────
  function voteApp(pollOver: any = {}) {
    const ioObj = makeIo();
    const voteFn = mock.fn(async () => {});
    const removeFn = mock.fn(async () => {});
    const built = buildPollApp({
      io: ioObj,
      stores: {
        crews: { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) },
        polls: { getById: mock.fn(async () => ({ ...DEFAULT_POLL, ...pollOver })), vote: voteFn, removeVote: removeFn },
      },
    });
    return { built, ioObj, voteFn, removeFn };
  }

  test('empty optionIndexes takes the vote back and emits optionIndex -1', async () => {
    const { built, ioObj, voteFn, removeFn } = voteApp();
    const { app } = await built;
    const res = await request(app).post('/crew-1/polls/poll-1/vote').send({ optionIndexes: [] });
    assert.equal(res.status, 200);
    assert.equal(voteFn.mock.calls.length, 0);
    assert.deepEqual((removeFn.mock.calls as any[])[0].arguments, ['poll-1', 'user-1']);
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], {
      pollId: 'poll-1',
      userId: 'user-1',
      optionIndex: -1,
      optionIndexes: [],
    });
  });

  test('two indexes on a single-answer poll returns 400', async () => {
    const { built, voteFn } = voteApp();
    const { app } = await built;
    const res = await request(app).post('/crew-1/polls/poll-1/vote').send({ optionIndexes: [0, 1] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.equal(res.body.error.message, 'This poll takes one answer.');
    assert.equal(voteFn.mock.calls.length, 0);
  });

  test('a multi-answer poll stores sorted, de-duplicated indexes', async () => {
    const { built, ioObj, voteFn } = voteApp({ multi_answer: true });
    const { app } = await built;
    const res = await request(app).post('/crew-1/polls/poll-1/vote').send({ optionIndexes: [2, 0, 2] });
    assert.equal(res.status, 200);
    assert.deepEqual((voteFn.mock.calls as any[])[0].arguments[2], [0, 2]);
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[1].optionIndex, 0);
  });

  test('an out-of-range index inside optionIndexes returns 400', async () => {
    const { built } = voteApp({ multi_answer: true });
    const { app } = await built;
    const res = await request(app).post('/crew-1/polls/poll-1/vote').send({ optionIndexes: [0, 3] });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Invalid option index/);
  });

  // ── Option index out of bounds ────────────────────────────────────
  test('returns 400 when optionIndex is out of bounds', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })), // 3 options: indices 0-2
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 3 });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.match(res.body.error.message, /Invalid option index/i);
  });

  test('returns 400 when optionIndex equals options length', async () => {
    const pollWith2Options = { ...DEFAULT_POLL, options: ['A', 'B'] };
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => pollWith2Options),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 2 });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  // ── Poll not found ────────────────────────────────────────────────
  test('returns 404 when poll does not exist', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-missing/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Poll belongs to different crew ────────────────────────────────
  test('returns 404 when poll belongs to a different crew', async () => {
    const otherCrewPoll = { ...DEFAULT_POLL, crew_id: 'crew-other' };
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => otherCrewPoll),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Duplicate vote (store throws) ─────────────────────────────────
  test('returns 500 when store.vote throws (e.g. duplicate vote)', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          vote: mock.fn(async () => { throw new Error('duplicate key violation'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  DELETE /:crewId/polls/:pollId — Close a poll
// =====================================================================
describe('routes/crew-polls.js — DELETE /:crewId/polls/:pollId', () => {

  // ── Happy path: creator closes poll ───────────────────────────────
  test('creator can close their own poll', async () => {
    const closeFn = mock.fn(async () => ({ ...DEFAULT_POLL, closed_at: new Date().toISOString() }));
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, created_by: 'user-1' })),
          close: closeFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.ok(res.body.data.closed);
    assert.equal(closeFn.mock.calls.length, 1);
    assert.equal((closeFn.mock.calls as any[])[0].arguments[0], 'poll-1');
  });

  // ── Happy path: owner closes any poll ─────────────────────────────
  test('crew owner can close any poll regardless of creator', async () => {
    const closeFn = mock.fn(async () => ({ ...DEFAULT_POLL, closed_at: new Date().toISOString() }));
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, created_by: 'other-user' })),
          close: closeFn,
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(closeFn.mock.calls.length, 1);
  });

  // ── Socket.IO broadcast ───────────────────────────────────────────
  test('broadcasts crew:poll-closed via Socket.IO', async () => {
    const ioObj = makeIo();
    const { app } = await buildPollApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          close: mock.fn(async () => ({ ...DEFAULT_POLL, closed_at: new Date().toISOString() })),
        },
      },
    });

    await request(app).delete('/crew-1/polls/poll-1');

    assert.equal((ioObj.to.mock.calls as any[])[0].arguments[0], 'crew:crew-1');
    assert.equal((ioObj._emit.mock.calls as any[])[0].arguments[0], 'crew:poll-closed');
    assert.deepEqual((ioObj._emit.mock.calls as any[])[0].arguments[1], { pollId: 'poll-1' });
  });

  // ── Close creates the winning set's meeting point ─────────────────
  const SET_REFS = [
    { setId: 's0', label: 'Act 0', stageReference: 'Main', meetAt: '2026-07-11T23:00:00.000Z' },
    { setId: 's1', label: 'Act 1', stageReference: null, meetAt: null },
    { setId: 's2', label: 'Act 2', stageReference: 'Tent', meetAt: '2026-07-12T01:00:00.000Z' },
  ];
  async function closeWith(votes: number[], pollOver: any = {}, extra: any = {}) {
    const ioObj = makeIo();
    const createMp = mock.fn(async (d: any) => ({ id: d.id, label: d.label }));
    const closeFn =
      extra.close ?? mock.fn(async () => ({ ...DEFAULT_POLL, set_refs: SET_REFS, ...pollOver, closed: true }));
    const { app } = await buildPollApp({
      io: ioObj,
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
          meetingPoints: { countByCrew: mock.fn(async () => 0), create: extra.create ?? createMp },
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, set_refs: SET_REFS, ...pollOver })),
          close: closeFn,
          tallyVotes: mock.fn(async () => votes),
        },
      },
    });
    const res = await request(app).delete('/crew-1/polls/poll-1');
    const events = (ioObj._emit.mock.calls as any[]).map((c) => c.arguments[0]);
    return { res, createMp, events };
  }

  test('close creates a meeting point from the winning set and broadcasts it', async () => {
    const { res, createMp, events } = await closeWith([0, 3, 2]);
    assert.equal(res.status, 200);
    assert.equal(createMp.mock.calls.length, 1);
    const arg = (createMp.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.label, 'Act 1');
    assert.equal(arg.location, 'Act 1');
    assert.equal(arg.type, 'set');
    assert.equal(arg.createdBy, 'user-1');
    assert.equal(arg.recursDaily, false);
    assert.ok(events.includes('crew:meeting-point-created'));
    assert.equal(res.body.data.winningSetId, 's1');
    assert.equal(res.body.data.meetingPoint.label, 'Act 1');
  });

  test('close with a single winner sets expiry from meetAt', async () => {
    const { res, createMp } = await closeWith([3, 1, 2]);
    const arg = (createMp.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.label, 'Act 0');
    assert.equal(arg.location, 'Main');
    assert.equal(arg.expiresAt, '2026-07-11T23:30:00.000Z');
    assert.equal(res.body.data.winningSetId, 's0');
  });

  test('close tie creates no meeting point and returns winningSetId null', async () => {
    const { res, createMp } = await closeWith([3, 1, 3]);
    assert.equal(createMp.mock.calls.length, 0);
    assert.equal(res.body.data.meetingPoint, null);
    assert.equal(res.body.data.winningSetId, null);
  });

  test('DELETE calls pollCloser.announce with the closed row and the caller', async () => {
    const closedRow = { ...DEFAULT_POLL, closed: true };
    const announce = mock.fn(async () => ({ meetingPoint: { id: 'mp-1' }, winningSetId: 's9' }));
    const { app } = await buildPollApp({
      pollCloser: { announce },
      stores: {
        crews: { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })) },
        polls: { getById: mock.fn(async () => ({ ...DEFAULT_POLL })), close: mock.fn(async () => closedRow) },
      },
    });
    const res = await request(app).delete('/crew-1/polls/poll-1');
    assert.equal(res.status, 200);
    assert.deepEqual((announce.mock.calls as any[])[0].arguments, [closedRow, 'user-1']);
    assert.equal(res.body.data.winningSetId, 's9');
    assert.deepEqual(res.body.data.meetingPoint, { id: 'mp-1' });
  });

  test('a 200-char set label is accepted on create and trimmed to 100 on the meeting point', async () => {
    const long = 'B'.repeat(200);
    const createFn = mock.fn(async (data: any) => ({ id: 'poll-new', question: data.question, options: data.options }));
    const { app } = await buildPollApp({
      stores: {
        crews: { getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })) },
        polls: { countActiveByCrew: mock.fn(async () => 0), create: createFn },
      },
    });
    const created = await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Q?', options: [long, 'B'], setRefs: [{ setId: 's0', label: long, stageReference: null, meetAt: null }, null] });
    assert.equal(created.status, 200);

    const { createMp } = await closeWith([1], { set_refs: [{ setId: 's0', label: long, stageReference: null, meetAt: null }] });
    const arg = (createMp.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.label.length, 100);
    assert.equal(arg.location, long);
  });

  test('close with no votes creates nothing', async () => {
    const { res, createMp } = await closeWith([]);
    assert.equal(createMp.mock.calls.length, 0);
    assert.equal(res.body.data.meetingPoint, null);
    assert.equal(res.body.data.winningSetId, null);
  });

  test('close of a plain poll creates nothing', async () => {
    const { res, createMp } = await closeWith([1, 1], { set_refs: null });
    assert.equal(createMp.mock.calls.length, 0);
    assert.equal(res.status, 200);
  });

  test('close returning undefined (already closed) creates nothing and emits no poll-closed', async () => {
    const { res, createMp, events } = await closeWith([0, 2], {}, { close: mock.fn(async () => undefined) });
    assert.equal(res.status, 200);
    assert.equal(createMp.mock.calls.length, 0);
    assert.ok(!events.includes('crew:poll-closed'));
    assert.equal(res.body.data.closed, null);
  });

  test('meeting point store error still returns 200', async () => {
    const { res, events } = await closeWith([0, 2], {}, { create: mock.fn(async () => { throw new Error('mp down'); }) });
    assert.equal(res.status, 200);
    assert.ok(events.includes('crew:poll-closed'));
    assert.equal(res.body.data.meetingPoint, null);
  });

  // ── Permission: regular member cannot close another's poll ────────
  test('returns 403 when non-owner member tries to close another users poll', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'member' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, created_by: 'other-user' })),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Only creator or owner/i);
  });

  // ── Permission: non-member ────────────────────────────────────────
  test('returns 403 when user is not a crew member', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // ── Poll not found ────────────────────────────────────────────────
  test('returns 404 when poll does not exist', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => null),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-missing');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Poll belongs to different crew ────────────────────────────────
  test('returns 404 when poll belongs to a different crew', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL, crew_id: 'crew-other' })),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ── Internal error ────────────────────────────────────────────────
  test('returns 500 on internal error', async () => {
    const { app } = await buildPollApp({
      stores: {
        crews: {
          getMember: mock.fn(async () => ({ userId: 'user-1', role: 'owner' })),
        },
        polls: {
          getById: mock.fn(async () => ({ ...DEFAULT_POLL })),
          close: mock.fn(async () => { throw new Error('db down'); }),
        },
      },
    });

    const res = await request(app).delete('/crew-1/polls/poll-1');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// =====================================================================
//  POST /:crewId/polls/:pollId/nudge — one reminder to non-voters
// =====================================================================
describe('routes/crew-polls.js — POST /:crewId/polls/:pollId/nudge', () => {
  async function nudge(opts: any = {}) {
    const crewNotify = { queue: mock.fn(() => {}), toUsers: mock.fn(async () => {}) };
    const markNudged = mock.fn(async () => opts.marked ?? true);
    const { app } = await buildPollApp({
      crewNotify,
      stores: {
        crews: { getMember: mock.fn(async () => (opts.member === undefined ? { userId: 'user-1', role: 'member' } : opts.member)) },
        polls: {
          getById: mock.fn(async () => (opts.poll === undefined ? { ...DEFAULT_POLL } : opts.poll)),
          nonVoterIds: mock.fn(async () => opts.nonVoters ?? ['user-1', 'user-2', 'user-3']),
          markNudged,
        },
      },
    });
    const res = await request(app).post('/crew-1/polls/poll-1/nudge');
    return { res, crewNotify, markNudged };
  }

  test('sends one reminder to non-voters minus the caller', async () => {
    const { res, crewNotify } = await nudge();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.nudged, 2);
    assert.deepEqual((crewNotify.toUsers.mock.calls as any[])[0].arguments[0], {
      crewId: 'crew-1',
      userIds: ['user-2', 'user-3'],
      kind: 'poll',
      text: 'testuser is waiting for your vote: Where should we camp?',
    });
  });

  const cases: [string, any, number, string, string][] = [
    ['not a member', { member: null }, 403, 'FORBIDDEN', 'Not a crew member'],
    ['poll missing', { poll: null }, 404, 'NOT_FOUND', 'Poll not found'],
    ['poll in another crew', { poll: { ...DEFAULT_POLL, crew_id: 'crew-other' } }, 404, 'NOT_FOUND', 'Poll not found'],
    [
      'not creator or owner',
      { poll: { ...DEFAULT_POLL, created_by: 'other-user' } },
      403,
      'FORBIDDEN',
      'Only the poll creator or crew owner can send a reminder.',
    ],
    ['poll ended', { poll: { ...DEFAULT_POLL, closed: true } }, 409, 'CONFLICT', 'This poll has ended.'],
    [
      'poll past its end time',
      { poll: { ...DEFAULT_POLL, closes_at: '2020-01-01T00:00:00.000Z' } },
      409,
      'CONFLICT',
      'This poll has ended.',
    ],
    ['nobody left to remind', { nonVoters: ['user-1'] }, 409, 'CONFLICT', 'Everyone has voted.'],
    ['already sent', { marked: false }, 409, 'CONFLICT', 'A reminder was already sent for this poll.'],
  ];
  for (const [name, opts, status, code, message] of cases) {
    test(`${name}: ${status} ${code}`, async () => {
      const { res, crewNotify } = await nudge(opts);
      assert.equal(res.status, status);
      assert.equal(res.body.error.code, code);
      assert.equal(res.body.error.message, message);
      assert.equal(crewNotify.toUsers.mock.calls.length, 0);
    });
  }

  test('owner can remind on a poll someone else created', async () => {
    const { res } = await nudge({ member: { userId: 'user-1', role: 'owner' }, poll: { ...DEFAULT_POLL, created_by: 'other-user' } });
    assert.equal(res.status, 200);
  });
});

// =====================================================================
//  Rate limiting
// =====================================================================
describe('routes/crew-polls.js — rate limiting', () => {

  test('applies rate limit to GET /:crewId/polls', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildPollApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app).get('/crew-1/polls');

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-poll-list');
    assert.ok(limit, 'crew-poll-list rate limit should be applied');
    assert.equal(limit.max, 120);
  });

  test('applies rate limit to POST /:crewId/polls', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildPollApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .post('/crew-1/polls')
      .send({ question: 'Test?', options: ['A', 'B'] });

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-poll-create');
    assert.ok(limit, 'crew-poll-create rate limit should be applied');
    assert.equal(limit.max, 10);
  });

  test('applies rate limit to POST /:crewId/polls/:pollId/vote', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildPollApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app)
      .post('/crew-1/polls/poll-1/vote')
      .send({ optionIndex: 0 });

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-poll-vote');
    assert.ok(limit, 'crew-poll-vote rate limit should be applied');
    assert.equal(limit.max, 60);
  });

  test('applies rate limit to DELETE /:crewId/polls/:pollId', async () => {
    const rateLimitCalls: any[] = [];
    const { app } = await buildPollApp({
      rateLimit: (max: any, key: any) => {
        rateLimitCalls.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
      stores: {
        crews: {
          getMember: mock.fn(async () => null),
        },
      },
    });

    await request(app).delete('/crew-1/polls/poll-1');

    const limit = rateLimitCalls.find((c: any) => c.key === 'crew-poll-delete');
    assert.ok(limit, 'crew-poll-delete rate limit should be applied');
    assert.equal(limit.max, 10);
  });
});
