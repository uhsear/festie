import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { sendEmail, sendPasswordResetEmail, sendVerificationEmail, sendWrapReadyEmail, sendLineupDropEmail, sendCrewReformEmail, sendEmailChangeConfirmEmail, sendEmailChangeNoticeEmail, sendEmailChangedEmail, sendSetTimesOutEmail } from '../lib/email.js';

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
  const base = { to: 'u@example.com', username: 'u', festivalName: 'Fest', festivalId: 'f1', crewName: 'Crew', crewId: 'c1' };
  const cases: Array<[string, any, string]> = [
    ['wrap ready', sendWrapReadyEmail, 'Wrap-up ready'],
    ['lineup drop', sendLineupDropEmail, 'New lineups'],
    ['crew reform', sendCrewReformEmail, 'Crew re-forms'],
    ['set times out', sendSetTimesOutEmail, 'New lineups and set times'],
  ];
  for (const [name, fn, label] of cases) {
    it(`${name}: https List-Unsubscribe header and settings footer`, async () => {
      const send = mock.fn(async () => ({ data: { id: 'm' }, error: null }));
      const ok = await fn({ ...base, to: `${name.replace(' ', '')}@example.com`, config: createMockConfig({ PUBLIC_ORIGIN: 'https://festie.test' }), log: createMockLog(), _client: createMockClient(send) });
      assert.equal(ok, true);
      const msg = (send.mock.calls as any[])[0].arguments[0];
      assert.equal(msg.headers['List-Unsubscribe'], '<https://festie.test/account>');
      const sentence = `You get this email because "${label}" is on in your Festie notification settings.`;
      assert.ok(msg.html.includes(sentence));
      assert.ok(msg.html.includes('href="https://festie.test/account"'));
      assert.ok(msg.text.endsWith(`${sentence} Turn it off: https://festie.test/account`));
    });
  }
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
      username: '<b>u</b>',
      festivalName: 'EDC <Las Vegas>',
      festivalId: 'edc 27',
      config: createMockConfig({ PUBLIC_ORIGIN: 'https://festie.test' }),
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
});
