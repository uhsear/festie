import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { MARKETING_EMAIL_TYPES, unsubscribeToken, verifyUnsubscribeToken, sendEmail, sendPasswordResetEmail, sendVerificationEmail, sendWrapReadyEmail, sendLineupDropEmail, sendCrewReformEmail, sendEmailChangeConfirmEmail, sendEmailChangeNoticeEmail, sendEmailChangedEmail, sendSetTimesOutEmail, sendDaysOutEmail } from '../lib/email.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClient(sendFn?: any) {
  return {
    emails: {
      send: sendFn || mock.fn(async () => ({ data: { id: 'msg-123' }, error: null })),
    },
  };
}

function createMockLog() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

function createMockConfig(overrides: any = {}) {
  return {
    RESEND_API_KEY: 'test-api-key',
    EMAIL_FROM: 'Festie <test@festie.us>',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

describe('email: sendEmail', () => {
  it('returns false and logs warning when RESEND_API_KEY is not configured', async () => {
    const log = createMockLog();
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
      config: { RESEND_API_KEY: '' },
      log,
    });
    assert.equal(result, false);
    assert.equal(log.warn.mock.callCount(), 1);
  });

  it('logs an error, not a warning, when RESEND_API_KEY is missing in production', async () => {
    const log = createMockLog();
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
      config: { RESEND_API_KEY: '', NODE_ENV: 'production' },
      log,
    });
    assert.equal(result, false);
    assert.equal(log.error.mock.callCount(), 1);
    assert.equal(log.warn.mock.callCount(), 0);
  });

  it('returns false when config has no RESEND_API_KEY key at all', async () => {
    const log = createMockLog();
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
      text: 'Hi',
      config: {},
      log,
    });
    assert.equal(result, false);
  });

  it('logs email:sent at info with the Resend id and type, and never the recipient, subject or body', async () => {
    const log = createMockLog();
    const sendMock = mock.fn(async () => ({ data: { id: 'msg-sent-1' }, error: null }));
    const ok = await sendPasswordResetEmail({
      to: 'private-person@example.com',
      username: 'privateperson',
      resetUrl: 'https://festie.test/reset?token=secret',
      config: createMockConfig(),
      log,
      _client: createMockClient(sendMock),
    });
    assert.equal(ok, true);
    const sent = log.info.mock.calls.filter((c: any) => c.arguments[0] === 'email:sent');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.arguments[1], { id: 'msg-sent-1', type: 'password_reset' });
    assert.equal(log.debug.mock.callCount(), 0);
    const logged = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls, ...log.debug.mock.calls]);
    assert.ok(!logged.includes('private-person'), 'the address must not be logged');
    assert.ok(!logged.includes('Reset your Festie password'), 'the subject must not be logged');
    assert.ok(!logged.includes('secret'), 'the body must not be logged');
  });

  it('suppresses duplicate sends within the idempotency window', async () => {
    const log = createMockLog();
    const sendMock = mock.fn(async () => ({ data: { id: 'msg-1' }, error: null }));
    const _client = createMockClient(sendMock);
    const config = createMockConfig();

    // First send should go through
    const first = await sendEmail({
      to: 'dup@example.com', subject: 'Dup Test',
      html: '<p>Hi</p>', text: 'Hi', config, log, _client,
    });
    assert.equal(first, true);

    // Second send with same to+subject should be suppressed
    const second = await sendEmail({
      to: 'dup@example.com', subject: 'Dup Test',
      html: '<p>Hi again</p>', text: 'Hi again', config, log, _client,
    });
    assert.equal(second, true); // returns true (suppressed, not error)
    assert.equal(sendMock.mock.callCount(), 1, 'Resend.send called only once');
  });

  it('shares the idempotency guard through Redis and falls back to memory when Redis errors', async () => {
    const store = new Map<string, string>();
    const redis = {
      exists: async (k: string) => (store.has(k) ? 1 : 0),
      set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
    };
    const sendMock = mock.fn(async () => ({ data: { id: 'msg-1' }, error: null }));
    const base = { to: 'redis-dup@example.com', subject: 'Redis Dup', html: '<p>x</p>', text: 'x', config: createMockConfig(), log: createMockLog(), _client: createMockClient(sendMock) };

    assert.equal(await sendEmail({ ...base, redis }), true);
    assert.equal(await sendEmail({ ...base, redis }), true);
    assert.equal(sendMock.mock.callCount(), 1, 'second send suppressed via Redis');
    assert.equal(store.size, 1, 'the dedupe key was written to Redis');
    assert.ok([...store.keys()].every((k) => !k.includes('redis-dup')), 'recipient must not appear in the Redis key');

    const brokenCalls = { exists: 0, set: 0 };
    const broken = {
      exists: async () => { brokenCalls.exists++; throw new Error('down'); },
      set: async () => { brokenCalls.set++; throw new Error('down'); },
    };
    const fb = { ...base, to: 'fallback-dup@example.com', redis: broken };
    assert.equal(await sendEmail(fb), true);
    assert.equal(await sendEmail(fb), true);
    assert.equal(sendMock.mock.callCount(), 2, 'memory fallback suppresses the repeat');
    assert.equal(brokenCalls.exists, 2, 'Redis was consulted before falling back');
    assert.equal(brokenCalls.set, 1, 'Redis write was attempted before falling back');
  });

  it('never suppresses a message sent with dedupe:false', async () => {
    // The email-change security alert has a constant recipient AND a constant
    // subject, so the (to + subject) idempotency guard let an attacker mint
    // three change links a minute while the victim got one alert per five
    // minutes. Alerts opt out; every send must reach the provider.
    const log = createMockLog();
    const sendMock = mock.fn(async () => ({ data: { id: 'msg-1' }, error: null }));
    const _client = createMockClient(sendMock);
    const config = createMockConfig();
    const alert = {
      to: 'victim@example.com',
      subject: 'Security alert: Festie email change requested',
      html: '<p>alert</p>',
      text: 'alert',
      config,
      log,
      _client,
      dedupe: false,
    };

    for (let i = 0; i < 3; i++) assert.equal(await sendEmail(alert), true);
    assert.equal(sendMock.mock.callCount(), 3, 'every security alert must be delivered');
  });

  it('a dedupe:false send does not poison the guard for ordinary mail', async () => {
    // Opting out skips recording as well as checking, so an alert can never
    // swallow a later ordinary message to the same address and subject.
    const log = createMockLog();
    const sendMock = mock.fn(async () => ({ data: { id: 'msg-1' }, error: null }));
    const _client = createMockClient(sendMock);
    const config = createMockConfig();
    const base = { to: 'shared@example.com', subject: 'Shared Subject', html: '<p>x</p>', text: 'x', config, log, _client };

    assert.equal(await sendEmail({ ...base, dedupe: false }), true);
    assert.equal(await sendEmail(base), true);
    assert.equal(sendMock.mock.callCount(), 2, 'the exempt send must not have been recorded');
  });

  it('returns false and logs error when Resend returns an error response', async () => {
    const log = createMockLog();
    const sendMock = mock.fn(async () => ({
      data: null,
      error: { message: 'Invalid API key' },
    }));
    const _client = createMockClient(sendMock);
    const config = createMockConfig();

    const result = await sendEmail({
      to: 'err@example.com', subject: 'Error Test',
      html: '<p>Hi</p>', text: 'Hi', config, log, _client,
    });
    assert.equal(result, false);
    assert.equal(log.error.mock.callCount(), 1);
  });

  it('returns false and logs error when Resend throws an exception', async () => {
    const log = createMockLog();
    const sendMock = mock.fn(async () => { throw new Error('Network timeout'); });
    const _client = createMockClient(sendMock);
    const config = createMockConfig();

    const result = await sendEmail({
      to: 'throw@example.com', subject: 'Throw Test',
      html: '<p>Hi</p>', text: 'Hi', config, log, _client,
    });
    assert.equal(result, false);
    assert.equal(log.error.mock.callCount(), 1);
  });

  it('never passes the recipient or subject to the logger', async () => {
    const log = createMockLog();
    const base = { to: 'pii@example.com', subject: 'Hello PiiName', html: '<p>x</p>', text: 'x' };
    const run = (config: any, send: any) =>
      sendEmail({ ...base, config, log, _client: createMockClient(mock.fn(send)) });

    await run(createMockConfig({ RESEND_API_KEY: '' }), async () => ({}));
    await run(createMockConfig(), async () => ({ data: { id: 'm1' }, error: null }));
    await run(createMockConfig(), async () => ({ data: { id: 'm1' }, error: null })); // duplicate
    await run(createMockConfig(), async () => ({ data: null, error: { message: 'bad' } }));
    await run(createMockConfig(), async () => { throw new Error('boom'); });

    const calls = [log.warn, log.error, log.debug].flatMap((fn: any) => fn.mock.calls);
    assert.ok(calls.length >= 4);
    for (const call of calls) {
      assert.doesNotMatch(JSON.stringify(call.arguments), /pii@example\.com|PiiName/);
    }
  });
});

// ---------------------------------------------------------------------------
// sendPasswordResetEmail
// ---------------------------------------------------------------------------

describe('email: sendPasswordResetEmail', () => {
  it('returns false when API key is missing (graceful degradation)', async () => {
    const log = createMockLog();
    const result = await sendPasswordResetEmail({
      to: 'user@example.com',
      username: 'alice',
      resetUrl: 'https://festie.us/reset/abc123',
      config: {},
      log,
    });
    assert.equal(result, false);
  });

  it('builds correct email content with password reset details', async () => {
    const log = createMockLog();
    let capturedArgs: any = null;
    const sendMock = mock.fn(async (args: any) => {
      capturedArgs = args;
      return { data: { id: 'msg-reset' }, error: null };
    });
    const _client = createMockClient(sendMock);
    const config = createMockConfig();

    await sendPasswordResetEmail({
      to: 'reset@example.com',
      username: 'alice',
      resetUrl: 'https://festie.us/reset/token123',
      config,
      log,
      _client,
    });

    assert.ok(capturedArgs, 'Resend.send should have been called');
    assert.deepEqual(capturedArgs.to, ['reset@example.com']);
    assert.equal(capturedArgs.subject, 'Reset your Festie password');
    assert.ok(capturedArgs.html.includes('alice'), 'HTML should contain username');
    assert.ok(capturedArgs.html.includes('https://festie.us/reset/token123'), 'HTML should contain reset URL');
    assert.ok(capturedArgs.html.includes('Reset Password'), 'HTML should contain button label');
    assert.ok(capturedArgs.html.includes('60 minutes'), 'HTML should mention expiry');
    assert.ok(capturedArgs.text.includes('alice'), 'Plain text should contain username');
    assert.ok(capturedArgs.text.includes('https://festie.us/reset/token123'), 'Plain text should contain reset URL');
    assert.equal(capturedArgs.from, 'Festie <test@festie.us>');
  });

  it('escapes HTML in username to prevent XSS', async () => {
    const log = createMockLog();
    let capturedArgs: any = null;
    const sendMock = mock.fn(async (args: any) => {
      capturedArgs = args;
      return { data: { id: 'msg-xss' }, error: null };
    });
    const _client = createMockClient(sendMock);
    const config = createMockConfig();

    await sendPasswordResetEmail({
      to: 'xss@example.com',
      username: '<script>alert(1)</script>',
      resetUrl: 'https://festie.us/reset/token',
      config,
      log,
      _client,
    });

    assert.ok(capturedArgs);
    assert.ok(!capturedArgs.html.includes('<script>alert(1)</script>'),
      'Raw script tag should be escaped in HTML');
    assert.ok(capturedArgs.html.includes('&lt;script&gt;'));
  });
});

// ---------------------------------------------------------------------------
// sendVerificationEmail
// ---------------------------------------------------------------------------

describe('email: sendVerificationEmail', () => {
  it('returns false when API key is missing (graceful degradation)', async () => {
    const log = createMockLog();
    const result = await sendVerificationEmail({
      to: 'user@example.com',
      username: 'bob',
      verifyUrl: 'https://festie.us/verify/abc',
      config: {},
      log,
    });
    assert.equal(result, false);
  });

  it('builds correct email content with verification details', async () => {
    const log = createMockLog();
    let capturedArgs: any = null;
    const sendMock = mock.fn(async (args: any) => {
      capturedArgs = args;
      return { data: { id: 'msg-verify' }, error: null };
    });
    const _client = createMockClient(sendMock);
    const config = createMockConfig();

    await sendVerificationEmail({
      to: 'verify@example.com',
      username: 'bob',
      verifyUrl: 'https://festie.us/verify/token456',
      config,
      log,
      _client,
    });

    assert.ok(capturedArgs, 'Resend.send should have been called');
    assert.deepEqual(capturedArgs.to, ['verify@example.com']);
    assert.equal(capturedArgs.subject, 'Verify your Festie email');
    assert.ok(capturedArgs.html.includes('bob'), 'HTML should contain username');
    assert.ok(capturedArgs.html.includes('https://festie.us/verify/token456'), 'HTML should contain verify URL');
    assert.ok(capturedArgs.html.includes('Verify Email'), 'HTML should contain button label');
    assert.ok(capturedArgs.html.includes('24 hours'), 'HTML should mention expiry');
    assert.ok(capturedArgs.text.includes('bob'), 'Plain text should contain username');
    assert.ok(capturedArgs.text.includes('https://festie.us/verify/token456'), 'Plain text should contain verify URL');
  });

  it('escapes HTML in username to prevent XSS', async () => {
    const log = createMockLog();
    let capturedArgs: any = null;
    const sendMock = mock.fn(async (args: any) => {
      capturedArgs = args;
      return { data: { id: 'msg-xss2' }, error: null };
    });
    const _client = createMockClient(sendMock);
    const config = createMockConfig();

    await sendVerificationEmail({
      to: 'xss2@example.com',
      username: 'A&B<C>',
      verifyUrl: 'https://festie.us/verify/t',
      config,
      log,
      _client,
    });

    assert.ok(capturedArgs);
    assert.ok(capturedArgs.html.includes('A&amp;B&lt;C&gt;'),
      'Username with special chars should be escaped in HTML body');
  });

  it('uses default EMAIL_FROM when not configured', async () => {
    const log = createMockLog();
    let capturedArgs: any = null;
    const sendMock = mock.fn(async (args: any) => {
      capturedArgs = args;
      return { data: { id: 'msg-from' }, error: null };
    });
    const _client = createMockClient(sendMock);
    // Config with API key but no EMAIL_FROM
    const config = { RESEND_API_KEY: 'test-key' };

    await sendVerificationEmail({
      to: 'from@example.com',
      username: 'charlie',
      verifyUrl: 'https://festie.us/verify/t',
      config,
      log,
      _client,
    });

    assert.ok(capturedArgs);
    assert.equal(capturedArgs.from, 'Festie <no-reply@festie.us>',
      'Should use default from address');
  });
});

// ---------------------------------------------------------------------------
// re-engagement emails
// ---------------------------------------------------------------------------

describe('email: re-engagement senders', () => {
  const base = { to: 'u@example.com', userId: 'user-1', username: 'u', festivalName: 'Fest', festivalId: 'f1', crewName: 'Crew', crewId: 'c1' };
  const POSTAL = 'PO Box 1 & Co, Orlando, FL 32801';
  const marketingConfig = (extra: any = {}) => createMockConfig({ PUBLIC_ORIGIN: 'https://festie.test', SESSION_SECRET: 'test-secret', EMAIL_POSTAL_ADDRESS: POSTAL, ...extra });
  const cases: Array<[string, any, string]> = [
    ['wrap ready', sendWrapReadyEmail, 'Wrap-up ready'],
    ['lineup drop', sendLineupDropEmail, 'New lineups'],
    ['crew reform', sendCrewReformEmail, 'Crew re-forms'],
    ['set times out', sendSetTimesOutEmail, 'New lineups and set times'],
    ['days out', sendDaysOutEmail, 'New lineups, days and set times'],
  ];
  const url = `https://festie.test/api/v1/auth/unsubscribe?token=${encodeURIComponent(unsubscribeToken('user-1', 'test-secret'))}`;
  for (const [name, fn, label] of cases) {
    it(`${name}: one-click List-Unsubscribe headers, unsubscribe link, settings line and postal address`, async () => {
      const send = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
      const ok = await fn({ ...base, to: `${name.replace(' ', '')}@example.com`, config: marketingConfig(), log: createMockLog(), _client: createMockClient(send) });
      assert.equal(ok, true);
      const msg = (send.mock.calls as any[])[0].arguments[0];
      assert.equal(msg.headers['List-Unsubscribe'], `<${url}>`);
      assert.equal(msg.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      const sentence = `You get this email because "${label}" is on in your Festie notification settings.`;
      assert.ok(msg.html.includes(sentence));
      assert.ok(msg.html.includes(`href="${url}"`));
      assert.ok(msg.html.includes('href="https://festie.test/account"'));
      assert.ok(msg.html.includes('PO Box 1 &amp; Co, Orlando, FL 32801'), 'html escaped');
      assert.ok(msg.text.includes(`Unsubscribe in one click: ${url}`));
      assert.ok(msg.text.endsWith('\nPO Box 1 & Co, Orlando, FL 32801'), 'text plain');
    });

    it(`${name}: not sent without EMAIL_POSTAL_ADDRESS, a signing secret or a user id`, async () => {
      for (const [extra, input] of [
        [{ EMAIL_POSTAL_ADDRESS: '' }, {}],
        [{ EMAIL_POSTAL_ADDRESS: '   ' }, {}],
        [{ SESSION_SECRET: '' }, {}],
        [{}, { userId: undefined }],
      ] as Array<[any, any]>) {
        const send = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
        const ok = await fn({ ...base, ...input, config: marketingConfig(extra), log: createMockLog(), _client: createMockClient(send) });
        assert.equal(ok, false);
        assert.equal(send.mock.calls.length, 0);
      }
    });
  }

  it('sendEmail refuses a marketing type that lacks the postal address or the one-click header', async () => {
    for (const type of MARKETING_EMAIL_TYPES) {
      for (const [config, headers] of [
        [createMockConfig({ EMAIL_POSTAL_ADDRESS: POSTAL }), { 'List-Unsubscribe': '<https://x>' }],
        [createMockConfig({ EMAIL_POSTAL_ADDRESS: POSTAL }), undefined],
        [createMockConfig(), { 'List-Unsubscribe': '<https://x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }],
      ] as Array<[any, any]>) {
        const send = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
        const ok = await sendEmail({ to: 'g@example.com', subject: `s-${type}`, html: 'h', text: 't', headers, type, config, log: createMockLog(), _client: createMockClient(send) });
        assert.equal(ok, false, type);
        assert.equal(send.mock.calls.length, 0, type);
      }
    }
  });

  it('transactional mail is unchanged: no postal address needed and no List-Unsubscribe header', async () => {
    const send = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
    const ok = await sendPasswordResetEmail({ to: 'tx@example.com', username: 'u', resetUrl: 'https://festie.test/reset', config: createMockConfig(), log: createMockLog(), _client: createMockClient(send) });
    assert.equal(ok, true);
    assert.equal((send.mock.calls as any[])[0].arguments[0].headers, undefined);
  });
});

describe('email: unsubscribe token', () => {
  it('round-trips the user id and is stable', () => {
    const token = unsubscribeToken('user-1', 's3cret');
    assert.equal(token, unsubscribeToken('user-1', 's3cret'));
    assert.equal(verifyUnsubscribeToken(token, 's3cret'), 'user-1');
  });

  it('rejects a forged signature, another user, another secret and malformed input', () => {
    const token = unsubscribeToken('user-1', 's3cret');
    const sig = token.slice(token.lastIndexOf('.') + 1);
    assert.equal(verifyUnsubscribeToken(`user-2.${sig}`, 's3cret'), null);
    assert.equal(verifyUnsubscribeToken(`user-1.${sig.slice(0, -1)}x`, 's3cret'), null);
    assert.equal(verifyUnsubscribeToken(token, 'other'), null);
    assert.equal(verifyUnsubscribeToken(token, ''), null);
    for (const bad of [undefined, null, '', 'nodot', '.sig', 42, ['a.b']]) assert.equal(verifyUnsubscribeToken(bad, 's3cret'), null);
  });
});

// ---------------------------------------------------------------------------
// T32: account emails (change confirm, alerts, expiry text, contrast)
// ---------------------------------------------------------------------------

function captureClient() {
  const send = mock.fn(async (_args: any) => ({ data: { id: 'm' }, error: null }));
  const sent = () => (send.mock.calls as any[]).map((c) => c.arguments[0]);
  return { _client: createMockClient(send), send, sent };
}

describe('email: sendEmailChangeConfirmEmail', () => {
  it('confirms the new address with the configured lifetime, not a signup welcome', async () => {
    const { _client, sent } = captureClient();
    const ok = await sendEmailChangeConfirmEmail({
      to: 'confirm48@example.com',
      username: '<b>eve</b>',
      verifyUrl: 'https://festie.us/api/v1/auth/verify-email?token=t',
      config: createMockConfig({ EMAIL_VERIFY_TOKEN_TTL_HOURS: 48 }),
      log: createMockLog(),
      _client,
    });
    assert.equal(ok, true);
    const msg = sent()[0];
    assert.equal(msg.subject, 'Confirm your new Festie email');
    assert.ok(msg.html.includes('Confirm new email'));
    assert.ok(msg.html.includes('48 hours'));
    assert.ok(msg.text.includes('48 hours'));
    assert.ok(msg.text.includes('Confirm your new email: https://festie.us/api/v1/auth/verify-email?token=t'));
    assert.ok(!msg.html.includes('Thanks for signing up'));
    assert.ok(!msg.text.includes('Thanks for signing up'));
    assert.ok(msg.html.includes('&lt;b&gt;eve&lt;/b&gt;'));
    assert.ok(!msg.html.includes('<b>eve</b>'));
    assert.ok(msg.html.includes('Your account email stays the same.'));
  });
});

describe('email: verification expiry text', () => {
  it('says "1 hour" when the lifetime is one hour', async () => {
    const { _client, sent } = captureClient();
    await sendVerificationEmail({
      to: 'ttl1@example.com',
      username: 'bob',
      verifyUrl: 'https://festie.us/verify/t',
      config: createMockConfig({ EMAIL_VERIFY_TOKEN_TTL_HOURS: 1 }),
      log: createMockLog(),
      _client,
    });
    const msg = sent()[0];
    assert.ok(msg.html.includes('expires in 1 hour.'));
    assert.ok(msg.text.includes('expires in 1 hour.'));
    assert.ok(!msg.html.includes('24 hours'));
  });
});

describe('email: sendEmailChangeNoticeEmail', () => {
  const NOT_ME = "This wasn't me";

  it('with resetUrl: offers a reset link that cancels the change', async () => {
    const { _client, sent } = captureClient();
    const resetUrl = 'https://festie.us/reset-password?token=abc';
    await sendEmailChangeNoticeEmail({ to: 'old1@example.com', resetUrl, config: createMockConfig(), log: createMockLog(), _client });
    const msg = sent()[0];
    assert.ok(msg.html.includes(NOT_ME));
    assert.ok(msg.html.includes(resetUrl));
    assert.ok(msg.html.includes('That cancels the change and signs out every device.'));
    assert.ok(msg.text.includes(`${NOT_ME}: ${resetUrl}`));
    assert.ok(!msg.html.includes('change your password immediately'));
  });

  it('without resetUrl: keeps the old advice and has no button', async () => {
    const { _client, sent } = captureClient();
    await sendEmailChangeNoticeEmail({ to: 'old2@example.com', config: createMockConfig(), log: createMockLog(), _client });
    const msg = sent()[0];
    assert.ok(msg.html.includes('change your password immediately'));
    assert.ok(!msg.html.includes(NOT_ME));
    assert.ok(!msg.html.includes('<a href'));
  });
});

describe('email: sendEmailChangedEmail', () => {
  it('is never deduplicated: two sends in a row both reach the provider', async () => {
    const { _client, send, sent } = captureClient();
    const args = { to: 'old3@example.com', config: createMockConfig(), log: createMockLog(), _client };
    assert.equal(await sendEmailChangedEmail(args), true);
    assert.equal(await sendEmailChangedEmail(args), true);
    assert.equal(send.mock.callCount(), 2);
    const msg = sent()[0];
    assert.equal(msg.subject, 'Your Festie email was changed');
    assert.ok(msg.html.includes('Every device was signed out.'));
    assert.ok(msg.html.includes('support@festie.us'));
  });
});

describe('email: password reset names the username', () => {
  it('states the username in HTML and text', async () => {
    const { _client, sent } = captureClient();
    await sendPasswordResetEmail({
      to: 'named@example.com',
      username: 'dana',
      resetUrl: 'https://festie.us/reset-password?token=t',
      config: createMockConfig(),
      log: createMockLog(),
      _client,
    });
    const msg = sent()[0];
    assert.ok(msg.html.includes('Your username is <strong style="color:#e4e4e7">dana</strong>.'));
    assert.ok(msg.text.includes('Your username is dana.'));
  });
});

describe('email: readable footer and fallback text', () => {
  it('uses #a1a1aa, not the faint rgba greys', async () => {
    const { _client, sent } = captureClient();
    await sendPasswordResetEmail({
      to: 'contrast@example.com',
      username: 'u',
      resetUrl: 'https://festie.us/reset-password?token=t',
      config: createMockConfig(),
      log: createMockLog(),
      _client,
    });
    const { html } = sent()[0];
    assert.ok(html.includes('color:#a1a1aa;font-size:12px'), 'footer');
    assert.ok(html.includes('color:#a1a1aa;font-size:13px'), 'link fallback line');
    assert.ok(!html.includes('rgba(255,255,255,0.3)'));
    assert.ok(!html.includes('rgba(255,255,255,0.4)'));
  });
});

describe('email: sendSetTimesOutEmail', () => {
  it('uses the set-times copy, links the festival and escapes the name', async () => {
    const send = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
    const ok = await sendSetTimesOutEmail({
      to: 'u@example.com',
      userId: 'u1',
      username: '<b>u</b>',
      festivalName: 'EDC <Las Vegas>',
      festivalId: 'edc 27',
      config: createMockConfig({ PUBLIC_ORIGIN: 'https://festie.test', SESSION_SECRET: 's', EMAIL_POSTAL_ADDRESS: 'PO Box 1' }),
      log: createMockLog(),
      _client: createMockClient(send),
    });
    assert.equal(ok, true);
    const msg = (send.mock.calls as any[])[0].arguments[0];
    assert.equal(msg.subject, 'EDC <Las Vegas> set times are out');
    assert.ok(msg.html.includes('The set times for <strong style="color:#e4e4e7">EDC &lt;Las Vegas&gt;</strong> are out.'));
    assert.ok(msg.html.includes('Pick your sets and spot clashes before the weekend.'));
    assert.ok(msg.html.includes('See the schedule'));
    assert.ok(msg.html.includes('https://festie.test/?festival=edc%2027'));
    assert.ok(!msg.html.includes('<b>u</b>'));
    assert.ok(msg.text.includes('The set times for EDC <Las Vegas> are out.'));
  });

  it('names the released days in the subject and body, and adds the admin note escaped', async () => {
    const send = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
    await sendSetTimesOutEmail({
      to: 'u@example.com',
      userId: 'u1',
      username: 'u',
      festivalName: 'Wasteland',
      festivalId: 'wl-27',
      dayLabels: ['Friday', 'Saturday'],
      note: 'Gates at <noon>.',
      config: createMockConfig({ PUBLIC_ORIGIN: 'https://festie.test', SESSION_SECRET: 's', EMAIL_POSTAL_ADDRESS: 'PO Box 1' }),
      log: createMockLog(),
      _client: createMockClient(send),
    });
    const msg = (send.mock.calls as any[])[0].arguments[0];
    assert.equal(msg.subject, 'Wasteland: Friday and Saturday set times are out');
    assert.ok(msg.html.includes('The Friday and Saturday set times for <strong style="color:#e4e4e7">Wasteland</strong> are out.'));
    assert.ok(msg.html.includes('Gates at &lt;noon&gt;.'));
    assert.ok(msg.text.includes('The Friday and Saturday set times for Wasteland are out.'));
    assert.ok(msg.text.includes('Gates at <noon>.'));
  });
});

describe('email: sendDaysOutEmail', () => {
  it('uses the days copy, links the festival and escapes the name', async () => {
    const send = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
    const ok = await sendDaysOutEmail({
      to: 'days@example.com',
      userId: 'u1',
      username: '<b>u</b>',
      festivalName: 'Wasteland <2027>',
      festivalId: 'wl 27',
      config: createMockConfig({ PUBLIC_ORIGIN: 'https://festie.test', SESSION_SECRET: 's', EMAIL_POSTAL_ADDRESS: 'PO Box 1' }),
      log: createMockLog(),
      _client: createMockClient(send),
    });
    assert.equal(ok, true);
    const msg = (send.mock.calls as any[])[0].arguments[0];
    assert.equal(msg.subject, 'Wasteland <2027> days are out');
    assert.ok(msg.html.includes('The days for <strong style="color:#e4e4e7">Wasteland &lt;2027&gt;</strong> are out. See who plays which day. Set times come later.'));
    assert.ok(msg.html.includes('https://festie.test/?festival=wl%2027'));
    assert.ok(!msg.html.includes('<b>u</b>'));
    assert.ok(msg.text.includes('The days for Wasteland <2027> are out. See who plays which day. Set times come later.'));
  });
});

describe('email: sendLineupDropEmail copy', () => {
  const send = async (hasTimes?: boolean) => {
    const fn = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
    await sendLineupDropEmail({ to: 'lu@example.com', userId: 'u1', username: 'u', festivalName: 'Fest', festivalId: 'f1', ...(hasTimes === undefined ? {} : { hasTimes }), config: createMockConfig({ PUBLIC_ORIGIN: 'https://festie.test', SESSION_SECRET: 's', EMAIL_POSTAL_ADDRESS: 'PO Box 1' }), log: createMockLog(), _client: createMockClient(fn) });
    return (fn.mock.calls as any[])[0].arguments[0];
  };

  it('with no timed set, neither body says picking and both promise a later alert', async () => {
    const msg = await send(false);
    assert.ok(!/picking/i.test(msg.html + msg.text + msg.subject));
    assert.ok(msg.html.includes('is out. See who is playing. We&#39;ll tell you when set times are out.') || msg.html.includes("is out. See who is playing. We'll tell you when set times are out."));
    assert.ok(msg.text.includes("The lineup for Fest is out. See who is playing. We'll tell you when set times are out."));
    assert.ok(msg.html.includes('See the lineup'));
  });

  it('with timed sets, keeps today\'s copy', async () => {
    const msg = await send();
    assert.ok(msg.html.includes('Start picking your sets before tickets move.'));
    assert.equal(msg.subject, 'Fest lineup just dropped');
  });
});
