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

function build({ recipients = 2, name = 'Test Fest 2026', publishedAt = '2026-01-01T00:00:00.000Z' as string | null } = {}) {
  const calls = { sendLineupDrop: 0, audit: [] as any[] };
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
    },
    reengagementExecutor: { countLineupDrop: async () => ({ festivalName: name, recipients }) },
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
    assert.deepEqual(res.body.data, { festivalName: 'Test Fest 2026', recipients: 2 });
  });

  test('POST queues the send and writes an audit row', async () => {
    const { app, calls } = build();
    const res = await request(app).post('/api/v1/admin/festivals/f1/lineup-announcement');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { queued: true, recipients: 2 });
    assert.equal(calls.sendLineupDrop, 1);
    assert.equal(calls.audit[0].action, 'lineup_announce');
  });

  test('POST with zero recipients is 400 and sends nothing', async () => {
    const { app, calls } = build({ recipients: 0 });
    const res = await request(app).post('/api/v1/admin/festivals/f1/lineup-announcement');
    assert.equal(res.status, 400);
    assert.equal(calls.sendLineupDrop, 0);
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
});
