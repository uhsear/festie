import 'dotenv/config';
/**
 * Per-date set-time releases (routes/time-releases.ts) against a real database: the claim, the
 * refusals, the preview and the retry. The route runs with real stores and a spy for the queue, so
 * "sent once" means the spy ran once per claimed event key. The fan-out itself is in reengagement.test.ts.
 *
 * Skip-gate on TEST_DATABASE_URL (a private Postgres whose name ends in _test, never 5432 or 5433).
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import createTimeReleasesRoute from '../routes/time-releases.js';
import { sanitizeIdentifier } from '../lib/helpers/sanitize.js';
import { ErrorCodes, sendError, sendSuccess } from '../lib/response.js';
import { schemas, validate } from '../lib/schemas.js';
import { createReengagementTriggers } from '../lib/notifications/reengagement.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');

const FRI = '2099-02-05';
const SAT = '2099-02-06';
const SUN = '2099-02-07';
const ID = 'tr-fest';

const set = (id: string, startTime: string | null) => ({ id, artist: id, artists: [{ name: id }], stageId: 'main', startTime, endTime: null });
const festival = (days: any[], over: any = {}) => ({
  id: ID,
  name: 'Wasteland',
  location: 'Field',
  timeZone: 'America/New_York',
  stages: [{ id: 'main', name: 'Main', color: '#ff3366' }],
  days,
  publishedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const FULL_DAYS = [
  { label: 'Friday', date: FRI, sets: [set('a1', '20:00'), set('a2', '21:00')] },
  { label: 'Saturday', date: SAT, sets: [set('b1', '20:00'), set('b2', null)] },
  { label: 'Sunday', date: SUN, sets: [set('c1', null)] },
];

describe('time-release routes', { skip, concurrency: 1 }, () => {
  let pool: Pool;
  let stores: any;
  let sendTimeRelease: ReturnType<typeof mock.fn>;
  let audit: any[];
  let audience: string[];
  let app: express.Express;

  const sql = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
  const create = async (f: any) => {
    await stores.festivals.create(f);
  };
  const post = (body: unknown) => request(app).post(`/${ID}/time-releases`).send(body as any);
  const get = () => request(app).get(`/${ID}/time-releases`);

  before(async () => {
    const { ensureTestSchema } = await import('./_test-schema');
    await ensureTestSchema(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const { createStores } = await import('../lib/db/index.js');
    stores = createStores(pool, { nodeEnv: 'test' });
  });

  beforeEach(async () => {
    await stores.festivals.hardDelete(ID);
    sendTimeRelease = mock.fn(async (_id: string, _key: string) => ({ queued: true }));
    audit = [];
    audience = ['u1', 'u2', 'u3'];
    const deps: any = {
      express,
      config: { EMAIL_POSTAL_ADDRESS: '' },
      log: { info() {}, warn() {}, error() {}, debug() {} },
      adminAuth: (req: any, _res: any, next: any) => {
        req.user = { userId: 'admin-1' };
        next();
      },
      rateLimit: () => (_req: any, _res: any, next: any) => next(),
      sanitizeIdentifier,
      sendSuccess,
      sendError,
      ErrorCodes,
      setNoStore: () => {},
      getRequestIp: () => '127.0.0.1',
      reengagement: { sendTimeRelease },
      reengagementExecutor: {
        resolveFollowersAndProfileHolders: async () => audience,
        countTimeRelease: async () => ({ recipients: audience.length, emailRecipients: 1, emailCut: 2, emailOff: 'no_postal_address' }),
      },
      schemas,
      validate,
      stores: { ...stores, auditLog: { insert: async (row: any) => audit.push(row) } },
    };
    app = express();
    app.use(express.json());
    app.use(createTimeReleasesRoute(deps));
  });

  after(async () => {
    if (!pool) return;
    await stores.festivals.hardDelete(ID);
    await pool.end();
  });

  test('two overlapping requests for one date claim it once and send once', async () => {
    await create(festival(FULL_DAYS));
    const [a, b] = await Promise.all([post({ dates: [FRI] }), post({ dates: [FRI] })]);
    assert.deepEqual([a.status, b.status].sort(), [202, 409]);
    const loser = a.status === 409 ? a : b;
    assert.equal(loser.body.error.code, 'ALREADY_RELEASED');
    assert.equal(sendTimeRelease.mock.calls.length, 1);
    const rows = await sql('SELECT day_date, event_key FROM festival_time_releases WHERE festival_id = $1', [ID]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].event_key, new RegExp(`^times:${ID}:[0-9a-f-]{36}$`));
    assert.deepEqual(sendTimeRelease.mock.calls[0]!.arguments, [ID, rows[0].event_key]);
  });

  test('a second send for a released date answers ALREADY_RELEASED with each date and its state', async () => {
    await create(festival(FULL_DAYS));
    await post({ dates: [FRI] }).expect(202);
    const again = await post({ dates: [FRI] }).expect(409);
    assert.equal(again.body.error.code, 'ALREADY_RELEASED');
    assert.deepEqual(again.body.error.releases.map((r: any) => [r.date, r.sentAt]), [[FRI, null]]);
    assert.equal(sendTimeRelease.mock.calls.length, 1);
  });

  test('Friday sent, then [Fri, Sat]: only Saturday is claimed, under its own key', async () => {
    await create(festival(FULL_DAYS));
    await post({ dates: [FRI] }).expect(202);
    const second = await post({ dates: [FRI, SAT], confirmPartial: true }).expect(202);
    assert.deepEqual(second.body.data.dates, [SAT]);
    assert.deepEqual(second.body.data.skipped, [FRI]);
    const rows = await sql('SELECT day_date, event_key FROM festival_time_releases WHERE festival_id = $1 ORDER BY day_date', [ID]);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].event_key, rows[1].event_key);
    assert.deepEqual(sendTimeRelease.mock.calls.map((c: any) => c.arguments[1]), [rows[0].event_key, rows[1].event_key]);
  });

  test('two dates claimed together share one key and one send', async () => {
    await create(festival(FULL_DAYS));
    await post({ dates: [FRI, SAT], confirmPartial: true }).expect(202);
    const rows = await sql('SELECT event_key FROM festival_time_releases WHERE festival_id = $1', [ID]);
    assert.equal(new Set(rows.map((r: any) => r.event_key)).size, 1);
    assert.equal(sendTimeRelease.mock.calls.length, 1);
  });

  test('a claim that never finished is retaken after ten minutes with its stored key, even after another day is timed', async () => {
    await create(festival(FULL_DAYS));
    await post({ dates: [FRI] }).expect(202);
    const [{ event_key: storedKey }] = await sql('SELECT event_key FROM festival_time_releases WHERE festival_id = $1', [ID]);

    // Inside ten minutes the claim still holds.
    await post({ dates: [FRI] }).expect(409);
    assert.equal(sendTimeRelease.mock.calls.length, 1);

    // The first send crashed. Meanwhile Sunday got its first time.
    await pool.query(`UPDATE festival_time_releases SET claimed_at = NOW() - INTERVAL '11 minutes' WHERE festival_id = $1`, [ID]);
    await pool.query(`UPDATE festival_sets SET start_time = '22:00' WHERE id = 'c1'`);
    const retry = await post({ dates: [FRI] }).expect(202);
    assert.deepEqual(retry.body.data.dates, [FRI]);
    assert.equal(sendTimeRelease.mock.calls.length, 2);
    assert.deepEqual(sendTimeRelease.mock.calls[1]!.arguments, [ID, storedKey], 'same event key, so reached users are skipped');
    const rows = await sql('SELECT claimed_at FROM festival_time_releases WHERE festival_id = $1', [ID]);
    assert.ok(Date.now() - new Date(rows[0].claimed_at).getTime() < 60_000, 'the retake restarts the ten minutes');
  });

  test('a finished release is never retaken, however old', async () => {
    await create(festival(FULL_DAYS));
    await post({ dates: [FRI] }).expect(202);
    await pool.query(`UPDATE festival_time_releases SET claimed_at = NOW() - INTERVAL '2 days', sent_at = NOW() - INTERVAL '2 days' WHERE festival_id = $1`, [ID]);
    await post({ dates: [FRI] }).expect(409);
    assert.equal(sendTimeRelease.mock.calls.length, 1);
  });

  test('a date with untimed sets needs confirmPartial, and the answer carries the counts', async () => {
    await create(festival(FULL_DAYS));
    const refused = await post({ dates: [SAT] }).expect(409);
    assert.equal(refused.body.error.code, 'PARTIAL_RELEASE');
    assert.deepEqual(refused.body.error.partial, [{ date: SAT, label: 'Saturday', timed: 1, total: 2 }]);
    assert.equal(sendTimeRelease.mock.calls.length, 0);
    assert.deepEqual(await sql('SELECT 1 FROM festival_time_releases WHERE festival_id = $1', [ID]), []);

    const sent = await post({ dates: [SAT], confirmPartial: true }).expect(202);
    assert.deepEqual(sent.body.data.dates, [SAT]);
    assert.equal(sendTimeRelease.mock.calls.length, 1);
  });

  test('a date that is not a day of the festival, or has no timed set, is a 400 that names it', async () => {
    await create(festival(FULL_DAYS));
    const none = await post({ dates: [SUN] }).expect(400);
    assert.match(none.body.error.message, new RegExp(SUN));
    const stranger = await post({ dates: [FRI, '2099-03-01'] }).expect(400);
    assert.match(stranger.body.error.message, /2099-03-01/);
    assert.equal(sendTimeRelease.mock.calls.length, 0);
    assert.deepEqual(await sql('SELECT 1 FROM festival_time_releases WHERE festival_id = $1', [ID]), []);
  });

  test('a draft is refused with DRAFT and a finished festival with FESTIVAL_OVER', async () => {
    await create(festival(FULL_DAYS, { publishedAt: null }));
    const draft = await post({ dates: [FRI] }).expect(409);
    assert.equal(draft.body.error.code, 'DRAFT');

    await stores.festivals.hardDelete(ID);
    const past = FULL_DAYS.map((d, i) => ({ ...d, date: `2020-01-0${i + 1}` }));
    await create(festival(past));
    const over = await post({ dates: ['2020-01-01'] }).expect(409);
    assert.equal(over.body.error.code, 'FESTIVAL_OVER');
    assert.equal(sendTimeRelease.mock.calls.length, 0);
    assert.deepEqual(await sql('SELECT 1 FROM festival_time_releases WHERE festival_id = $1', [ID]), []);
  });

  test('a missing festival is a 404, a bad body is a 400, and a note over 200 characters is refused', async () => {
    await request(app).post('/nope/time-releases').send({ dates: [FRI] }).expect(404);
    await create(festival(FULL_DAYS));
    await post({ dates: [] }).expect(400);
    await post({ dates: ['5 Feb'] }).expect(400);
    await post({ dates: [FRI], note: 'x'.repeat(201) }).expect(400);
    await post({ dates: [FRI], extra: true }).expect(400);
  });

  test('the note is stored on the claimed row, and the audit row records the release', async () => {
    await create(festival(FULL_DAYS));
    const res = await post({ dates: [FRI], note: '  Gates at noon.  ' }).expect(202);
    assert.equal(res.body.data.recipients, 3);
    const [row] = await sql('SELECT note FROM festival_time_releases WHERE festival_id = $1', [ID]);
    assert.equal(row.note, 'Gates at noon.');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'festival.times.released');
    assert.deepEqual(JSON.parse(audit[0].detailsJson), { dates: [FRI], recipients: 3, customLine: true, partial: [] });
  });

  test('GET lists each date with its counts, claim state, preview title and the recipient ceiling', async () => {
    await create(festival(FULL_DAYS));
    await post({ dates: [FRI] }).expect(202);
    const res = await get().expect(200);
    const data = res.body.data;
    assert.equal(data.canSend, true);
    assert.equal(data.recipientsNow, 3);
    assert.equal(data.emailOff, 'no_postal_address');
    assert.equal(data.emailRecipients, 1);
    assert.equal(data.emailCut, 2);
    assert.equal(data.defaultBody, 'See who plays when and build your plan.');
    assert.deepEqual(data.dates.map((d: any) => [d.date, d.timed, d.total, d.sentAt]), [
      [FRI, 2, 2, null],
      [SAT, 1, 2, null],
      [SUN, 0, 1, null],
    ]);
    assert.ok(data.dates[0].claimedAt);
    assert.equal(data.dates[1].claimedAt, null);
    assert.equal(data.dates[1].previewTitle, 'Wasteland: Saturday set times are out');
    assert.deepEqual(data.orphanDates, []);
  });

  test('GET reports a release for a date no day uses as an orphan', async () => {
    await create(festival(FULL_DAYS));
    await post({ dates: [FRI] }).expect(202);
    await pool.query(`UPDATE festival_time_releases SET day_date = '2099-02-04' WHERE festival_id = $1`, [ID]);
    const data = (await get().expect(200)).body.data;
    assert.deepEqual(data.orphanDates.map((o: any) => o.date), ['2099-02-04']);
    assert.equal(data.dates[0].claimedAt, null);
  });

  test('GET says canSend false for a draft and for a finished festival, and 404 for a missing one', async () => {
    await create(festival(FULL_DAYS, { publishedAt: null }));
    assert.equal((await get().expect(200)).body.data.canSend, false);
    await stores.festivals.hardDelete(ID);
    await create(festival(FULL_DAYS.map((d, i) => ({ ...d, date: `2020-01-0${i + 1}` }))));
    assert.equal((await get().expect(200)).body.data.canSend, false);
    await request(app).get('/nope/time-releases').expect(404);
  });

  test('deleting the festival removes its release rows', async () => {
    await create(festival(FULL_DAYS));
    await post({ dates: [FRI] }).expect(202);
    await stores.festivals.hardDelete(ID);
    assert.deepEqual(await sql('SELECT 1 FROM festival_time_releases WHERE festival_id = $1', [ID]), []);
  });
  test('a failed enqueue un-claims the dates this request claimed, so the admin can send again', async () => {
    await create(festival(FULL_DAYS));
    sendTimeRelease.mock.mockImplementationOnce(async () => {
      throw new Error('queue down');
    });
    await post({ dates: [FRI] }).expect(500);
    assert.deepEqual(await sql('SELECT 1 FROM festival_time_releases WHERE festival_id = $1', [ID]), []);
    await post({ dates: [FRI] }).expect(202);
    assert.equal(sendTimeRelease.mock.calls.length, 2);
  });

  describe('the send job and the stuck window', () => {
    const KEY = `times:${ID}:22222222-2222-4222-8222-222222222222`;
    let triggers: any;
    let reached: number;
    let gate: Promise<void>;
    let release: () => void;
    let pushStarted: Promise<void>;

    beforeEach(async () => {
      await create(festival(FULL_DAYS));
      await stores.timeReleases.claim(ID, [FRI], KEY, null);
      await pool.query(`UPDATE festival_time_releases SET claimed_at = NOW() - INTERVAL '11 minutes' WHERE festival_id = $1`, [ID]);
      reached = 3;
      let started!: () => void;
      pushStarted = new Promise((r) => (started = r));
      gate = new Promise((r) => (release = r));
      // Real festival_time_releases rows; the audience and the delivery log are stubbed.
      const dbProxy = {
        query: async (text: string, params: unknown[]) => {
          if (/festival_follows f\s/.test(text)) return { rows: audience.map((userId) => ({ userId })) };
          if (text.includes('FROM notification_log')) return { rows: [{ reached }] };
          return pool.query(text, params as any[]);
        },
      };
      triggers = createReengagementTriggers({
        stores: {
          festivals: stores.festivals,
          users: { getByIds: async () => new Map() },
          notificationPrefs: { get: async () => null },
          notificationLog: { existsForEvents: async () => new Set(), insert: async () => {} },
        },
        config: { PUBLIC_ORIGIN: 'https://festie.test', RESEND_API_KEY: '', EMAIL_POSTAL_ADDRESS: '' },
        log: { info() {}, warn() {}, debug() {}, error() {} },
        notificationService: {
          isConfigured: true,
          send: async () => {
            started();
            await gate;
            return { sent: 1 };
          },
        },
        pool: dbProxy,
      });
    });

    test('a running job keeps its claim fresh, so reclaimStuck cannot take it', async () => {
      mock.timers.enable({ apis: ['setInterval'] });
      try {
        const job = triggers.sendTimeRelease(ID, KEY);
        await pushStarted;
        mock.timers.tick(60_000);
        for (let i = 0; i < 100; i++) {
          const [row] = await sql(`SELECT claimed_at > NOW() - INTERVAL '1 minute' AS fresh FROM festival_time_releases WHERE festival_id = $1`, [ID]);
          if (row.fresh) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        assert.deepEqual(await stores.timeReleases.reclaimStuck(ID, [FRI]), []);
        release();
        await job;
      } finally {
        mock.timers.reset();
      }
    });

    test('a send that reached nobody leaves the date claimable and unstamped', async () => {
      reached = 0;
      release();
      const r = await triggers.sendTimeRelease(ID, KEY);
      assert.equal(r.reason, 'none_reached');
      assert.deepEqual(await sql('SELECT 1 FROM festival_time_releases WHERE festival_id = $1', [ID]), []);
      assert.equal((await stores.timeReleases.claim(ID, [FRI], 'times:retry', null)).length, 1);
    });
  });
});
