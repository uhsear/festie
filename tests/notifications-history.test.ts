/**
 * The in-app inbox read side: GET /notifications/history returns only the
 * user's own platform 'inbox' rows, and notificationLog.countRecentPushes
 * counts only the rows the push budget counts.
 *
 * DB-gated like tests/account.test.ts (TEST_DATABASE_URL must contain '_test').
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import createNotificationsStore from '../lib/db/stores/notifications.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
// The shared helpers exit the process without a test database, so load them only when it exists.
const helpers = skip ? null : await import('./_integration-helpers');

const runTag = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

describe('GET /notifications/history (database)', { concurrency: 1, skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });

  it('returns only inbox rows, newest first, and data holds only the four allowed keys', async () => {
    const h = helpers!;
    const server = await h.startServer();
    servers.push(server);
    const tag = runTag();
    const a = await h.registerUser(server, `inboxa-${tag}`);
    const b = await h.registerUser(server, `inboxb-${tag}`);
    const userA = a.user.id as string;
    const userB = b.user.id as string;

    const pool = new h.Pool({ connectionString: h.TEST_DATABASE_URL });
    try {
      const sosData = JSON.stringify({
        deepLink: 'https://festie.us/crew?sos=u1',
        crewId: 'c1',
        lat: '1',
        lng: '2',
        eventKey: 'e1',
        announcementId: 'an1',
        userId: 'u9',
      });
      await pool.query(
        `INSERT INTO notification_log (id, user_id, type, title, body, data_json, status, platform, created_at)
         VALUES ('n-held', $1, 'schedule_change', 'Moved', 'Set moved', '{"setId":"s1"}', 'held', 'inbox', NOW() - INTERVAL '1 minute'),
                ('n-inbox', $1, 'crew_sos', 'SOS', 'Alex needs help', $3, 'inbox', 'inbox', NOW()),
                ('n-device', $1, 'crew_sos', 'SOS', 'Alex needs help', $3, 'sent', 'android', NOW()),
                ('n-email', $1, 'wrap_ready', 'Wrap', 'Your Wrap', '{"eventKey":"w1"}', 'sent', 'email', NOW()),
                ('n-other', $2, 'crew_update', 'Other user', 'Not yours', '{}', 'inbox', 'inbox', NOW())`,
        [userA, userB, sosData],
      );
    } finally {
      await pool.end();
    }

    const res = await server.request
      .get('/api/v1/notifications/history')
      .set('x-user-token', a.token as string)
      .expect(200);
    assert.deepEqual(
      res.body.data.map((item: any) => item.id),
      ['n-inbox', 'n-held'],
    );
    const [sos, held] = res.body.data;
    assert.deepEqual(Object.keys(sos).sort(), ['body', 'createdAt', 'data', 'id', 'title', 'type']);
    assert.deepEqual(sos.data, { deepLink: 'https://festie.us/crew?sos=u1', crewId: 'c1' });
    assert.deepEqual(held.data, { setId: 's1' });

    const resB = await server.request
      .get('/api/v1/notifications/history')
      .set('x-user-token', b.token as string)
      .expect(200);
    assert.deepEqual(
      resB.body.data.map((item: any) => item.id),
      ['n-other'],
    );
  });

  it('countRecentPushes counts only recent, non-held, non-exempt inbox rows', async () => {
    const h = helpers!;
    const server = await h.startServer();
    servers.push(server);
    const tag = runTag();
    const a = await h.registerUser(server, `budgeta-${tag}`);
    const b = await h.registerUser(server, `budgetb-${tag}`);
    const userA = a.user.id as string;
    const userB = b.user.id as string;

    const pool = new h.Pool({ connectionString: h.TEST_DATABASE_URL });
    try {
      await pool.query(
        `INSERT INTO notification_log (id, user_id, type, title, body, data_json, status, platform, created_at)
         VALUES ('c-1', $1, 'schedule_change', 't', 'b', '{}', 'inbox', 'inbox', NOW()),
                ('c-2', $1, 'crew_update', 't', 'b', '{}', 'inbox', 'inbox', NOW() - INTERVAL '30 minutes'),
                ('c-held', $1, 'crew_update', 't', 'b', '{}', 'held', 'inbox', NOW()),
                ('c-device', $1, 'crew_update', 't', 'b', '{}', 'sent', 'android', NOW()),
                ('c-sos', $1, 'crew_sos', 't', 'b', '{}', 'inbox', 'inbox', NOW()),
                ('c-reminder', $1, 'set_reminder', 't', 'b', '{}', 'inbox', 'inbox', NOW()),
                ('c-old', $1, 'crew_update', 't', 'b', '{}', 'inbox', 'inbox', NOW() - INTERVAL '2 hours'),
                ('c-b', $2, 'crew_update', 't', 'b', '{}', 'inbox', 'inbox', NOW())`,
        [userA, userB],
      );
      const { notificationLog } = createNotificationsStore(pool, {});
      const counts = await notificationLog.countRecentPushes([userA, userB, 'no-such-user'], ['crew_sos', 'set_reminder']);
      assert.equal(counts.get(userA), 2);
      assert.equal(counts.get(userB), 1);
      assert.equal(counts.has('no-such-user'), false);
    } finally {
      await pool.end();
    }
  });
});
