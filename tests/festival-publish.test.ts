import 'dotenv/config';
/**
 * Integration tests for festival drafts, publish, archive and restore (routes/festivals.ts).
 * Covers: migration default publishes existing rows, a new festival is a hidden draft,
 * the admin checklist, publish blocked and allowed, no festival:updated for a draft
 * save (unit-tested in routes-auth-account-festivals), structured 400 issues,
 * archive and restore, and the delete-impact counts.
 *
 * Skip-gate on TEST_DATABASE_URL. The helpers module exits the process without
 * it, so it is imported only when the database is there. The first describe is a
 * unit test of the picker alerts and of "no save or publish sends the set-times alert",
 * with mocked deps, and always runs.
 */

import assert from 'node:assert/strict';
import { after, afterEach, describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createFestivalsRoutes from '../routes/festivals.js';
import { TEST_DATABASE_URL, skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

after(() => {
  if (skip) console.log('festival-publish: skipped (TEST_DATABASE_URL not set)');
});

// ── picker alerts and the set-times alert (mocked deps, no database) ─────
describe('set times: PUT and publish send no festival-wide alert', () => {
  const pass = () => (req: any, _res: any, next: any) => {
    req.validatedBody = req.body;
    req.validatedParams = req.params;
    next();
  };
  const stages = [
    { id: 'main', name: 'Main' },
    { id: 'tent', name: 'Tent' },
  ];
  const tbaFestival = (publishedAt: string | null): any => ({
    id: 'f-1',
    name: 'Fest',
    publishedAt,
    latitude: 1,
    location: 'Field',
    stages,
    days: [
      {
        label: 'Fri',
        date: '2026-06-05',
        sets: [
          { id: 's1', artist: 'Alpha', stageId: 'main', startTime: null, endTime: null },
          { id: 's2', artist: 'Beta', stageId: 'main', startTime: null, endTime: null },
        ],
      },
    ],
  });
  // s1 gets its first time; s2 gets a time AND changes stage (a real move).
  const timedDays = [
    {
      label: 'Fri',
      date: '2026-06-05',
      sets: [
        { id: 's1', artist: 'Alpha', stageId: 'main', startTime: '20:00', endTime: '21:00' },
        { id: 's2', artist: 'Beta', stageId: 'tent', startTime: '21:00', endTime: '22:00' },
      ],
    },
  ];

  function build({
    existing = tbaFestival('2026-01-01T00:00:00.000Z'),
    released = [] as string[],
  } = {}) {
    const warnings: any[] = [];
    // Any festival-wide send, under the old or the new name, counts here.
    const sendTimeRelease = mock.fn(async (_id: string, _key: string) => ({ queued: true }));
    const pickersBySet = mock.fn(
      async (_festivalId: string, setIds: string[]) => new Map(setIds.map((id) => [id, [`picker-${id}`]])),
    );
    const deps: any = {
      express,
      config: {},
      log: { info() {}, warn: (...args: any[]) => warnings.push(args), error() {}, debug() {} },
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
          publish: mock.fn(async () => ({ publishedAt: '2026-11-01T00:00:00.000Z', slug: 'fest-2026' })),
        },
        profiles: { pickersBySet },
        timeReleases: { releasedDates: mock.fn(async () => new Set(released)) },
        pool: { query: async () => ({ rows: [{ count: '0' }] }) },
      },
      emitter: { festivalCreated: mock.fn(), festivalUpdated: mock.fn(), scheduleChanged: mock.fn() },
      schemas: {},
      validate: pass,
      validateQuery: pass,
      validateParams: pass,
      invalidateFestivalCache: () => {},
      reengagement: { sendTimeRelease, sendSetTimesOut: sendTimeRelease },
    };
    deps.festivalAccess = () => deps.adminAuth;
    const app = express();
    app.use(express.json());
    app.use(createFestivalsRoutes(deps));
    return { app, deps, sendTimeRelease, pickersBySet, warnings };
  }

  const alertedSets = (deps: any) =>
    deps.emitter.scheduleChanged.mock.calls[0]?.arguments[0].changes.map((c: any) => c.setId);

  test('a save that times sets on an unreleased date drops TBA-to-time alerts, keeps real moves and sends no festival-wide alert', async () => {
    const { app, deps, sendTimeRelease, pickersBySet } = build();
    const res = await request(app).put('/f-1').send({ stages, days: timedDays });
    assert.equal(res.status, 200);
    assert.deepEqual(pickersBySet.mock.calls[0]!.arguments[1], ['s2']);
    assert.deepEqual(alertedSets(deps), ['s2']);
    assert.deepEqual(res.body.data.scheduleNotice, { changes: 1, people: 1, notified: true });
    assert.equal(sendTimeRelease.mock.calls.length, 0);
  });

  test('a set timed on a released date alerts its pickers', async () => {
    const { app, deps } = build({ released: ['2026-06-05'] });
    await request(app).put('/f-1').send({ stages, days: timedDays }).expect(200);
    assert.deepEqual(alertedSets(deps), ['s1', 's2']);
  });

  test('a release on another date does not count for this date', async () => {
    const { app, deps } = build({ released: ['2026-06-06'] });
    await request(app).put('/f-1').send({ stages, days: timedDays }).expect(200);
    assert.deepEqual(alertedSets(deps), ['s2']);
  });

  test('a set that already had a time and moves keeps its alert on an unreleased date', async () => {
    const existing = tbaFestival('2026-01-01T00:00:00.000Z');
    existing.days[0].sets[1] = { ...existing.days[0].sets[1], startTime: '23:00', endTime: '23:30' };
    const { app, deps } = build({ existing });
    await request(app).put('/f-1').send({ stages, days: timedDays }).expect(200);
    assert.deepEqual(alertedSets(deps), ['s2']);
  });

  test('notify:false sends no picker alert even on a released date', async () => {
    const { app, deps } = build({ released: ['2026-06-05'] });
    await request(app).put('/f-1').send({ stages, days: timedDays, notify: false }).expect(200);
    assert.equal(deps.emitter.scheduleChanged.mock.calls.length, 0);
  });

  test('a save without days alerts nobody and reads no release rows', async () => {
    const { app, deps, sendTimeRelease } = build();
    await request(app).put('/f-1').send({ name: 'Fest 2' }).expect(200);
    assert.equal(sendTimeRelease.mock.calls.length, 0);
    assert.equal(deps.stores.timeReleases.releasedDates.mock.calls.length, 0);
    assert.equal(deps.emitter.scheduleChanged.mock.calls.length, 0);
  });

  test('publish announces the festival and sends no set-times alert', async () => {
    const { app, deps, sendTimeRelease } = build({ existing: tbaFestival(null) });
    await request(app).post('/f-1/publish').expect(200);
    assert.equal(deps.emitter.festivalCreated.mock.calls.length, 1);
    assert.equal(sendTimeRelease.mock.calls.length, 0);
  });

  test('publish answers { publishedAt, checklist } and leaves the store slug out', async () => {
    const { app } = build({ existing: tbaFestival(null) });
    const res = await request(app).post('/f-1/publish').expect(200);
    assert.deepEqual(res.body.data, { publishedAt: '2026-11-01T00:00:00.000Z', checklist: [] });
  });
});

const admin = (token: string, req: any) => req.set('x-user-token', token).set(h.TRUSTED_MUTATION_HEADER, '1');

function draftPayload(id: string, extra: any = {}) {
  return {
    id,
    name: 'Draft Fest',
    location: 'Field',
    stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
    days: [
      {
        label: 'Friday',
        date: '2026-06-05',
        sets: [{ id: `${id}-s1`, artist: 'Alpha', stageId: 'main', startTime: '20:00', endTime: '21:00' }],
      },
    ],
    ...extra,
  };
}

async function setup() {
  const server = await h.startServer();
  servers.push(server);
  const token = await h.loginAdmin(server);
  return { server, token };
}

async function auditCount(server: any, action: string, targetId: string) {
  const pool = new h.Pool({ connectionString: server.databaseUrl });
  try {
    // audit() is fire-and-forget after the response, so poll (bounded).
    let count = 0;
    for (let i = 0; i < 50; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 20));
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1 AND target_id = $2', [
        action,
        targetId,
      ]);
      count = rows[0].n;
      if (count > 0) break;
    }
    return count;
  } finally {
    await pool.end();
  }
}

describe('festival drafts and publish', { skip, concurrency: 1 }, () => {
  test('a festival inserted without published_at is public', async () => {
    const { server } = await setup();
    const pool = new h.Pool({ connectionString: server.databaseUrl });
    try {
      await pool.query("INSERT INTO festivals (id, name) VALUES ('fest-raw', 'Raw Fest')");
    } finally {
      await pool.end();
    }
    const list = await server.request.get('/api/v1/festivals').expect(200);
    h.assert.ok(list.body.data.some((f: any) => f.id === 'fest-raw'));
  });

  test('a created festival is a draft that only admins can see', async () => {
    const { server, token } = await setup();
    const created = await admin(token, server.request.post('/api/v1/admin/festivals'))
      .send(draftPayload('fest-d'))
      .expect(201);
    h.assert.equal(created.body.data.publishedAt, null);

    const adminList = await admin(token, server.request.get('/api/v1/admin/festivals')).expect(200);
    h.assert.equal(adminList.body.data.find((f: any) => f.id === 'fest-d')?.published, false);

    const publicList = await server.request.get('/api/v1/festivals').expect(200);
    h.assert.ok(!publicList.body.data.some((f: any) => f.id === 'fest-d'));
    await server.request.get('/api/v1/festivals/fest-d').expect(404);

    const user = await h.registerUser(server, 'drafter');
    await server.request
      .post('/api/v1/profiles')
      .set('x-user-token', user.token)
      .set(h.TRUSTED_MUTATION_HEADER, '1')
      .send({ festivalId: 'fest-d' })
      .expect(404);

    const detail = await admin(token, server.request.get('/api/v1/admin/festivals/fest-d')).expect(200);
    h.assert.deepEqual(
      detail.body.data.checklist.map((item: any) => item.key),
      [
        'timeZone', 'stages', 'days', 'sets', 'errors', 'pins', 'times', 'overlaps',
        'duration_odd', 'start_unusual_hour', 'artist_double_booked',
      ],
    );
    h.assert.equal(detail.body.data.publishedAt, null);
  });

  test('publish is blocked without a time zone, then succeeds once', async () => {
    const { server, token } = await setup();
    await admin(token, server.request.post('/api/v1/admin/festivals')).send(draftPayload('fest-p')).expect(201);

    const blocked = await admin(token, server.request.post('/api/v1/admin/festivals/fest-p/publish')).expect(409);
    h.assert.equal(blocked.body.error.code, 'PUBLISH_BLOCKED');
    h.assert.equal(blocked.body.error.checklist.find((i: any) => i.key === 'timeZone').status, 'todo');

    await admin(token, server.request.put('/api/v1/admin/festivals/fest-p'))
      .send(draftPayload('fest-p', { timeZone: 'America/New_York' }))
      .expect(200);
    const first = await admin(token, server.request.post('/api/v1/admin/festivals/fest-p/publish')).expect(200);
    h.assert.ok(first.body.data.publishedAt);

    const publicList = await server.request.get('/api/v1/festivals').expect(200);
    h.assert.ok(publicList.body.data.some((f: any) => f.id === 'fest-p'));
    h.assert.equal(await auditCount(server, 'festival.published', 'fest-p'), 1);

    const second = await admin(token, server.request.post('/api/v1/admin/festivals/fest-p/publish')).expect(200);
    h.assert.equal(new Date(second.body.data.publishedAt).getTime(), new Date(first.body.data.publishedAt).getTime());
    await new Promise((resolve) => setTimeout(resolve, 100));
    h.assert.equal(await auditCount(server, 'festival.published', 'fest-p'), 1);
  });

  test('an overlap is a structured 400 that names both sets', async () => {
    const { server, token } = await setup();
    const res = await admin(token, server.request.put('/api/v1/admin/festivals/fest-1'))
      .send({
        name: 'Test Fest',
        stages: [{ id: 'main', name: 'Main Stage', color: '#ff3366' }],
        days: [
          {
            label: 'Friday',
            date: '2026-06-05',
            sets: [
              { id: 'ov-early', artist: 'Early', stageId: 'main', startTime: '20:00', endTime: '22:00' },
              { id: 'ov-late', artist: 'Late', stageId: 'main', startTime: '21:00', endTime: '23:00' },
            ],
          },
        ],
      })
      .expect(400);
    h.assert.equal(res.body.error.message, 'Stage overlap on "Late" and "Early"');
    const issue = res.body.error.issues[0];
    h.assert.equal(issue.code, 'stage_overlap');
    h.assert.deepEqual(
      { kind: issue.target.kind, setId: issue.target.setId, relatedSetId: issue.target.relatedSetId, field: issue.target.field, dayIndex: issue.target.dayIndex },
      { kind: 'set', setId: 'ov-late', relatedSetId: 'ov-early', field: 'startTime', dayIndex: 0 },
    );
  });

  test('archive and restore', async () => {
    const { server, token } = await setup();
    // Delete needs a fresh password confirmation (T4 re-auth window).
    await server.request.post('/api/v1/auth/reauth').set('x-user-token', token).send({ password: 'test-admin-password' }).expect(200);
    await admin(token, server.request.delete('/api/v1/admin/festivals/fest-1')).expect(200);

    const archived = await admin(token, server.request.get('/api/v1/admin/festivals/archived')).expect(200);
    h.assert.ok(archived.body.data.some((f: any) => f.id === 'fest-1'));

    const restored = await admin(token, server.request.post('/api/v1/admin/festivals/fest-1/restore')).expect(200);
    h.assert.deepEqual(restored.body.data, { id: 'fest-1', published: true });
    const adminList = await admin(token, server.request.get('/api/v1/admin/festivals')).expect(200);
    h.assert.ok(adminList.body.data.some((f: any) => f.id === 'fest-1'));

    await admin(token, server.request.post('/api/v1/admin/festivals/fest-1/restore')).expect(404);
  });

  test('impact counts profiles, crews and picks', async () => {
    const { server, token } = await setup();
    const u1 = await h.registerUser(server, 'impact1');
    const u2 = await h.registerUser(server, 'impact2');
    const p1 = await h.joinFestivalProfile(server, u1.token);
    await h.joinFestivalProfile(server, u2.token);
    await server.request
      .put(`/api/v1/profiles/${p1.id}`)
      .set('x-user-token', u1.token)
      .set(h.TRUSTED_MUTATION_HEADER, '1')
      .send({ picks: { 'set-a': 'must', 'set-b': 'want-to-see', 'set-c': 'maybe' } })
      .expect(200);
    const pool = new h.Pool({ connectionString: server.databaseUrl });
    try {
      await pool.query(
        "INSERT INTO crews (id, festival_id, name, created_by, invite_code) VALUES ('crew-impact', 'fest-1', 'Crew', $1, 'IMPACT1')",
        [u1.user.id],
      );
    } finally {
      await pool.end();
    }

    const res = await admin(token, server.request.get('/api/v1/admin/festivals/fest-1/impact')).expect(200);
    h.assert.deepEqual(res.body.data, { profiles: 2, crews: 1, picks: 3 });
  });

  // No save or publish sends the set-times alert, so neither writes the marker or a release row.
  async function readReleaseState(server: any, id: string) {
    const pool = new h.Pool({ connectionString: server.databaseUrl });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100)); // a stray trigger would run after the response
      const marker = await pool.query('SELECT set_times_out_at FROM festivals WHERE id = $1', [id]);
      const rows = await pool.query('SELECT 1 FROM festival_time_releases WHERE festival_id = $1', [id]);
      return { marker: marker.rows[0]?.set_times_out_at ?? null, releaseRows: rows.rows.length };
    } finally {
      await pool.end();
    }
  }

  const tbaDays = (id: string) => [
    {
      label: 'Friday',
      date: '2026-06-05',
      sets: [{ id: `${id}-s1`, artist: 'Alpha', stageId: 'main', startTime: '', endTime: '' }],
    },
  ];

  test('a draft save with times and its publish write no marker and no release row', async () => {
    const { server, token } = await setup();
    await admin(token, server.request.post('/api/v1/admin/festivals')).send(draftPayload('fest-tm')).expect(201);
    await admin(token, server.request.put('/api/v1/admin/festivals/fest-tm'))
      .send(draftPayload('fest-tm', { timeZone: 'America/New_York' }))
      .expect(200);
    await admin(token, server.request.post('/api/v1/admin/festivals/fest-tm/publish')).expect(200);
    h.assert.deepEqual(await readReleaseState(server, 'fest-tm'), { marker: null, releaseRows: 0 });
  });

  test('timing the sets of a published festival writes no marker and no release row', async () => {
    const { server, token } = await setup();
    await admin(token, server.request.post('/api/v1/admin/festivals'))
      .send(draftPayload('fest-tb', { timeZone: 'America/New_York', days: tbaDays('fest-tb') }))
      .expect(201);
    await admin(token, server.request.post('/api/v1/admin/festivals/fest-tb/publish')).expect(200);
    await admin(token, server.request.put('/api/v1/admin/festivals/fest-tb'))
      .send(draftPayload('fest-tb', { timeZone: 'America/New_York' }))
      .expect(200);
    h.assert.deepEqual(await readReleaseState(server, 'fest-tb'), { marker: null, releaseRows: 0 });
  });
});
