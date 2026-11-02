import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, describe, test } from 'node:test';
import {
  createWebPushSender,
  encryptPayload,
  parseWebPushSubscription,
  vapidAuthHeader,
} from '../lib/notifications/webpush';

const b64 = (s: string) => Buffer.from(s, 'base64url');

// RFC 8291 section 5 example.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

function subscription(overrides: any = {}) {
  return JSON.stringify({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: RFC.uaPublic, auth: RFC.auth },
    ...overrides,
  });
}

function vapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey('base64url'),
    privateKey: ecdh.getPrivateKey('base64url'),
  };
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

describe('encryptPayload', () => {
  test('reproduces the RFC 8291 section 5 example body', () => {
    const out = encryptPayload(Buffer.from(RFC.plaintext), b64(RFC.uaPublic), b64(RFC.auth), {
      salt: b64(RFC.salt),
      asPrivateKey: b64(RFC.asPrivate),
    });
    assert.equal(out.toString('base64url'), RFC.body);
  });
});

describe('parseWebPushSubscription', () => {
  test('accepts a valid FCM subscription', () => {
    const sub = parseWebPushSubscription(subscription());
    assert.ok(sub);
    assert.equal(sub.endpoint, 'https://fcm.googleapis.com/fcm/send/abc123');
    assert.equal(sub.p256dh.length, 65);
    assert.equal(sub.auth.length, 16);
  });

  test('accepts Apple and Windows push hosts by suffix', () => {
    assert.ok(parseWebPushSubscription(subscription({ endpoint: 'https://web.push.apple.com/x' })));
    assert.ok(parseWebPushSubscription(subscription({ endpoint: 'https://wns2-by3p.notify.windows.com/w/?t=1' })));
  });

  test('rejects http:', () => {
    assert.equal(parseWebPushSubscription(subscription({ endpoint: 'http://fcm.googleapis.com/fcm/send/x' })), null);
  });

  test('rejects a host that is not allowed', () => {
    assert.equal(parseWebPushSubscription(subscription({ endpoint: 'https://evil.example/x' })), null);
    assert.equal(parseWebPushSubscription(subscription({ endpoint: 'https://fcm.googleapis.com.evil.example/x' })), null);
  });

  test('rejects a 64-byte p256dh', () => {
    const p256dh = b64(RFC.uaPublic).subarray(0, 64).toString('base64url');
    assert.equal(parseWebPushSubscription(subscription({ keys: { p256dh, auth: RFC.auth } })), null);
  });

  test('rejects a 15-byte auth', () => {
    const auth = b64(RFC.auth).subarray(0, 15).toString('base64url');
    assert.equal(parseWebPushSubscription(subscription({ keys: { p256dh: RFC.uaPublic, auth } })), null);
  });

  test('rejects non-JSON', () => {
    assert.equal(parseWebPushSubscription('fcm-test-token-abc123456789'), null);
  });
});

describe('vapidAuthHeader', () => {
  test('signs an ES256 JWT that verifies against the public key', () => {
    const keys = vapidKeys();
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
    const header = vapidAuthHeader(endpoint, { ...keys, subject: 'https://festie.us' }, 1_700_000_000);
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    assert.ok(match);
    assert.equal(match[2], keys.publicKey);
    const [h, c, s] = match[1]!.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.exp, 1_700_000_000 + 12 * 3600);
    assert.equal(claims.sub, 'https://festie.us');
    const pub = b64(keys.publicKey);
    const key = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: pub.subarray(1, 33).toString('base64url'),
        y: pub.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    });
    const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, b64(s));
    assert.equal(ok, true);
  });
});

describe('createWebPushSender', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(status: number) {
    const calls: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url, init });
      return new Response(null, { status });
    }) as any;
    return calls;
  }

  const payload = { title: 'T', body: 'B', url: 'https://festie.us/set/s1', tag: 'set_reminder' };

  test('returns null without keys', () => {
    assert.equal(createWebPushSender({}, silentLog), null);
  });

  test('returns null and warns once when only one key is set', () => {
    const warnings: string[] = [];
    const sender = createWebPushSender({ VAPID_PUBLIC_KEY: 'x' }, { ...silentLog, warn: (m: string) => warnings.push(m) });
    assert.equal(sender, null);
    assert.deepEqual(warnings, ['Web push disabled: set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.']);
  });

  function sender() {
    const keys = vapidKeys();
    const s = createWebPushSender({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }, silentLog);
    assert.ok(s);
    assert.equal(s.publicKey, keys.publicKey);
    return s;
  }

  test('201 is sent, with the push headers', async () => {
    const calls = stubFetch(201);
    const result = await sender().send(subscription(), payload, { ttl: 3600, urgency: 'high' });
    assert.deepEqual(result, { sent: true, stale: false });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://fcm.googleapis.com/fcm/send/abc123');
    const h = calls[0].init.headers;
    assert.equal(h['Content-Encoding'], 'aes128gcm');
    assert.equal(h.TTL, '3600');
    assert.equal(h.Urgency, 'high');
    assert.match(h.Authorization, /^vapid t=/);
  });

  test('410 and 403 are stale', async () => {
    stubFetch(410);
    assert.deepEqual(await sender().send(subscription(), payload), { sent: false, stale: true });
    stubFetch(403);
    assert.deepEqual(await sender().send(subscription(), payload), { sent: false, stale: true });
  });

  test('500 is a failure that keeps the token', async () => {
    stubFetch(500);
    const result = await sender().send(subscription(), payload);
    assert.equal(result.sent, false);
    assert.equal(result.stale, false);
    assert.ok(result.error);
  });

  test('an invalid token is stale and never fetched', async () => {
    const calls = stubFetch(201);
    const result = await sender().send(subscription({ endpoint: 'https://evil.example/x' }), payload);
    assert.deepEqual(result, { sent: false, stale: true });
    assert.equal(calls.length, 0);
  });
});
