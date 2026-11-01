import 'dotenv/config';
/**
 * Integration tests for festival drafts, publish, archive and restore (routes/festivals.ts).
 * Covers: migration default publishes existing rows, a new festival is a hidden draft,
 * the admin checklist, publish blocked and allowed, no festival:updated for a draft
 * save (unit-tested in routes-auth-account-festivals), structured 400 issues,
 * archive and restore, and the delete-impact counts.
 *
 * Skip-gate on TEST_DATABASE_URL. The helpers module exits the process without
 * it, so it is imported only when the database is there.
 */

import { after, afterEach, describe, test } from 'node:test';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const h: any = skip ? null : await import('./_integration-helpers');

const servers: any[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

after(() => {
  if (skip) console.log('festival-publish: skipped (TEST_DATABASE_URL not set)');
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
      ['timeZone', 'stages', 'days', 'sets', 'errors', 'pins', 'times', 'overlaps'],
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
    h.assert.equal(await auditCount(server, 'festival:publish', 'fest-p'), 1);

    const second = await admin(token, server.request.post('/api/v1/admin/festivals/fest-p/publish')).expect(200);
    h.assert.equal(new Date(second.body.data.publishedAt).getTime(), new Date(first.body.data.publishedAt).getTime());
    await new Promise((resolve) => setTimeout(resolve, 100));
    h.assert.equal(await auditCount(server, 'festival:publish', 'fest-p'), 1);
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
});
