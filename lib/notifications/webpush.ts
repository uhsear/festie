// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Web Push sender (RFC 8030 delivery, RFC 8291 aes128gcm payload encryption,
 * RFC 8292 VAPID auth). Uses only node built-ins (`crypto`, native `fetch`).
 *
 * A web device token is the browser's `PushSubscription` JSON. The server POSTs
 * to the subscription's endpoint, a URL the client supplied, so
 * `parseWebPushSubscription` only accepts https endpoints on known push-service
 * hosts. That allowlist is the SSRF guard.
 *
 * Inert unless both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set.
 */

import crypto from 'crypto';

const RECORD_SIZE = 4096;
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_TTL_SEC = 86400;

const ALLOWED_PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const ALLOWED_PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

export interface WebPushSubscription {
  endpoint: string;
  p256dh: Buffer;
  auth: Buffer;
}

export interface WebPushResult {
  sent: boolean;
  stale: boolean;
  error?: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface WebPushSendOpts {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface WebPushSender {
  publicKey: string;
  send(token: string, payload: WebPushPayload, opts?: WebPushSendOpts): Promise<WebPushResult>;
}

function isAllowedPushHost(hostname: string): boolean {
  return ALLOWED_PUSH_HOSTS.includes(hostname) || ALLOWED_PUSH_HOST_SUFFIXES.some((s) => hostname.endsWith(s));
}

export function parseWebPushSubscription(token: string): WebPushSubscription | null {
  let parsed: any;
  try {
    parsed = JSON.parse(token);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.endpoint !== 'string') return null;
  let url: URL;
  try {
    url = new URL(parsed.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !isAllowedPushHost(url.hostname)) return null;
  const keys = parsed.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  const p256dh = Buffer.from(keys.p256dh, 'base64url');
  const auth = Buffer.from(keys.auth, 'base64url');
  if (p256dh.length !== 65 || p256dh[0] !== 0x04 || auth.length !== 16) return null;
  return { endpoint: parsed.endpoint, p256dh, auth };
}

/** RFC 8291 aes128gcm encryption with a single record. */
export function encryptPayload(
  plaintext: Buffer,
  p256dh: Buffer,
  auth: Buffer,
  opts: { salt?: Buffer; asPrivateKey?: Buffer } = {},
): Buffer {
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.asPrivateKey) ecdh.setPrivateKey(opts.asPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const salt = opts.salt ?? crypto.randomBytes(16);

  const ecdhSecret = ecdh.computeSecret(p256dh);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), p256dh, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, auth, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext, cipher.getAuthTag()]);
}

function signingKey(publicKey: string, privateKey: string): crypto.KeyObject {
  const pub = Buffer.from(publicKey, 'base64url');
  return crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: privateKey,
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
}

export function vapidAuthHeader(endpoint: string, vapid: VapidKeys, nowSec: number): string {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: vapid.subject }),
  ).toString('base64url');
  const data = `${header}.${claims}`;
  const key = signingKey(vapid.publicKey, vapid.privateKey);
  const signature = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${signature.toString('base64url')}, k=${vapid.publicKey}`;
}

export function createWebPushSender(config: any, log: any): WebPushSender | null {
  const publicKey = config?.VAPID_PUBLIC_KEY || '';
  const privateKey = config?.VAPID_PRIVATE_KEY || '';
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) {
    log?.warn?.('Web push disabled: set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
    return null;
  }
  const vapid: VapidKeys = {
    publicKey,
    privateKey,
    subject: config.VAPID_SUBJECT || config.PUBLIC_ORIGIN || 'https://festie.us',
  };

  return {
    publicKey,
    async send(token, payload, opts = {}) {
      const sub = parseWebPushSubscription(token);
      if (!sub) return { sent: false, stale: true };
      try {
        const body = encryptPayload(Buffer.from(JSON.stringify(payload)), sub.p256dh, sub.auth);
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: vapidAuthHeader(sub.endpoint, vapid, Math.floor(Date.now() / 1000)),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(opts.ttl ?? DEFAULT_TTL_SEC),
            Urgency: opts.urgency ?? 'normal',
          },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.status === 201 || res.status === 202) return { sent: true, stale: false };
        // 401/403: the subscription was made with another VAPID key. 404/410: gone.
        if ([401, 403, 404, 410].includes(res.status)) return { sent: false, stale: true };
        return { sent: false, stale: false, error: `HTTP ${res.status}` };
      } catch (error: any) {
        return { sent: false, stale: false, error: error?.message || String(error) };
      }
    },
  };
}
