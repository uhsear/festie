import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import crypto from 'node:crypto';

import { createSendService } from '../lib/notifications/send.js';
import {
  ALLOWED_NOTIFICATION_TYPES,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_DATA_KEYS,
  enforcePayloadLimits,
} from '../lib/notifications/payload.js';
import { isInDndWindow } from '../lib/notifications/dnd.js';
import {
  isApnsConfigured,
  signApnsToken,
  classifyApnsResponse,
  createApnsProvider,
} from '../lib/notifications/apns.js';
import { createNotificationService } from '../lib/notifications/index.js';

// ── enforcePayloadLimits ────────────────────────────────────────────────

describe('notifications/payload: enforcePayloadLimits', () => {
  it('truncates title to MAX_TITLE_LENGTH', () => {
    const { safeTitle } = enforcePayloadLimits('a'.repeat(200), '', {});
    assert.equal(safeTitle.length, MAX_TITLE_LENGTH);
  });

  it('truncates body to MAX_BODY_LENGTH', () => {
    const { safeBody } = enforcePayloadLimits('', 'b'.repeat(500), {});
    assert.equal(safeBody.length, MAX_BODY_LENGTH);
  });

  it('limits data keys to MAX_DATA_KEYS', () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 20; i++) data[`key${i}`] = `val${i}`;
    const { safeData } = enforcePayloadLimits('', '', data);
    assert.equal(Object.keys(safeData).length, MAX_DATA_KEYS);
  });

  it('truncates data key names to 50 chars', () => {
    const data = { ['k'.repeat(100)]: 'value' };
    const { safeData } = enforcePayloadLimits('', '', data);
    const keys = Object.keys(safeData);
    assert.equal(keys[0]!.length, 50);
  });

  it('truncates data values to 200 chars', () => {
    const data = { key: 'v'.repeat(500) };
    const { safeData } = enforcePayloadLimits('', '', data);
    assert.equal(safeData.key!.length, 200);
  });

  it('converts null title/body to empty string', () => {
    const { safeTitle, safeBody } = enforcePayloadLimits(null, null, {});
    assert.equal(safeTitle, '');
    assert.equal(safeBody, '');
  });

  it('handles null data gracefully', () => {
    const { safeData } = enforcePayloadLimits('', '', null);
    assert.deepEqual(safeData, {});
  });

  it('converts non-string data values to strings', () => {
    const { safeData } = enforcePayloadLimits('', '', { num: 42, bool: true } as any);
    assert.equal(safeData.num, '42');
    assert.equal(safeData.bool, 'true');
  });
});

describe('notifications/payload: ALLOWED_NOTIFICATION_TYPES', () => {
  it('includes crew_update, schedule_change, set_reminder', () => {
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('crew_update'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('schedule_change'));
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('set_reminder'));
  });

  it('includes rate_prompt', () => {
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('rate_prompt'));
  });

  it('does not include unknown types', () => {
    assert.ok(!ALLOWED_NOTIFICATION_TYPES.has('spam'));
    assert.ok(!ALLOWED_NOTIFICATION_TYPES.has(''));
  });
});

describe('notifications/send: set_times_out', () => {
  function sendWith(prefs: any) {
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores: {
        notificationPrefs: { get: mock.fn(async () => prefs) },
        deviceTokens: {
          listByUser: mock.fn(async () => [{ token: 't'.repeat(40), platform: 'android' }]),
          unregister: mock.fn(async () => {}),
        },
        notificationCounts: { getByUser: mock.fn(async () => []), increment: mock.fn(async () => {}) },
        notificationLog: { insert: mock.fn(async () => null) },
      },
      config: { PUBLIC_ORIGIN: 'https://festie.us' },
      log: { info() {}, warn() {}, error() {}, debug() {} },
      messaging,
      retryQueue: { enqueue() {} },
    });
    return svc.send({ userId: 'u1', type: 'set_times_out', title: 'EDC set times are out', body: 'b', data: {} });
  }

  it('is an allowed type and delivers when New lineups and set times is on', async () => {
    assert.ok(ALLOWED_NOTIFICATION_TYPES.has('set_times_out'));
    assert.equal((await sendWith({ lineupDrops: 1 })).sent, 1);
  });

  it('is filtered when lineupDrops is off', async () => {
    assert.equal((await sendWith({ lineupDrops: 0 })).reason, 'user_disabled');
  });

  it('is held back inside the DND window', async () => {
    assert.equal((await sendWith({ lineupDrops: 1, dndStart: '00:00', dndEnd: '23:59' })).reason, 'dnd_active');
  });
});

// ── isInDndWindow ───────────────────────────────────────────────────────

describe('notifications/dnd: isInDndWindow', () => {
  it('returns false when prefs is null', () => {
    assert.equal(isInDndWindow(null), false);
  });

  it('returns false when prefs is undefined', () => {
    assert.equal(isInDndWindow(undefined), false);
  });

  it('returns false when dndStart is missing', () => {
    assert.equal(isInDndWindow({ dndEnd: '08:00' }), false);
  });

  it('returns false when dndEnd is missing', () => {
    assert.equal(isInDndWindow({ dndStart: '22:00' }), false);
  });

  it('returns false when dndStart equals dndEnd', () => {
    assert.equal(isInDndWindow({ dndStart: '22:00', dndEnd: '22:00' }), false);
  });

  it('returns false for empty prefs object', () => {
    assert.equal(isInDndWindow({}), false);
  });
});

// ── createSendService: buildFcmMessage (tested through send()) ──────────

describe('notifications/send: createSendService', () => {
  function makeStores(overrides: any = {}) {
    return {
      notificationPrefs: { get: mock.fn(async () => null) },
      deviceTokens: { listByUser: mock.fn(async () => []), unregister: mock.fn(async () => {}) },
      notificationCounts: {
        getByUser: mock.fn(async () => []),
        increment: mock.fn(async () => {}),
        reset: mock.fn(async () => {}),
      },
      notificationLog: { insert: mock.fn(async () => null) },
      profiles: { userIdsByFestival: mock.fn(async () => []) },
      ...overrides,
    };
  }

  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };
  const fakeConfig = { PUBLIC_ORIGIN: 'https://festie.us' };

  it('send returns firebase_not_configured when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(),
      config: fakeConfig,
      log: fakeLog,
      messaging: null,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'firebase_not_configured');
  });

  it('send returns invalid_type for unknown notification type', async () => {
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores: makeStores(),
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'unknown_type', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'invalid_type');
  });

  it('send returns user_disabled when prefs disable type', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => ({ crewUpdates: false })) },
    });
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'user_disabled');
  });

  it('send filters rate_prompt by the wrapReady pref', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => ({ wrapReady: false })) },
    });
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'rate_prompt', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'user_disabled');
    assert.equal(messaging.send.mock.callCount(), 0);
  });

  it('send returns no_tokens when user has no device tokens', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => ({ crewUpdates: true })) },
    });
    const messaging = { send: mock.fn(async () => 'msg-id') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'test' });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'no_tokens');
  });

  it('send successfully delivers to a device', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => ({ crewUpdates: true })) },
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: 'valid-token-' + 'x'.repeat(30), platform: 'android' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'msg-id-123') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'Update',
      body: 'New message',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal(messaging.send.mock.calls.length, 1);
    // Verify FCM message structure
    const fcmMsg = (messaging.send.mock.calls as any[])[0]!.arguments[0];
    assert.equal(fcmMsg!.notification.title, 'Update');
    assert.equal(fcmMsg!.notification.body, 'New message');
    assert.equal(fcmMsg!.data.type, 'crew_update');
    assert.ok(fcmMsg!.android);
    assert.ok(fcmMsg!.apns);
    // Browsers get Web Push directly; FCM messages carry no webpush block.
    assert.equal(fcmMsg!.webpush, undefined);
  });

  it('send skips tokens that are too short', async () => {
    const stores = makeStores({
      notificationPrefs: { get: mock.fn(async () => null) },
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: 'short', platform: 'android' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'ok') };
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({ userId: 'u1', type: 'crew_update', title: 'hi', body: 'hi' });
    assert.equal(result.sent, 0);
    assert.equal(messaging.send.mock.calls.length, 0);
  });

  it('markRead calls notificationCounts.reset', async () => {
    const resetFn = mock.fn(async () => {});
    const stores = makeStores({
      notificationCounts: {
        getByUser: mock.fn(async () => []),
        increment: mock.fn(async () => {}),
        reset: resetFn,
      },
    });
    const svc = createSendService({
      stores,
      config: fakeConfig,
      log: fakeLog,
      messaging: null,
      retryQueue: { enqueue() {} },
    });
    await svc.markRead('u1', 'f1');
    assert.equal(resetFn.mock.calls.length, 1);
    assert.deepEqual(resetFn.mock.calls[0]!.arguments, ['u1', 'f1']);
  });

  it('sendToOfflineUsers returns 0 when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(),
      config: fakeConfig,
      log: fakeLog,
      messaging: null,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1',
      type: 'crew_update',
      title: 'hi',
      body: 'test',
    });
    assert.equal(result.sent, 0);
  });

  it('sendSilentSync returns 0 when messaging is null', async () => {
    const svc = createSendService({
      stores: makeStores(),
      config: fakeConfig,
      log: fakeLog,
      messaging: null,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.sendSilentSync({ festivalId: 'f1', syncType: 'picks' });
    assert.equal(result.sent, 0);
  });
});

// ── notifications/apns: JWT + response classification ───────────────────

// A throwaway EC P-256 (prime256v1) key — used ONLY to exercise ES256 signing
// in tests. Not a real APNs key; no secret value is embedded.
const { privateKey: testEcKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}) as any;

function decodeJwtPart(part: string) {
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

describe('notifications/apns: signApnsToken', () => {
  it('produces a 3-part ES256 JWT with kid header and iss/iat payload', () => {
    const iat = 1_700_000_000;
    const token = signApnsToken(testEcKey, 'KEY12345AB', 'TEAM98765C', iat);
    const parts = token.split('.');
    assert.equal(parts.length, 3);

    const header = decodeJwtPart(parts[0]!);
    assert.equal(header.alg, 'ES256');
    assert.equal(header.kid, 'KEY12345AB');

    const payload = decodeJwtPart(parts[1]!);
    assert.equal(payload.iss, 'TEAM98765C');
    assert.equal(payload.iat, iat);
  });

  it('produces a verifiable ES256 signature (ieee-p1363 / 64-byte)', () => {
    const token = signApnsToken(testEcKey, 'K', 'T', 123);
    const [h, p, sig] = token.split('.');
    const sigBuf = Buffer.from(sig!.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    assert.equal(sigBuf.length, 64); // raw r||s, not DER

    const pub = crypto.createPublicKey(testEcKey);
    const ok = crypto.verify('SHA256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, sigBuf);
    assert.equal(ok, true);
  });
});

describe('notifications/apns: classifyApnsResponse', () => {
  it('200 → sent, not stale', () => {
    assert.deepEqual(classifyApnsResponse(200, ''), { sent: true, stale: false });
  });
  it('410 Unregistered → stale', () => {
    const r = classifyApnsResponse(410, 'Unregistered');
    assert.equal(r.sent, false);
    assert.equal(r.stale, true);
  });
  it('400 BadDeviceToken → stale', () => {
    assert.equal(classifyApnsResponse(400, 'BadDeviceToken').stale, true);
  });
  it('400 DeviceTokenNotForTopic → stale', () => {
    assert.equal(classifyApnsResponse(400, 'DeviceTokenNotForTopic').stale, true);
  });
  it('400 PayloadTooLarge → NOT stale', () => {
    assert.equal(classifyApnsResponse(400, 'PayloadTooLarge').stale, false);
  });
  it('500 → not stale, carries error', () => {
    const r = classifyApnsResponse(500, 'InternalServerError');
    assert.equal(r.sent, false);
    assert.equal(r.stale, false);
    assert.equal(r.error, 'InternalServerError');
  });
});

describe('notifications/apns: isApnsConfigured', () => {
  const full = { APNS_KEY_PATH: '/k.p8', APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_BUNDLE_ID: 'us.festie.app' };
  it('true when all required keys present', () => assert.equal(isApnsConfigured(full), true));
  it('false when key path missing', () => assert.equal(isApnsConfigured({ ...full, APNS_KEY_PATH: '' }), false));
  it('false when key id missing', () => assert.equal(isApnsConfigured({ ...full, APNS_KEY_ID: '' }), false));
  it('false for null', () => assert.equal(isApnsConfigured(null), false));
});

// Build a fake http2 impl whose request() resolves to the given status + reason body.
function fakeHttp2({ status, reason }: { status: number; reason?: string }) {
  return {
    connect() {
      return {
        closed: false,
        destroyed: false,
        setTimeout() {},
        on() {},
        close() {},
        request(_headers: any) {
          const handlers: Record<string, any> = {};
          const req = {
            setTimeout() {},
            on(ev: string, cb: any) {
              handlers[ev] = cb;
              return req;
            },
            end() {
              // Simulate async APNs response.
              setImmediate(() => {
                handlers.response?.({ ':status': status });
                if (reason) handlers.data?.(Buffer.from(JSON.stringify({ reason })));
                handlers.end?.();
              });
            },
            close() {},
          };
          return req;
        },
      };
    },
  };
}

describe('notifications/apns: createApnsProvider (http2 mocked)', () => {
  const cfg = {
    APNS_KEY_PATH: '/k.p8',
    APNS_KEY_ID: 'K',
    APNS_TEAM_ID: 'T',
    APNS_BUNDLE_ID: 'us.festie.app',
    APNS_PRODUCTION: true,
  };
  const deps = (h: any) => ({ http2: h, keyLoader: () => testEcKey });

  it('200 → { sent: true, stale: false }', async () => {
    const p = createApnsProvider(cfg, console, deps(fakeHttp2({ status: 200 })) as any);
    const r = await p.send('a'.repeat(64), { aps: { alert: { title: 't', body: 'b' } } });
    assert.deepEqual(r, { sent: true, stale: false });
  });

  it('410 Unregistered → stale:true', async () => {
    const p = createApnsProvider(cfg, console, deps(fakeHttp2({ status: 410, reason: 'Unregistered' })) as any);
    const r = await p.send('a'.repeat(64), { aps: {} });
    assert.equal(r.sent, false);
    assert.equal(r.stale, true);
  });

  it('caches the provider token across sends (key loaded once)', async () => {
    let loads = 0;
    const p = createApnsProvider(cfg, console, {
      http2: fakeHttp2({ status: 200 }) as any,
      keyLoader: () => {
        loads++;
        return testEcKey;
      },
    });
    await p.send('a'.repeat(64), { aps: {} });
    await p.send('a'.repeat(64), { aps: {} });
    // Key is read once (lazy) and the JWT is cached within the refresh window.
    assert.equal(loads, 1);
  });
});

// ── notifications/send: platform routing (iOS APNs vs FCM) ──────────────

describe('notifications/send: platform routing', () => {
  function makeStores(overrides: any = {}) {
    return {
      notificationPrefs: { get: mock.fn(async () => ({ crewUpdates: true })) },
      deviceTokens: { listByUser: mock.fn(async () => []), unregister: mock.fn(async () => {}) },
      notificationCounts: {
        getByUser: mock.fn(async () => []),
        increment: mock.fn(async () => {}),
        reset: mock.fn(async () => {}),
      },
      notificationLog: { insert: mock.fn(async () => null) },
      profiles: { userIdsByFestival: mock.fn(async () => []) },
      ...overrides,
    };
  }
  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };
  const apnsConfig = {
    PUBLIC_ORIGIN: 'https://festie.us',
    APNS_KEY_PATH: '/k.p8',
    APNS_KEY_ID: 'K',
    APNS_TEAM_ID: 'T',
    APNS_BUNDLE_ID: 'us.festie.app',
  };
  const validIosToken = 'i'.repeat(64);

  it('ios + APNs configured → APNs sender called, FCM messaging.send NOT called', async () => {
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'fcm-id') };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal((apnsProvider.send.mock.calls as any[]).length, 1);
    assert.equal((messaging.send.mock.calls as any[]).length, 0);
    // aps payload carries alert title/body
    const payload = (apnsProvider.send.mock.calls as any[])[0]!.arguments[1];
    assert.equal(payload.aps.alert.title, 'T');
    assert.equal(payload.aps.alert.body, 'B');
    assert.equal(payload.aps.category, 'CREW_UPDATE');
  });

  describe('local reminder skip', () => {
    const androidToken = 'a'.repeat(64);
    function build(localRemindersFestivalId: string | null) {
      const stores = makeStores({
        notificationPrefs: { get: mock.fn(async () => ({ setReminders: true, crewUpdates: true })) },
        deviceTokens: {
          listByUser: mock.fn(async () => [{ token: androidToken, platform: 'android', localRemindersFestivalId }]),
          unregister: mock.fn(async () => {}),
        },
      });
      const messaging = { send: mock.fn(async () => 'fcm-id') };
      const svc = createSendService({
        stores,
        config: apnsConfig,
        log: fakeLog,
        messaging,
        retryQueue: { enqueue() {} },
      });
      return { svc, messaging };
    }
    const reminder = (type: string) => ({
      userId: 'u1',
      type,
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });

    it('set_reminder to a device covering that festival sends nothing', async () => {
      const { svc, messaging } = build('f1');
      const result = await svc.send(reminder('set_reminder'));
      assert.equal(result.sent, 0);
      assert.equal(result.localCovered, 1);
      assert.equal(messaging.send.mock.calls.length, 0);
    });

    it('set_reminder to a device covering another festival still pushes', async () => {
      const { svc, messaging } = build('f2');
      const result = await svc.send(reminder('set_reminder'));
      assert.equal(result.sent, 1);
      assert.equal(result.localCovered, 0);
      assert.equal(messaging.send.mock.calls.length, 1);
    });

    it('a non-reminder type is never skipped', async () => {
      const { svc, messaging } = build('f1');
      const result = await svc.send(reminder('crew_update'));
      assert.equal(result.sent, 1);
      assert.equal(messaging.send.mock.calls.length, 1);
    });
  });

  it('FCM unconfigured + APNs configured → ios still delivered via APNs', async () => {
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging: null, // ← Firebase NOT configured; APNs is
      retryQueue: { enqueue() {} },
      apnsProvider,
    });
    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal((apnsProvider.send.mock.calls as any[]).length, 1);
  });

  it('ios + APNs NOT configured → token SKIPPED and NOT unregistered (the bug fix)', async () => {
    const unregister = mock.fn(async () => {});
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister,
      },
    });
    const messaging = { send: mock.fn(async () => 'fcm-id') };
    // config WITHOUT apns keys
    const svc = createSendService({
      stores,
      config: { PUBLIC_ORIGIN: 'https://festie.us' },
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
    });
    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 0);
    assert.equal((messaging.send.mock.calls as any[]).length, 0); // never sent via FCM
    assert.equal((unregister.mock.calls as any[]).length, 0); // NOT deleted as stale
    assert.equal(result.staleRemoved, 0);
  });

  it('android → unchanged FCM path (messaging.send called, APNs not)', async () => {
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: 'a'.repeat(64), platform: 'android' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'fcm-id') };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 1);
    assert.equal((messaging.send.mock.calls as any[]).length, 1);
    assert.equal((apnsProvider.send.mock.calls as any[]).length, 0);
  });

  it('ios + APNs 410 stale → token unregistered', async () => {
    const unregister = mock.fn(async () => {});
    const stores = makeStores({
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister,
      },
    });
    const messaging = { send: mock.fn(async () => 'fcm-id') };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: false, stale: true, error: 'Unregistered' })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.send({
      userId: 'u1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 0);
    assert.equal((unregister.mock.calls as any[]).length, 1);
    assert.deepEqual((unregister.mock.calls as any[])[0]!.arguments, [validIosToken, 'u1']);
  });

  it('mixed crew (ios+android) in sendToOfflineUsers → ios via APNs, android via FCM batch', async () => {
    const stores = makeStores({
      profiles: { userIdsByFestival: mock.fn(async () => ['u1', 'u2']) },
      deviceTokens: {
        listByUser: mock.fn(async (uid: string) =>
          uid === 'u1' ? [{ token: validIosToken, platform: 'ios' }] : [{ token: 'a'.repeat(64), platform: 'android' }],
        ),
        unregister: mock.fn(async () => {}),
      },
      topicSubscriptions: { getUnsubscribedUsers: mock.fn(async () => new Set()) },
    });
    const messaging = {
      send: mock.fn(async () => 'x'),
      sendEach: mock.fn(async (batch: any[]) => ({ responses: batch.map(() => ({ success: true })) })),
    };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1',
      type: 'crew_update',
      title: 'T',
      body: 'B',
      data: { festivalId: 'f1' },
    });
    assert.equal(result.sent, 2);
    assert.equal((apnsProvider.send.mock.calls as any[]).length, 1); // one ios
    assert.equal((messaging.sendEach.mock.calls as any[]).length, 1); // android via batch
    const batch = (messaging.sendEach.mock.calls as any[])[0]!.arguments[0];
    assert.equal(batch.length, 1); // only the android token batched
  });

  it('sendSilentSync ios → APNs background push (content-available)', async () => {
    const stores = makeStores({
      profiles: { userIdsByFestival: mock.fn(async () => ['u1']) },
      deviceTokens: {
        listByUser: mock.fn(async () => [{ token: validIosToken, platform: 'ios' }]),
        unregister: mock.fn(async () => {}),
      },
    });
    const messaging = { send: mock.fn(async () => 'x') };
    const apnsProvider = {
      send: mock.fn(async () => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const svc = createSendService({
      stores,
      config: apnsConfig,
      log: fakeLog,
      messaging,
      retryQueue: { enqueue() {} },
      apnsProvider,
    });

    const result = await svc.sendSilentSync({ festivalId: 'f1', syncType: 'picks' });
    assert.equal(result.sent, 1);
    assert.equal((messaging.send.mock.calls as any[]).length, 0);
    const [, payload, opts] = (apnsProvider.send.mock.calls as any[])[0]!.arguments;
    assert.equal(payload.aps['content-available'], 1);
    assert.equal(opts.pushType, 'background');
    assert.equal(opts.priority, '5');
  });
});

// ── notifications/send: Web Push, Android channels, explicit recipients ──

describe('notifications/send: web push, channels and recipients', () => {
  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };
  const config = { PUBLIC_ORIGIN: 'https://festie.us/' };
  const webToken = JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: {} });
  const androidToken = 'a'.repeat(64);

  function makeStores({ prefs = {}, tokens = {}, festivalUsers = [], unsubscribed = [] }: any = {}) {
    return {
      notificationPrefs: { get: mock.fn(async (uid: string) => prefs[uid] ?? null) },
      deviceTokens: {
        listByUser: mock.fn(async (uid: string) => tokens[uid] ?? []),
        unregister: mock.fn(async () => {}),
      },
      notificationCounts: {
        getByUser: mock.fn(async () => []),
        increment: mock.fn(async () => {}),
        reset: mock.fn(async () => {}),
      },
      notificationLog: { insert: mock.fn(async (_row: any) => null) },
      profiles: { userIdsByFestival: mock.fn(async () => festivalUsers) },
      topicSubscriptions: { getUnsubscribedUsers: mock.fn(async () => new Set(unsubscribed)) },
    };
  }
  function makeWebPush(result: any = { sent: true, stale: false }) {
    return { publicKey: 'pk', send: mock.fn(async (_t: string, _p: any, _o: any) => result) };
  }
  function makeMessaging() {
    return {
      send: mock.fn(async (_m: any) => 'fcm-id'),
      sendEach: mock.fn(async (batch: any[]) => ({ responses: batch.map(() => ({ success: true })) })),
    };
  }
  function build(stores: any, { webPush = makeWebPush(), messaging = makeMessaging() }: any = {}) {
    const svc = createSendService({ stores, config, log: fakeLog, messaging, retryQueue: { enqueue() {} }, webPush });
    return { svc, webPush, messaging };
  }
  const reminder = {
    userId: 'u1',
    type: 'set_reminder',
    title: 'Peggy Gou in 15 min',
    body: 'Sahara',
    data: { festivalId: 'f1', setId: 's1', deepLink: 'https://festie.us/set/s1' },
  };

  it('a web device gets one Web Push with the deepLink as url and high urgency for set_reminder', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: webToken, platform: 'web' }] } });
    const { svc, webPush, messaging } = build(stores);
    const result = await svc.send(reminder);
    assert.equal(result.sent, 1);
    assert.equal(messaging.send.mock.calls.length, 0);
    assert.equal(webPush.send.mock.calls.length, 1);
    const [token, payload, opts] = webPush.send.mock.calls[0]!.arguments;
    assert.equal(token, webToken);
    assert.deepEqual(payload, {
      title: 'Peggy Gou in 15 min',
      body: 'Sahara',
      url: 'https://festie.us/set/s1',
      tag: 'set_reminder',
    });
    assert.deepEqual(opts, { ttl: 3600, urgency: 'high' });
    const [inbox, logged] = stores.notificationLog.insert.mock.calls.map((c: any) => c.arguments[0]);
    assert.equal(inbox.platform, 'inbox');
    assert.equal(inbox.status, 'inbox');
    assert.equal(logged.platform, 'web');
    assert.equal(logged.status, 'sent');
  });

  it('a non-urgent type gets normal urgency, a day of TTL and the threadId as tag', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: webToken, platform: 'web' }] } });
    const { svc, webPush } = build(stores);
    await svc.send({ ...reminder, type: 'crew_update', threadId: 'crew-f1' });
    const [, payload, opts] = webPush.send.mock.calls[0]!.arguments;
    assert.equal(payload.tag, 'crew-f1');
    assert.deepEqual(opts, { ttl: 86400, urgency: 'normal' });
  });

  it('a deepLink off our origin opens the home page instead', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: webToken, platform: 'web' }] } });
    const { svc, webPush } = build(stores);
    await svc.send({ ...reminder, data: { festivalId: 'f1', deepLink: 'https://festie.us.evil.example/x' } });
    assert.equal(webPush.send.mock.calls[0]!.arguments[1].url, 'https://festie.us/');
  });

  it('a stale Web Push result unregisters the token', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: webToken, platform: 'web' }] } });
    const { svc } = build(stores, { webPush: makeWebPush({ sent: false, stale: true }) });
    const result = await svc.send(reminder);
    assert.equal(result.sent, 0);
    assert.deepEqual(stores.deviceTokens.unregister.mock.calls[0]!.arguments, [webToken, 'u1']);
  });

  it('with webPush null a web token is skipped and not unregistered', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: webToken, platform: 'web' }] } });
    const { svc, messaging } = build(stores, { webPush: null });
    const result = await svc.send(reminder);
    assert.equal(result.sent, 0);
    assert.equal(messaging.send.mock.calls.length, 0);
    assert.equal(stores.deviceTokens.unregister.mock.calls.length, 0);
  });

  it('only webPush configured is enough to send', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: webToken, platform: 'web' }] } });
    const { svc } = build(stores, { messaging: null });
    assert.equal((await svc.send(reminder)).sent, 1);
  });

  it('sendToOfflineUsers({ userIds }) sends only to those users, through Web Push too', async () => {
    const stores = makeStores({
      festivalUsers: ['u1', 'u2', 'u3'],
      tokens: {
        u1: [{ token: androidToken, platform: 'android' }],
        u2: [{ token: webToken, platform: 'web' }],
      },
    });
    const { svc, webPush, messaging } = build(stores);
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1',
      userIds: ['u2'],
      type: 'crew_update',
      title: 'Alex updated their picks',
      body: 'b',
      data: { festivalId: 'f1', deepLink: 'https://festie.us/compare' },
    });
    assert.equal(result.sent, 1);
    assert.equal(stores.profiles.userIdsByFestival.mock.calls.length, 0);
    assert.equal(messaging.sendEach.mock.calls.length, 0);
    assert.equal(webPush.send.mock.calls.length, 1);
    assert.equal(webPush.send.mock.calls[0]!.arguments[1].url, 'https://festie.us/compare');
    assert.deepEqual(stores.notificationCounts.increment.mock.calls[0]!.arguments, ['u2', 'f1', 'updates']);
  });

  it('sendToOfflineUsers({ userIds }) still applies the topic filter', async () => {
    const stores = makeStores({
      unsubscribed: ['u3'],
      tokens: {
        u2: [{ token: androidToken, platform: 'android' }],
        u3: [{ token: 'b'.repeat(64), platform: 'android' }],
      },
    });
    const { svc, messaging } = build(stores);
    await svc.sendToOfflineUsers({
      festivalId: 'f1',
      userIds: ['u2', 'u3'],
      type: 'crew_update',
      title: 't',
      body: 'b',
      topic: 'crew',
    });
    const batch = messaging.sendEach.mock.calls[0]!.arguments[0];
    assert.deepEqual(
      batch.map((m: any) => m.token),
      [androidToken],
    );
  });

  it('an Android set_reminder uses the set-reminders channel', async () => {
    const stores = makeStores({ tokens: { u1: [{ token: androidToken, platform: 'android' }] } });
    const { svc, messaging } = build(stores);
    await svc.send(reminder);
    assert.equal(messaging.send.mock.calls[0]!.arguments[0].android.notification.channelId, 'set-reminders');
  });

  it('a crew_poll batch uses the crew channel', async () => {
    const stores = makeStores({
      festivalUsers: ['u1'],
      tokens: { u1: [{ token: androidToken, platform: 'android' }] },
    });
    const { svc, messaging } = build(stores);
    await svc.sendToOfflineUsers({ festivalId: 'f1', type: 'crew_poll', title: 't', body: 'b' });
    const batch = messaging.sendEach.mock.calls[0]!.arguments[0];
    assert.equal(batch[0].android.notification.channelId, 'crew');
  });

  it('a crew_poll to a user with crewPolls off is not sent', async () => {
    const stores = makeStores({
      prefs: { u1: { crewPolls: 0, crewUpdates: 1 } },
      tokens: { u1: [{ token: androidToken, platform: 'android' }] },
    });
    const { svc, messaging } = build(stores);
    const result = await svc.send({ userId: 'u1', type: 'crew_poll', title: 't', body: 'b' });
    assert.equal(result.reason, 'user_disabled');
    assert.equal(messaging.send.mock.calls.length, 0);
  });

  it('sendSilentSync skips web devices', async () => {
    const stores = makeStores({
      festivalUsers: ['u1'],
      tokens: { u1: [{ token: webToken, platform: 'web' }] },
    });
    const { svc, webPush, messaging } = build(stores);
    const result = await svc.sendSilentSync({ festivalId: 'f1', syncType: 'picks' });
    assert.equal(result.sent, 0);
    assert.equal(messaging.send.mock.calls.length, 0);
    assert.equal(webPush.send.mock.calls.length, 0);
  });
});

// ── notifications/index: isConfigured spans both transports ─────────────

describe('notifications/index: createNotificationService isConfigured', () => {
  const makeStores = () => ({
    notificationPrefs: { get: async () => null },
    deviceTokens: { listByUser: async () => [], unregister: async () => {} },
    notificationCounts: { getByUser: async () => [], increment: async () => {}, reset: async () => {} },
    notificationLog: { insert: async () => null },
    profiles: { userIdsByFestival: async () => [] },
  });
  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };

  it('isConfigured=true when APNs is configured and firebase is not', () => {
    const svc = createNotificationService({
      stores: makeStores(),
      config: {
        PUBLIC_ORIGIN: 'https://festie.us',
        FIREBASE_CREDENTIALS_PATH: '',
        APNS_KEY_PATH: '/k.p8',
        APNS_KEY_ID: 'K',
        APNS_TEAM_ID: 'T',
        APNS_BUNDLE_ID: 'us.festie.app',
      },
      log: fakeLog,
    });
    assert.equal(svc.isConfigured, true);
  });
});

// ── notifications/send: batched fan-out reads ───────────────────────────

describe('notifications/send: batched fan-out reads', () => {
  const fakeLog = { info() {}, warn() {}, error() {}, debug() {} };
  const config = {
    PUBLIC_ORIGIN: 'https://festie.us',
    APNS_KEY_PATH: '/k.p8',
    APNS_KEY_ID: 'K',
    APNS_TEAM_ID: 'T',
    APNS_BUNDLE_ID: 'us.festie.app',
  };
  const userIds = Array.from({ length: 200 }, (_, i) => `u${String(i).padStart(3, '0')}`);

  // Mixed audience: Android, iOS and web devices, a second device on some users, users
  // with no device, preferences off, quiet hours, a spent budget and varied unread totals.
  function devicesOf(uid: string, i: number) {
    if (i % 11 === 0) return [];
    const kind = ['android', 'ios', 'web'][i % 3]!;
    const token =
      kind === 'web' ? JSON.stringify({ endpoint: `https://push.example/${uid}`, keys: {} }) : `${kind}-${uid}-`.padEnd(64, 'x');
    const devices = [{ userId: uid, token, platform: kind, localRemindersFestivalId: null }];
    if (i % 7 === 0) {
      devices.push({ userId: uid, token: `android2-${uid}-`.padEnd(64, 'y'), platform: 'android', localRemindersFestivalId: null });
    }
    return devices;
  }
  const prefsOf = (i: number) =>
    i % 10 === 9 ? { crewUpdates: 0 } : i % 17 === 0 ? { crewUpdates: 1, dndStart: '00:00', dndEnd: '23:59' } : null;
  const unreadOf = (i: number) => i % 5;

  function makeStores({ batched }: { batched: boolean }) {
    const index = new Map(userIds.map((uid, i) => [uid, i]));
    const at = (uid: string) => index.get(uid)!;
    const stores: any = {
      notificationPrefs: { get: mock.fn(async (uid: string) => prefsOf(at(uid))) },
      deviceTokens: {
        listByUser: mock.fn(async (uid: string) => devicesOf(uid, at(uid))),
        unregister: mock.fn(async () => {}),
      },
      notificationCounts: {
        getByUser: mock.fn(async (uid: string) => [{ festivalId: 'f1', unreadUpdates: unreadOf(at(uid)) }]),
        increment: mock.fn(async () => {}),
      },
      notificationLog: {
        insert: mock.fn(async (_row: any) => null),
        countRecentPushes: mock.fn(async (ids: string[]) => new Map(ids.filter((uid) => at(uid) % 13 === 0).map((uid) => [uid, 6]))),
      },
      profiles: { userIdsByFestival: mock.fn(async () => userIds) },
      topicSubscriptions: { getUnsubscribedUsers: mock.fn(async () => new Set<string>()) },
    };
    if (batched) {
      stores.notificationPrefs.getMany = mock.fn(async (ids: string[]) => new Map(ids.map((uid) => [uid, prefsOf(at(uid))])));
      stores.deviceTokens.listByUsers = mock.fn(async (ids: string[]) => ids.flatMap((uid) => devicesOf(uid, at(uid))));
      stores.notificationCounts.unreadTotals = mock.fn(
        async (ids: string[]) => new Map(ids.filter((uid) => unreadOf(at(uid)) > 0).map((uid) => [uid, unreadOf(at(uid))])),
      );
    }
    return stores;
  }

  function build(stores: any) {
    const messaging = {
      send: mock.fn(async (_m: any) => 'fcm-id'),
      sendEach: mock.fn(async (batch: any[]) => ({ responses: batch.map(() => ({ success: true })) })),
    };
    const apnsProvider = {
      send: mock.fn(async (_t: string, _p: any, _o: any) => ({ sent: true, stale: false })),
      close() {},
      _resetTokenCache() {},
    };
    const webPush = { publicKey: 'pk', send: mock.fn(async (_t: string, _p: any, _o: any) => ({ sent: true, stale: false })) };
    const svc = createSendService({ stores, config, log: fakeLog, messaging, retryQueue: { enqueue() {} }, apnsProvider, webPush });
    return { svc, messaging, apnsProvider, webPush };
  }

  async function fanOut(batched: boolean) {
    const stores = makeStores({ batched });
    const { svc, messaging, apnsProvider, webPush } = build(stores);
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1',
      type: 'crew_update',
      title: 'Crew update',
      body: 'Something changed',
      data: { festivalId: 'f1', deepLink: 'https://festie.us/compare' },
      topic: 'crew',
      threadId: 'crew-f1',
    });
    const calls = (fn: any) => fn.mock.calls.map((c: any) => c.arguments);
    return {
      stores,
      result,
      fcm: calls(messaging.sendEach),
      apns: calls(apnsProvider.send),
      web: calls(webPush.send),
      logged: stores.notificationLog.insert.mock.calls.map(({ arguments: [{ id: _id, ...row }] }: any) => row),
      increments: calls(stores.notificationCounts.increment),
    };
  }

  it('sendToOfflineUsers to 200 users reads each store once', async () => {
    const { stores, result } = await fanOut(true);
    assert.ok(result.sent > 0);
    assert.equal(stores.notificationPrefs.get.mock.callCount(), 0);
    assert.equal(stores.notificationPrefs.getMany.mock.callCount(), 1);
    assert.equal(stores.deviceTokens.listByUser.mock.callCount(), 0);
    assert.equal(stores.deviceTokens.listByUsers.mock.callCount(), 1);
    assert.equal(stores.notificationCounts.getByUser.mock.callCount(), 0);
    assert.equal(stores.notificationCounts.unreadTotals.mock.callCount(), 1);
    const reads = [
      stores.notificationPrefs.get,
      stores.notificationPrefs.getMany,
      stores.deviceTokens.listByUser,
      stores.deviceTokens.listByUsers,
      stores.notificationCounts.getByUser,
      stores.notificationCounts.unreadTotals,
      stores.notificationLog.countRecentPushes,
      stores.topicSubscriptions.getUnsubscribedUsers,
      stores.profiles.userIdsByFestival,
    ].reduce((n: number, fn: any) => n + fn.mock.callCount(), 0);
    assert.ok(reads <= 6, `expected at most 6 store reads, got ${reads}`);
  });

  it('sends the same messages, badges and inbox rows as the per-user path', async () => {
    const perUser = await fanOut(false);
    const batched = await fanOut(true);
    assert.ok(perUser.stores.notificationPrefs.get.mock.callCount() >= 200, 'the reference run reads per user');
    assert.ok(perUser.fcm.length > 0 && perUser.apns.length > 0 && perUser.web.length > 0);
    assert.deepEqual(batched.result, perUser.result);
    assert.deepEqual(batched.fcm, perUser.fcm);
    assert.deepEqual(batched.apns, perUser.apns);
    assert.deepEqual(batched.web, perUser.web);
    assert.deepEqual(batched.logged, perUser.logged);
    assert.deepEqual(batched.increments, perUser.increments);
    const badges = new Set(batched.apns.map(([, payload]: any) => payload.aps.badge));
    assert.deepEqual([...badges].sort(), [1, 2, 3, 4], 'zero or missing totals read as 1');
  });

  // Copy of the per-user loop in sendToOfflineUsers at ffc40fcb (before batching), reduced to
  // what it decided: which inbox rows to write and which device got which badge, in order.
  async function perUserLoopAtFfc40fcb(stores: any) {
    const pushCounts = await stores.notificationLog.countRecentPushes(userIds);
    const inbox: [string, string][] = [];
    const fcm: [string, number][] = [];
    const apns: [string, number][] = [];
    const web: string[] = [];
    for (const userId of userIds) {
      const prefs = await stores.notificationPrefs.get(userId);
      if (prefs && !prefs.crewUpdates) continue;
      const held = isInDndWindow(prefs) || (pushCounts.get(userId) ?? 0) >= 6;
      inbox.push([userId, held ? 'held' : 'inbox']);
      if (held) continue;
      const tokens = await stores.deviceTokens.listByUser(userId);
      const counts = await stores.notificationCounts.getByUser(userId);
      const badge = counts.reduce((sum: number, c: any) => sum + (c.unreadUpdates || 0), 0) || 1;
      for (const device of tokens) {
        if (device.platform === 'ios') apns.push([device.token, badge]);
        else if (device.platform === 'web') web.push(device.token);
        else fcm.push([device.token, badge]);
      }
    }
    return { inbox, fcm, apns, web };
  }

  it('makes the same inbox, device and badge decisions as the per-user loop at ffc40fcb', async () => {
    const expected = await perUserLoopAtFfc40fcb(makeStores({ batched: false }));
    const batched = await fanOut(true);
    assert.ok(expected.fcm.length > 0 && expected.apns.length > 0 && expected.web.length > 0);
    assert.deepEqual(
      batched.logged.filter((row: any) => row.platform === 'inbox').map((row: any) => [row.userId, row.status]),
      expected.inbox,
    );
    assert.deepEqual(
      batched.fcm.flatMap(([msgs]: any) => msgs.map((m: any) => [m.token, m.apns.payload.aps.badge])),
      expected.fcm,
    );
    assert.deepEqual(
      batched.apns.map(([token, payload]: any) => [token, payload.aps.badge]),
      expected.apns,
    );
    assert.deepEqual(
      batched.web.map(([token]: any) => token),
      expected.web,
    );
  });

  it('writes an inbox row for a user with no device and for held users, none for opted-out users', async () => {
    const { logged } = await fanOut(true);
    const inbox = logged.filter((row: any) => row.platform === 'inbox');
    const byUser = new Map(inbox.map((row: any) => [row.userId, row.status]));
    assert.equal(byUser.get('u011'), 'inbox', 'no device, still in the inbox');
    assert.equal(byUser.get('u017'), 'held', 'quiet hours');
    assert.equal(byUser.get('u013'), 'held', 'budget');
    assert.equal(byUser.has('u009'), false, 'preference off');
    assert.deepEqual(
      inbox.map((row: any) => row.userId),
      userIds.filter((uid) => byUser.has(uid)),
      'inbox rows keep batch order',
    );
  });

  it('a failed unread total reads as badge 1; a failed prefs read throws', async () => {
    const stores = makeStores({ batched: true });
    stores.notificationCounts.unreadTotals = mock.fn(async () => {
      throw new Error('db down');
    });
    const { svc, apnsProvider } = build(stores);
    await svc.sendToOfflineUsers({ festivalId: 'f1', type: 'crew_update', title: 't', body: 'b', data: { festivalId: 'f1' } });
    assert.ok(apnsProvider.send.mock.callCount() > 0);
    for (const [, payload] of apnsProvider.send.mock.calls.map((c: any) => c.arguments)) assert.equal(payload.aps.badge, 1);

    const failing = makeStores({ batched: true });
    failing.notificationPrefs.getMany = mock.fn(async () => {
      throw new Error('db down');
    });
    await assert.rejects(
      build(failing).svc.sendToOfflineUsers({ festivalId: 'f1', type: 'crew_update', title: 't', body: 'b' }),
      /db down/,
    );
  });

  it('sendSilentSync to 200 users reads tokens once', async () => {
    const stores = makeStores({ batched: true });
    const { svc, messaging, apnsProvider } = build(stores);
    const result = await svc.sendSilentSync({ festivalId: 'f1', syncType: 'profiles' });
    assert.equal(stores.deviceTokens.listByUsers.mock.callCount(), 1);
    assert.equal(stores.deviceTokens.listByUser.mock.callCount(), 0);
    assert.equal(result.sent, messaging.send.mock.callCount() + apnsProvider.send.mock.callCount());
    assert.ok(result.sent > 0);
  });
});
