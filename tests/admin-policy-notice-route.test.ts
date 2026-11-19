/**
 * POST /api/v1/admin/policy-notice on stub deps. No database and no mail: the pool is an in-memory
 * ledger and sendPolicyNoticeEmail is a mock. The real adminAuth and requireRecentAuth are covered
 * elsewhere; these stubs answer with the same statuses.
 */
import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { AUDIT_ACTIONS } from '../lib/audit-actions.js';
import { sendPolicyNoticeEmail } from '../lib/email.js';
import { policyNoticeSchema } from '../lib/schemas.js';
import mountAdminPolicyNoticeRoutes from '../routes/admin-policy-notice.js';

const pass = (_req: any, _res: any, next: any) => next();
const BODY = { noticeId: 'policy-2026-11', subject: 'Policy update', text: 'We changed the policy.', mode: 'send' };

function build(opts: { users?: Array<{ id: string; email: string }>; sent?: string[]; failFor?: string[] } = {}) {
  const users = opts.users ?? [
    { id: 'u1', email: 'a@example.test' },
    { id: 'u2', email: 'b@example.test' },
    { id: 'u3', email: 'c@example.test' },
  ];
  const ledger = new Set(opts.sent ?? []);
  const state = { recent: false };
  const eligible = () => users.filter((u) => !ledger.has(u.id));
  const query = mock.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO policy_notice_sends')) {
      ledger.add(params[1]);
      return { rows: [] };
    }
    if (sql.includes('count(*)') && sql.includes('FROM policy_notice_sends s')) return { rows: [{ n: eligible().length }] };
    if (sql.includes('count(*)')) return { rows: [{ n: ledger.size }] };
    if (sql.includes('SELECT u.id, u.email')) {
      return { rows: eligible().filter((u) => u.id > params[1]).slice(0, params[2]) };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  const lockQuery = mock.fn(async (_sql: string) => ({ rows: [{ locked: true }] }));
  const insert = mock.fn(async (_row: any) => {});
  const sendNotice = mock.fn(async ({ to }: any) => !(opts.failFor ?? []).includes(to));
  const deps: any = {
    express,
    log: { info() {}, warn() {}, error() {}, debug() {} },
    config: {},
    rateLimit: () => pass,
    validate: (schema: any) => (req: any, res: any, next: any) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR' } });
      req.validatedBody = parsed.data;
      next();
    },
    schemas: { policyNotice: policyNoticeSchema },
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: number, message: string, code: string) => res.status(status).json({ data: null, error: { message, code } }),
    ErrorCodes: { ALREADY_EXISTS: 'ALREADY_EXISTS', INTERNAL_ERROR: 'INTERNAL_ERROR', REAUTH_REQUIRED: 'REAUTH_REQUIRED' },
    getRequestIp: () => '127.0.0.1',
    setNoStore: (res: any) => res.setHeader('Cache-Control', 'no-store'),
    requireRecentAuth: (_req: any, res: any, next: any) =>
      state.recent ? next() : res.status(403).json({ data: null, error: { code: 'REAUTH_REQUIRED' } }),
    adminAuth: (req: any, res: any, next: any) => {
      if (req.get('x-who') !== 'admin') return res.status(403).json({ error: { code: 'FORBIDDEN' } });
      req.user = { userId: 'admin1' };
      next();
    },
    stores: { pool: { query, connect: async () => ({ query: lockQuery, release: mock.fn() }) }, auditLog: { insert } },
    sendPolicyNoticeEmail: sendNotice,
    policyNoticeBatchDelayMs: 0,
  };
  const router = express.Router();
  mountAdminPolicyNoticeRoutes({ router, deps, ctx: { adminWriteLimit: pass } });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin', router);
  const post = (body: unknown) => request(app).post('/api/v1/admin/policy-notice').set('x-who', 'admin').send(body as object);
  return { post, state, ledger, sendNotice, insert, app };
}

describe('POST /admin/policy-notice', () => {
  test('403 for a non-admin and 400 for a bad body, and nothing is sent', async () => {
    const { app, post, sendNotice } = build();
    await request(app).post('/api/v1/admin/policy-notice').send(BODY).expect(403);
    await post({ ...BODY, mode: 'blast' }).expect(400);
    await post({ ...BODY, noticeId: 'x' }).expect(400);
    assert.equal(sendNotice.mock.callCount(), 0);
  });

  test('dry-run returns a count and no addresses, and sends and audits nothing', async () => {
    const { post, sendNotice, insert } = build({ sent: ['u1'] });
    const res = await post({ ...BODY, mode: 'dry-run' }).expect(200);
    assert.deepEqual(res.body.data, { mode: 'dry-run', recipients: 2, skipped: 1 });
    assert.doesNotMatch(JSON.stringify(res.body), /@example\.test/);
    assert.equal(sendNotice.mock.callCount(), 0);
    assert.equal(insert.mock.callCount(), 0);
  });

  test('send without a recent re-auth is 403 REAUTH_REQUIRED and sends nothing', async () => {
    const { post, sendNotice } = build();
    const res = await post(BODY).expect(403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
    assert.equal(sendNotice.mock.callCount(), 0);
  });

  test('send mails every eligible user once, records each, and writes one audit row', async () => {
    const { post, state, ledger, sendNotice, insert } = build();
    state.recent = true;
    const res = await post(BODY).expect(200);
    assert.deepEqual(res.body.data, { mode: 'send', sent: 3, failed: 0, skipped: 0, remaining: 0 });
    assert.equal(sendNotice.mock.callCount(), 3);
    assert.deepEqual([...ledger].sort(), ['u1', 'u2', 'u3']);
    assert.equal(insert.mock.callCount(), 1);
    const row = insert.mock.calls[0]?.arguments[0];
    assert.equal(row?.action, AUDIT_ACTIONS.POLICY_NOTICE_SENT);
    assert.equal(row?.targetId, BODY.noticeId);
  });

  test('send skips users who are already recorded', async () => {
    const { post, state, sendNotice } = build({ sent: ['u1', 'u3'] });
    state.recent = true;
    const res = await post(BODY).expect(200);
    assert.deepEqual(res.body.data, { mode: 'send', sent: 1, failed: 0, skipped: 2, remaining: 0 });
    assert.deepEqual(sendNotice.mock.calls.map((c) => c.arguments[0].to), ['b@example.test']);
  });

  test('a failed send is counted as failed and not recorded', async () => {
    const { post, state, ledger } = build({ failFor: ['b@example.test'] });
    state.recent = true;
    const res = await post(BODY).expect(200);
    assert.deepEqual(res.body.data, { mode: 'send', sent: 2, failed: 1, skipped: 0, remaining: 1 });
    assert.equal(ledger.has('u2'), false);
    assert.deepEqual([...ledger].sort(), ['u1', 'u3']);
  });
});

describe('sendPolicyNoticeEmail', () => {
  const run = async (args: any) => {
    const send = mock.fn(async (_msg: any) => ({ data: { id: 'm1' }, error: null }));
    const ok = await sendPolicyNoticeEmail({
      to: 'a@example.test',
      subject: 'Policy update',
      config: { RESEND_API_KEY: 'test-key' },
      log: { info() {}, warn() {}, error() {}, debug() {} },
      _client: { emails: { send } },
      ...args,
    });
    return { ok, message: send.mock.calls[0]?.arguments[0] };
  };

  test('escapes the text, adds the service-notice line, and sets no unsubscribe header', async () => {
    const { ok, message } = await run({ text: 'Hello <script>alert(1)</script>\n\nSecond & last' });
    assert.equal(ok, true);
    assert.doesNotMatch(message.html, /<script>/);
    assert.match(message.html, /&lt;script&gt;/);
    assert.match(message.html, /service notice about changes to the Festie Privacy Policy and Terms/);
    assert.match(message.text, /service notice about changes to the Festie Privacy Policy and Terms/);
    assert.equal(message.headers, undefined);
  });

  test('uses the admin html as given', async () => {
    const { message } = await run({ text: 'plain', html: '<p><b>Bold</b></p>' });
    assert.match(message.html, /<p><b>Bold<\/b><\/p>/);
  });

  test('sends the same address and subject twice, since the ledger is the guard', async () => {
    const send = mock.fn(async (_msg: any) => ({ data: { id: 'm1' }, error: null }));
    const args = { to: 'twice@example.test', subject: 'Policy update', text: 'plain', config: { RESEND_API_KEY: 'test-key' }, log: { info() {}, warn() {}, error() {}, debug() {} }, _client: { emails: { send } } };
    await sendPolicyNoticeEmail(args);
    await sendPolicyNoticeEmail(args);
    assert.equal(send.mock.callCount(), 2);
  });
});
