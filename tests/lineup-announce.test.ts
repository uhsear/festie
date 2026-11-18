import 'dotenv/config';
/**
 * Unit tests for routes/lineup-announce.ts with mocked deps (no database).
 * The DB-backed edition-matching checks need TEST_DATABASE_URL and are not covered here.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createLineupAnnounceRoute from '../routes/lineup-announce';

const DAYS_COUNT = {
  festivalName: 'Test Fest 2026',
  actsWithDay: 118,
  actsTotal: 118,
  recipients: 5,
  audience: 5,
  emailRecipients: 5,
  emailCut: 0,
  emailOff: null,
};

function build({
  recipients = 2,
  followers,
  priorAttendees,
  name = 'Test Fest 2026',
  publishedAt = '2026-01-01T00:00:00.000Z' as string | null,
  days = {} as Record<string, unknown>,
}: {
  recipients?: number;
  followers?: number;
  priorAttendees?: number;
  name?: string;
  publishedAt?: string | null;
  days?: Record<string, unknown>;
} = {}) {
  const calls = { sendLineupDrop: 0, sendDaysOut: 0, audit: [] as any[] };
  const deps: any = {
    express,
    log: { error() {}, warn() {}, info() {} },
    adminAuth: (_req: any, _res: any, next: any) => next(),
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    sanitizeIdentifier: (v: string) => v,
    sendSuccess: (res: any, data: any) => res.json({ success: true, data }),
    sendError: (res: any, status: number, message: string) => res.status(status).json({ success: false, error: message }),
    ErrorCodes: { INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    stores: { auditLog: { insert: async (row: any) => calls.audit.push(row) } },
    getFestivalById: async (id: string) => ({ id, name, publishedAt }),
    getRequestIp: () => '127.0.0.1',
    reengagement: {
      sendLineupDrop: async () => {
        calls.sendLineupDrop += 1;
      },
      sendDaysOut: async () => {
        calls.sendDaysOut += 1;
      },
    },
    reengagementExecutor: {
      countLineupDrop: async () => ({
        festivalName: name,
        recipients,
        followers: followers ?? recipients,
        priorAttendees: priorAttendees ?? 0,
        matchedFestivalNames: [],
        emailRecipients: 0,
        emailCut: 0,
        emailOff: 'no_postal_address',
      }),
      countDaysOut: async () => ({ ...DAYS_COUNT, festivalName: name, ...days }),
    },
  };
  const app = express();
  app.use('/api/v1/admin/festivals', createLineupAnnounceRoute(deps));
  return { app, calls };
}

describe('lineup-announce route', () => {
  test('GET returns the recipient count', async () => {
    const { app } = build();
    const res = await request(app).get('/api/v1/admin/festivals/f1/lineup-announcement');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.festivalName, 'Test Fest 2026');
    assert.equal(res.body.data.recipients, 2);
    assert.equal(res.body.data.emailOff, 'no_postal_address');
  });

  test('POST queues the send and writes an audit row', async () => {
    const { app, calls } = build();
    const res = await request(app).post('/api/v1/admin/festivals/f1/lineup-announcement');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { queued: true, recipients: 2 });
    assert.equal(calls.sendLineupDrop, 1);
    assert.equal(calls.audit[0].action, 'festival.lineup.announced');
  });

  test('POST with zero recipients is 400 and sends nothing', async () => {
    const { app, calls } = build({ recipients: 0, followers: 0 });
    const res = await request(app).post('/api/v1/admin/festivals/f1/lineup-announcement');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'No one to notify. No one follows this festival or went to an earlier edition.');
    assert.equal(calls.sendLineupDrop, 0);
  });

  test('POST with push fully deduped but prior attendees is not 400 (email can retry)', async () => {
    const { app, calls } = build({ recipients: 0, followers: 0, priorAttendees: 3 });
    const res = await request(app).post('/api/v1/admin/festivals/f1/lineup-announcement');
    assert.equal(res.status, 200);
    assert.equal(calls.sendLineupDrop, 1);
  });

  test('POST on a draft is 409 and sends nothing', async () => {
    const { app, calls } = build({ publishedAt: null });
    const res = await request(app).post('/api/v1/admin/festivals/f1/lineup-announcement');
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Publish the festival/);
    assert.equal(calls.sendLineupDrop, 0);
  });

  test('unknown festival is 404', async () => {
    const { app } = build({ name: '' });
    const res = await request(app).get('/api/v1/admin/festivals/nope/lineup-announcement');
    assert.equal(res.status, 404);
  });

  test('POST with only past-edition users still queues the lineup send', async () => {
    const { app, calls } = build({ recipients: 2, followers: 0, priorAttendees: 2 });
    const res = await request(app).post('/api/v1/admin/festivals/f1/lineup-announcement');
    assert.equal(res.status, 200);
    assert.equal(calls.sendLineupDrop, 1);
  });
});

describe('days-announcement route', () => {
  const GET = '/api/v1/admin/festivals/f1/days-announcement';

  test('GET returns the dry run', async () => {
    const { app, calls } = build({ days: { actsWithDay: 1, actsTotal: 118 } });
    const res = await request(app).get(GET);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.actsWithDay, 1);
    assert.equal(res.body.data.actsTotal, 118);
    assert.equal(calls.sendDaysOut, 0);
  });

  test('POST queues the send, reports the counts and writes an audit row', async () => {
    const { app, calls } = build();
    const res = await request(app).post(GET);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { queued: true, recipients: 5, emailRecipients: 5 });
    assert.equal(calls.sendDaysOut, 1);
    assert.equal(calls.audit[0].action, 'festival.days.announced');
    assert.deepEqual(JSON.parse(calls.audit[0].detailsJson), {
      recipients: 5,
      emailRecipients: 5,
      actsWithDay: 118,
      actsTotal: 118,
    });
  });

  test('POST refuses with a clear message and sends nothing', async () => {
    const refusals: Array<[string, number, string]> = [
      ['no_days', 400, 'Give acts a day before you announce days.'],
      ['draft', 409, 'Publish the festival before you announce its days.'],
      ['set_times_out', 409, 'Set times are already out. The set-times alert covered this.'],
      ['already_heard', 400, 'Everyone who follows has already heard.'],
    ];
    for (const [reason, status, message] of refusals) {
      const { app, calls } = build({ days: { reason } });
      const res = await request(app).post(GET);
      assert.equal(res.status, status, reason);
      assert.equal(res.body.error, message);
      assert.equal(calls.sendDaysOut, 0);
      assert.equal(calls.audit.length, 0);
    }
  });

  test('an unknown festival is 404 on both verbs', async () => {
    const { app, calls } = build({ days: { festivalName: '', reason: 'festival_not_found' } });
    assert.equal((await request(app).get(GET)).status, 404);
    assert.equal((await request(app).post(GET)).status, 404);
    assert.equal(calls.sendDaysOut, 0);
  });
});
