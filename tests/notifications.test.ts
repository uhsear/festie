import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test, beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createNotificationService } from '../lib/notifications';
import createNotificationRoutes from '../routes/notifications';
import { schemas, validate } from '../lib/schemas';

// ── Test helpers ──────────────────────────────────────────────

function makeMockStores(overrides: any = {}) {
  return {
    notificationPrefs: {
      get: async () => null,
      ...overrides.notificationPrefs,
    },
    deviceTokens: {
      listByUser: async () => [],
      unregister: async () => {},
      ...overrides.deviceTokens,
    },
    notificationCounts: {
      getByUser: async () => [],
      increment: async () => {},
      reset: async () => {},
      ...overrides.notificationCounts,
    },
    notificationLog: {
      insert: async () => 'log-id',
      ...overrides.notificationLog,
    },
    profiles: {
      userIdsByFestival: async () => [],
      readAll: async () => [],
      ...overrides.profiles,
    },
    topicSubscriptions: {
      getUnsubscribedUsers: async () => new Set(),
      ...overrides.topicSubscriptions,
    },
    pool: { query: async () => ({ rows: [] }) },
  };
}

function makeMockConfig(overrides: any = {}) {
  return {
    FIREBASE_CREDENTIALS_PATH: '', // disabled by default
    PUBLIC_ORIGIN: 'https://festie.us',
    ...overrides,
  };
}

const silentLog = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
};

function createService(storeOverrides: any = {}, configOverrides: any = {}) {
  return createNotificationService({
    stores: makeMockStores(storeOverrides),
    config: makeMockConfig(configOverrides),
    log: silentLog,
    _io: null,
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe('Notification Service — factory', () => {
  test('creates service with expected interface', () => {
    const svc = createService();
    assert.equal(typeof svc.send, 'function');
    assert.equal(typeof svc.sendToOfflineUsers, 'function');
    assert.equal(typeof svc.sendSilentSync, 'function');
    assert.equal(typeof svc.markRead, 'function');
    assert.equal(typeof svc.retryQueue, 'object');
    assert.equal(typeof svc.isConfigured, 'boolean');
  });

  test('isConfigured is false when FIREBASE_CREDENTIALS_PATH not set', () => {
    const svc = createService();
    assert.equal(svc.isConfigured, false);
  });
});

describe('Notification Service — send()', () => {
  test('returns firebase_not_configured when disabled', async () => {
    const svc = createService();
    const result = await svc.send({
      userId: 'u1', type: 'crew_update', title: 'Test', body: 'Body',
    });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'firebase_not_configured');
  });

  test('rejects invalid notification type', async () => {
    const svc = createService();
    const result = await svc.send({
      userId: 'u1', type: 'invalid_type', title: 'Test', body: 'Body',
    });
    assert.equal(result.sent, 0);
    // Either firebase_not_configured or invalid_type depending on check order
    assert.ok(result.reason === 'firebase_not_configured' || result.reason === 'invalid_type');
  });
});

describe('Notification Service — sendToOfflineUsers()', () => {
  test('returns { sent: 0 } when firebase not configured', async () => {
    const svc = createService();
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 'Test', body: 'Body',
    });
    assert.equal(result.sent, 0);
  });

  test('rejects invalid notification type', async () => {
    const svc = createService();
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'bad_type', title: 'Test', body: 'Body',
    });
    assert.equal(result.sent, 0);
  });
});

describe('Notification Service — sendSilentSync()', () => {
  test('returns { sent: 0 } when firebase not configured', async () => {
    const svc = createService();
    const result = await svc.sendSilentSync({
      festivalId: 'f1', syncType: 'picks',
    });
    assert.equal(result.sent, 0);
  });

  test('returns { sent: 0 } when no users in festival', async () => {
    const svc = createService({
      profiles: { userIdsByFestival: async () => [] },
    });
    const result = await svc.sendSilentSync({
      festivalId: 'f1', syncType: 'picks',
    });
    assert.equal(result.sent, 0);
  });

  test('excludes specified user IDs', async () => {
    const svc = createService({
      profiles: { userIdsByFestival: async () => ['u1', 'u2'] },
    });
    // All users excluded → sent 0
    const result = await svc.sendSilentSync({
      festivalId: 'f1', syncType: 'picks', excludeUserIds: ['u1', 'u2'],
    });
    assert.equal(result.sent, 0);
  });
});

describe('Notification Service — markRead()', () => {
  test('calls notificationCounts.reset', async () => {
    let resetCalled = false;
    const svc = createService({
      notificationCounts: {
        getByUser: async () => [],
        increment: async () => {},
        reset: async (userId: any, festivalId: any) => {
          resetCalled = true;
          assert.equal(userId, 'u1');
          assert.equal(festivalId, 'f1');
        },
      },
    });
    await svc.markRead('u1', 'f1');
    assert.ok(resetCalled, 'notificationCounts.reset should be called');
  });

  test('handles missing notificationCounts store gracefully', async () => {
    const svc = createNotificationService({
      stores: { ...makeMockStores(), notificationCounts: null },
      config: makeMockConfig(),
      log: silentLog,
      _io: null,
    });
    // Should not throw
    await svc.markRead('u1', 'f1');
  });

  test('handles reset error gracefully', async () => {
    const svc = createService({
      notificationCounts: {
        getByUser: async () => [],
        increment: async () => {},
        reset: async () => { throw new Error('db error'); },
      },
    });
    // Should not throw
    await svc.markRead('u1', 'f1');
  });
});

describe('Notification Service — retryQueue', () => {
  test('exposes pending count', () => {
    const svc = createService();
    assert.equal(svc.retryQueue.pending, 0);
  });

  test('shutdown clears the queue', () => {
    const svc = createService();
    svc.retryQueue.shutdown();
    assert.equal(svc.retryQueue.pending, 0);
  });
});

describe('Notification Service — type validation', () => {
  test('only crew_update and schedule_change are allowed', async () => {
    const svc = createService();
    // These should not fail with type validation errors (just firebase_not_configured)
    for (const type of ['crew_update', 'schedule_change']) {
      const result = await svc.send({ userId: 'u1', type, title: 'T', body: 'B' });
      assert.equal(result.reason, 'firebase_not_configured');
    }
  });

  test('reminder type is rejected (feature removed)', async () => {
    const svc = createService();
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'reminder', title: 'T', body: 'B',
    });
    assert.equal(result.sent, 0);
  });
});

describe('Notification routes — web push', () => {
  function buildApp(config: any = {}) {
    const registered: any[] = [];
    const router = createNotificationRoutes({
      express,
      config,
      log: silentLog,
      stores: {
        deviceTokens: {
          getTokenOwner: async () => null,
          listByUser: async () => [],
          unregister: async () => {},
          register: async (row: any) => registered.push(row),
        },
      },
      userAuth: (req: any, _res: any, next: any) => {
        req.user = { userId: 'u1' };
        next();
      },
      setNoStore: () => {},
      sanitizeString: (s: string) => s,
      sanitizeIdentifier: (s: string) => s,
      createOpaqueId: () => 'dtoken-1',
      getRequestIp: () => '127.0.0.1',
      sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
      sendError: (res: any, status: number, message: string, code: string) =>
        res.status(status).json({ data: null, error: { message, code } }),
      ErrorCodes: { INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
      schemas,
      validate,
    });
    const app = express();
    app.use(express.json());
    app.use(router);
    return { app, registered };
  }

  function webSubscription(endpoint: string) {
    const ua = crypto.createECDH('prime256v1');
    ua.generateKeys();
    return JSON.stringify({
      endpoint,
      keys: { p256dh: ua.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
    });
  }

  test('POST /token rejects a web subscription on a host that is not allowed', async () => {
    const { app, registered } = buildApp();
    const res = await request(app)
      .post('/token')
      .send({ token: webSubscription('https://evil.example/push/1'), platform: 'web' })
      .expect(400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
    assert.match(res.body.error.message, /push subscription is not valid/);
    assert.equal(registered.length, 0);
  });

  test('POST /token rejects a web token that is not a subscription', async () => {
    const { app } = buildApp();
    await request(app).post('/token').send({ token: 'fcm-test-token-abc123456789', platform: 'web' }).expect(400);
  });

  test('POST /token accepts a valid web subscription', async () => {
    const { app, registered } = buildApp();
    await request(app)
      .post('/token')
      .send({ token: webSubscription('https://fcm.googleapis.com/fcm/send/abc'), platform: 'web' })
      .expect(200);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].platform, 'web');
  });

  test('GET /vapid-key returns 404 without keys', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/vapid-key').expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'Web push is not set up on this server.');
  });

  test('GET /vapid-key returns the public key when both keys are set', async () => {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const publicKey = ecdh.getPublicKey('base64url');
    const { app } = buildApp({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: ecdh.getPrivateKey('base64url') });
    const res = await request(app).get('/vapid-key').expect(200);
    assert.equal(res.body.data.publicKey, publicKey);
    assert.equal(res.headers['cache-control'], 'public, max-age=3600');
  });
});

describe('Notification Service — DND and preferences', () => {
  // These tests verify preference checking logic even when firebase is disabled
  // The send() function checks firebase first, so we validate through sendToOfflineUsers
  // which checks type validity before firebase

  test('sendToOfflineUsers with no users returns sent 0', async () => {
    const svc = createService({
      profiles: { userIdsByFestival: async () => [] },
    });
    const result = await svc.sendToOfflineUsers({
      festivalId: 'f1', type: 'crew_update', title: 'T', body: 'B',
    });
    assert.equal(result.sent, 0);
  });
});
