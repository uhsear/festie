import 'dotenv/config';
/**
 * Unit tests for routes/festival-announcements.ts with mocked stores and announcer (no database).
 * The store SQL is covered by tests/integration-announcements-store.test.ts.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createAdminAnnouncementRoutes, createPublicAnnouncementRoutes } from '../routes/festival-announcements';
import createAuditMiddleware from '../lib/audit-middleware';
import { schemas, validate } from '../lib/schemas';
import { sendSuccess, sendError, ErrorCodes } from '../lib/response';
import { sanitizeIdentifier } from '../lib/helpers/sanitize';

const HOUR = 3600_000;

function build({ publishedAt = '2026-01-01T00:00:00.000Z' as string | null, exists = true, audience = 3 } = {}) {
  const rows: any[] = [];
  const calls = { deliverDue: 0, audit: [] as any[], deliverResolved: false };
  const announcements = {
    async create(a: any) {
      const row = { ...a, sentAt: null, cancelledAt: null, recipientCount: null, createdAt: new Date().toISOString() };
      rows.push(row);
      return row;
    },
    async countNear(festivalId: string, sendAt: string) {
      const t = Date.parse(sendAt);
      return rows.filter((r) => r.festivalId === festivalId && !r.cancelledAt && Math.abs(Date.parse(r.sendAt) - t) < HOUR)
        .length;
    },
    async listForAdmin(festivalId: string) {
      return rows.filter((r) => r.festivalId === festivalId);
    },
    async listActive(festivalId: string) {
      return rows.filter((r) => r.festivalId === festivalId && r.sentAt && !r.cancelledAt);
    },
    async cancel(festivalId: string, id: string) {
      const row = rows.find((r) => r.festivalId === festivalId && r.id === id);
      if (!row) return null;
      row.cancelledAt ??= new Date().toISOString();
      return row;
    },
  };
  const deps: any = {
    express,
    log: { error() {}, warn() {}, info() {}, debug() {} },
    adminAuth: (req: any, res: any, next: any) => {
      if (req.get('x-test-admin') !== '1') return sendError(res, 403, 'Admin access required', ErrorCodes.FORBIDDEN);
      req.isAdmin = true;
      req.user = { userId: 'admin-1' };
      return next();
    },
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    schemas,
    validate,
    setNoStore: (res: any) => res.setHeader('Cache-Control', 'no-store'),
    stores: {
      announcements,
      profiles: { userIdsByFestival: async () => Array.from({ length: audience }, (_, i) => `u${i}`) },
      auditLog: { insert: async (row: any) => calls.audit.push(row) },
    },
    getFestivalById: async (id: string) => (exists ? { id, name: 'Test Fest', publishedAt } : null),
    getRequestIp: () => '127.0.0.1',
    announcer: {
      // Resolves only after the response is sent, so a route that awaited it would hang the test.
      deliverDue: () => {
        calls.deliverDue += 1;
        return new Promise((resolve) =>
          setTimeout(() => {
            calls.deliverResolved = true;
            resolve(1);
          }, 50),
        );
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createAuditMiddleware(deps));
  app.use('/api/v1/admin/festivals', createAdminAnnouncementRoutes(deps));
  app.use('/api/v1/festivals', createPublicAnnouncementRoutes(deps));
  return { app, calls, rows };
}

const BASE = '/api/v1/admin/festivals/f1/announcements';
const BODY = { severity: 'info', title: 'Gates open', body: 'Gates open at noon.', screen: 'map' };

function post(app: any, body: any = BODY) {
  return request(app).post(BASE).set('x-test-admin', '1').send(body);
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('festival announcements admin POST', () => {
  test('missing festival is 404 Festival not found', async () => {
    const { app } = build({ exists: false });
    const res = await post(app);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'Festival not found');
  });

  test('draft festival is 409 with the publish message', async () => {
    const { app, rows } = build({ publishedAt: null });
    const res = await post(app);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.equal(res.body.error.message, 'Publish the festival before you send announcements.');
    assert.equal(rows.length, 0);
  });

  test('sendAt in the past or more than 14 days ahead is 400', async () => {
    const { app } = build();
    for (const sendAt of [
      new Date(Date.now() - 2 * 60_000).toISOString(),
      new Date(Date.now() + 15 * 24 * HOUR).toISOString(),
    ]) {
      const res = await post(app, { ...BODY, sendAt });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_INPUT');
      assert.equal(res.body.error.message, 'Pick a time in the next 14 days.');
    }
  });

  test('a fourth within an hour is 429; one 61 minutes after the last of three is 201', async () => {
    const { app } = build();
    const start = Date.now() + 2 * HOUR;
    for (const offset of [0, 10, 20]) {
      const res = await post(app, { ...BODY, sendAt: new Date(start + offset * 60_000).toISOString() });
      assert.equal(res.status, 201);
    }
    const fourth = await post(app, { ...BODY, sendAt: new Date(start + 30 * 60_000).toISOString() });
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error.code, 'RATE_LIMITED');
    assert.equal(
      fourth.body.error.message,
      'This festival already has 3 announcements within an hour of that time. Wait, or cancel one.',
    );
    const later = await post(app, { ...BODY, sendAt: new Date(start + 81 * 60_000).toISOString() });
    assert.equal(later.status, 201);
  });

  test('send now: 201, stores the row, calls deliverDue once and does not wait for it', async () => {
    const { app, calls, rows } = build({ audience: 450 });
    const res = await post(app);
    assert.equal(res.status, 201);
    assert.equal(calls.deliverDue, 1);
    assert.equal(calls.deliverResolved, false);
    assert.equal(res.body.data.recipients, 450);
    assert.equal(res.body.data.announcement.title, 'Gates open');
    assert.equal(res.body.data.announcement.createdBy, 'admin-1');
    assert.equal(rows.length, 1);
    assert.ok(Math.abs(Date.parse(rows[0].sendAt) - Date.now()) < 5000);
  });

  test('scheduled POST does not call deliverDue', async () => {
    const { app, calls } = build();
    const sendAt = new Date(Date.now() + HOUR).toISOString();
    const res = await post(app, { ...BODY, sendAt });
    assert.equal(res.status, 201);
    assert.equal(calls.deliverDue, 0);
    assert.equal(res.body.data.announcement.sendAt, sendAt);
  });

  test('POST writes one audit row with the contract fields and the generic middleware writes none', async () => {
    const { app, calls } = build({ audience: 2 });
    const sendAt = new Date(Date.now() + HOUR).toISOString();
    const res = await post(app, { ...BODY, severity: 'urgent', sendAt });
    await flush();
    assert.equal(calls.audit.length, 1);
    const row = calls.audit[0];
    assert.equal(row.action, 'festival.announcement.sent');
    assert.equal(row.actorType, 'admin');
    assert.equal(row.actorId, 'admin-1');
    assert.equal(row.targetType, 'festival');
    assert.equal(row.targetId, 'f1');
    assert.deepEqual(JSON.parse(row.detailsJson), {
      announcementId: res.body.data.announcement.id,
      severity: 'urgent',
      screen: 'map',
      title: 'Gates open',
      scheduled: true,
      sendAt,
      recipients: 2,
    });
  });

  test('title 81, body 201, unknown screen or an extra field is 400', async () => {
    const { app, rows } = build();
    for (const body of [
      { ...BODY, title: 'x'.repeat(81) },
      { ...BODY, body: 'x'.repeat(201) },
      { ...BODY, screen: 'settings' },
      { ...BODY, extra: true },
    ]) {
      const res = await post(app, body);
      assert.equal(res.status, 400);
    }
    assert.equal(rows.length, 0);
  });

  test('screen defaults to home', async () => {
    const { app } = build();
    const { screen: _screen, ...noScreen } = BODY;
    const res = await post(app, noScreen);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.announcement.screen, 'home');
  });
});

describe('festival announcements admin GET and DELETE', () => {
  test('GET returns the festival name, audience size and rows, with no-store', async () => {
    const { app } = build({ audience: 5 });
    await post(app);
    const res = await request(app).get(BASE).set('x-test-admin', '1');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.data.festivalName, 'Test Fest');
    assert.equal(res.body.data.recipients, 5);
    assert.equal(res.body.data.announcements.length, 1);
  });

  test('GET for an unknown festival is 404', async () => {
    const { app } = build({ exists: false });
    const res = await request(app).get(BASE).set('x-test-admin', '1');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.message, 'Festival not found');
  });

  test('bad festival id is 400 Invalid festival ID', async () => {
    const { app } = build();
    const res = await request(app).get('/api/v1/admin/festivals/bad%20id/announcements').set('x-test-admin', '1');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.message, 'Invalid festival ID');
  });

  test('DELETE cancels, writes one audit row, and cancelling twice returns the same row', async () => {
    const { app, calls } = build();
    const created = await post(app, { ...BODY, sendAt: new Date(Date.now() + HOUR).toISOString() });
    const id = created.body.data.announcement.id;
    calls.audit.length = 0;
    const first = await request(app).delete(`${BASE}/${id}`).set('x-test-admin', '1');
    await flush();
    assert.equal(first.status, 200);
    assert.ok(first.body.data.announcement.cancelledAt);
    assert.equal(calls.audit.length, 1);
    assert.equal(calls.audit[0].action, 'festival.announcement.cancelled');
    assert.deepEqual(JSON.parse(calls.audit[0].detailsJson), { announcementId: id, wasSent: false });
    const second = await request(app).delete(`${BASE}/${id}`).set('x-test-admin', '1');
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.data.announcement, first.body.data.announcement);
  });

  test('DELETE of an unknown announcement is 404', async () => {
    const { app } = build();
    const res = await request(app).delete(`${BASE}/nope`).set('x-test-admin', '1');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.message, 'Announcement not found');
  });

  test('a non-admin gets 403 on every admin route', async () => {
    const { app } = build();
    for (const res of [
      await request(app).get(BASE),
      await request(app).post(BASE).send(BODY),
      await request(app).delete(`${BASE}/a1`),
    ]) {
      assert.equal(res.status, 403);
    }
  });
});

describe('festival announcements public GET', () => {
  test('a guest gets 200 with the public fields only, with no-store', async () => {
    const { app, rows } = build();
    await post(app);
    rows[0].sentAt = new Date().toISOString();
    const res = await request(app).get('/api/v1/festivals/f1/announcements');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(res.body.data[0]).sort(), [
      'body',
      'festivalId',
      'id',
      'screen',
      'sentAt',
      'severity',
      'title',
    ]);
  });

  test('a draft festival returns [] even with rows', async () => {
    const { app, rows } = build({ publishedAt: null });
    rows.push({ id: 'a1', festivalId: 'f1', sentAt: new Date().toISOString(), cancelledAt: null });
    const res = await request(app).get('/api/v1/festivals/f1/announcements');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
  });

  test('a missing festival returns [], not 404', async () => {
    const { app } = build({ exists: false });
    const res = await request(app).get('/api/v1/festivals/nope/announcements');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
  });
});
