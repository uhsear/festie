import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dirname, '..', 'scripts', 'ops', 'drill.env.example');
const entries = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim() && !line.startsWith('#'))
  .map((line) => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1)] as const;
  });
const env = Object.fromEntries(entries);

describe('scripts/ops/drill.env.example', () => {
  it('boots on loopback port 4101 without Redis', () => {
    assert.equal(env.PORT, '4101');
    assert.equal(env.REDIS_ENABLED, 'false');
  });

  it('blanks every production service credential', () => {
    for (const key of ['FIREBASE_CREDENTIALS_PATH', 'RESEND_API_KEY', 'VAPID_PRIVATE_KEY', 'FCM_RETRY_WEBHOOK_URL', 'SENTRY_DSN']) {
      assert.ok(key in env, `${key} must be listed`);
      assert.equal(env[key], '', `${key} must be empty`);
    }
  });

  it('carries nothing else', () => {
    assert.deepEqual(Object.keys(env).sort(), [
      'FCM_RETRY_WEBHOOK_URL',
      'FIREBASE_CREDENTIALS_PATH',
      'PORT',
      'REDIS_ENABLED',
      'RESEND_API_KEY',
      'SENTRY_DSN',
      'VAPID_PRIVATE_KEY',
    ]);
  });
});
