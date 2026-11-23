// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';
import https from 'https';
import { createRequire } from 'module';
import { isInDndWindow } from './dnd.js';
import {
  ALLOWED_NOTIFICATION_TYPES,
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  enforcePayloadLimits,
  postToWebhookRetry,
} from './payload.js';
import { loadConfig as _loadSendConfig } from '../config.js';
import { withRetry } from '../helpers.js';
import { isApnsConfigured, getApnsProvider } from './apns.js';
import { appOrigin } from './links.js';
import type { WebPushResult, WebPushSender } from './webpush.js';

const require = createRequire(import.meta.url);

type LogFn = (message: string, meta?: Record<string, unknown>) => void;
interface Log {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error?: LogFn;
}
/** Test doubles implement only the store and client methods a case touches. */
type Loose<T> = { [K in keyof T]?: Partial<T[K]> };
type PushData = Record<string, string>;
type ApnsProvider = NonNullable<ReturnType<typeof getApnsProvider>>;
type ApnsOpts = Parameters<ApnsProvider['send']>[2];
/** What a caught provider or store error may carry. */
type Failure = Error & { code?: string };

interface Device {
  token: string;
  platform?: string;
  localRemindersCoversUntil?: number | string | null;
  localRemindersFestivalId?: string | null;
}

interface Prefs {
  dndStart?: string;
  dndEnd?: string;
  dndTimeZone?: string | null;
  [key: string]: unknown;
}

interface FcmMessage {
  token: string;
  notification?: { title: string; body: string };
  data: Record<string, unknown>;
  android?: unknown;
  apns?: unknown;
}

interface Messaging {
  send(message: unknown): Promise<unknown>;
  sendEach(batch: unknown[]): Promise<{ responses: { success: boolean; error?: { code?: string } }[] }>;
}

interface RetryQueue {
  enqueue(entry: { userId: string; sendFn: () => Promise<unknown> }): void;
}

interface PromMetrics {
  pushProviderOutageCounter?: { inc(labels: { provider: string }): void };
}

interface SendStores {
  profiles: {
    userIdsByFestival?(festivalId: string): Promise<string[]>;
    readAll(): Promise<{ festivalId?: string; userId?: string }[]>;
  };
  notificationPrefs: {
    get(userId: string): Promise<Prefs | null | undefined>;
    getMany?(userIds: string[]): Promise<Map<string, Prefs>>;
  };
  deviceTokens: {
    listByUser(userId: string): Promise<Device[]>;
    listByUsers?(userIds: string[]): Promise<(Device & { userId: string })[]>;
    unregister(token: string, userId: string): Promise<unknown>;
  };
  notificationCounts?: {
    getByUser(userId: string): Promise<{ unreadUpdates?: number }[]>;
    increment(userId: string, festivalId: string, kind: string): Promise<unknown>;
    unreadTotals?(userIds: string[]): Promise<Map<string, number>>;
    reset(userId: string, festivalId: string): Promise<unknown>;
  };
  notificationLog?: {
    insert(row: Record<string, unknown>): Promise<unknown>;
    countRecentPushes?(userIds: string[], exemptTypes: string[]): Promise<Map<string, number>>;
  };
  topicSubscriptions?: {
    getUnsubscribedUsers?(festivalId: string, topic: string): Promise<Set<string>>;
  };
}

interface PushContent {
  safeTitle: string;
  safeBody: string;
  safeData: PushData;
}

interface SendDeps {
  stores: Loose<SendStores>;
  config: Parameters<typeof getApnsProvider>[0] & { PUBLIC_ORIGIN?: string };
  log: Log;
  messaging: Partial<Messaging> | null;
  retryQueue: RetryQueue;
  apnsProvider?: ApnsProvider | null;
  promMetrics?: PromMetrics | null;
  webPush?: WebPushSender | null;
}

// Reusable HTTPS agent for FCM — prevents TLS session corruption under load (from promptfoo pattern)
const _fcmAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  timeout: _loadSendConfig().FCM_REQUEST_TIMEOUT_MS,
});

// Firebase Admin SDK - loaded lazily only when credentials are configured
let firebaseMessaging: Messaging | null = null;

export function initFirebase(config: { FIREBASE_CREDENTIALS_PATH?: string }, log: Log) {
  if (firebaseMessaging) return firebaseMessaging;
  if (!config.FIREBASE_CREDENTIALS_PATH) {
    log.info('FCM push disabled — FIREBASE_CREDENTIALS_PATH not set');
    return null;
  }
  try {
    // firebase-admin v14 removed the legacy `admin.*` namespace: the root export
    // no longer carries `credential`, `messaging()` or `apps`. Only the modular
    // entrypoints remain. Note the failure mode if this ever regresses — the
    // catch below swallows the TypeError and returns null, which disables push
    // silently rather than crashing, so a wrong import here is invisible at boot
    // apart from one warn line.
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    const serviceAccount = require(config.FIREBASE_CREDENTIALS_PATH);
    const app = initializeApp({ credential: cert(serviceAccount) });
    firebaseMessaging = getMessaging(app);
    log.info('Firebase Cloud Messaging initialized');
    return firebaseMessaging;
  } catch (error) {
    log.warn('Firebase init failed — push notifications disabled', { error: (error as Failure).message });
    return null;
  }
}

/**
 * Validate that a device token is a non-empty string within acceptable length bounds.
 * Replaces three inline checks throughout the send pipeline.
 */
function isValidDeviceToken(device: Device) {
  return device?.token && typeof device.token === 'string' && device.token.length >= 20 && device.token.length <= 4096;
}

/**
 * Truncate an FCM message body if the serialized payload exceeds 4KB.
 * Mutates msg.notification.body in place when needed.
 */
function enforcePayloadSize(msg: { notification?: { body?: string } }, log: Log, context = '') {
  const serialized = JSON.stringify(msg);
  if (serialized.length > 4096) {
    log.warn(`FCM payload exceeds 4KB${context ? ' in ' + context : ''}`, { size: serialized.length });
    if (msg.notification?.body) {
      msg.notification.body = msg.notification.body.slice(0, 200) + '...';
    }
  }
}

/** Map notification type -> user pref key */
export const PREF_MAP: Record<string, string> = {
  crew_update: 'crewUpdates',
  schedule_change: 'scheduleChanges',
  set_reminder: 'setReminders',
  // M3 re-engagement triggers — each has its own per-type opt-out column.
  lineup_drop: 'lineupDrops',
  // "New lineups and set times" covers both announcements; no column of its own.
  set_times_out: 'lineupDrops',
  // Days announced by an admin before any set has a time: same switch, no column of its own.
  days_out: 'lineupDrops',
  crew_reformed: 'crewReformed',
  wrap_ready: 'wrapReady',
  // The Wrap toggle covers the morning rate prompt too (no own column).
  rate_prompt: 'wrapReady',
  crew_meeting_point: 'crewMeetingPoints',
  crew_poll: 'crewPolls',
  crew_money: 'crewMoney',
  crew_ride: 'crewRides',
  // T52 "Looking for you".
  crew_nudge: 'crewNudges',
  // Admin announcements share the "Schedule changes" switch: no own preference column.
  festival_announcement: 'scheduleChanges',
};

/**
 * Safety-critical notification types. These BYPASS the DND window and have NO
 * per-type opt-out (they are intentionally absent from PREF_MAP) — an emergency
 * must reach people. They also route to a dedicated high-priority push channel.
 */
const CRITICAL_TYPES = new Set(['crew_sos']);

/** Types that keep their opt-out but skip quiet hours: "Looking for you" is useless once the night is over. */
const DND_EXEMPT_TYPES = new Set(['crew_nudge']);
/** At most this many pushes reach one user in a rolling hour. */
export const PUSH_BUDGET_PER_HOUR = 6;
/**
 * Never held by the budget and never counted: an emergency, reminders the user asked
 * for, meeting points and the "Looking for you" nudge (owner decision 2026-11-02), and
 * set-time changes, so crew chatter cannot use up a person's budget and hold back news
 * that one of their sets moved. The nudge has its own per-recipient cap in crew-nudge.ts.
 */
export const PUSH_BUDGET_EXEMPT = new Set([
  'crew_sos',
  'set_reminder',
  'crew_meeting_point',
  'schedule_change',
  'crew_nudge',
]);

/** Per-type push channel/category overrides for critical alerts. */
const CRITICAL_CHANNEL: Record<string, { channelId: string; category: string }> = {
  crew_sos: { channelId: 'sos', category: 'CREW_SOS' },
};

/**
 * DC7: Non-critical type → Android channel mapping.
 * crew_* types route to the 'crew' channel (DEFAULT importance) so users can
 * silence crew pings without losing their 'set-reminders' (HIGH) channel.
 * Types not listed here fall back to 'updates' (the default in buildFcmMessage).
 */
const TYPE_CHANNEL_MAP: Record<string, string> = {
  crew_update: 'crew',
  crew_reformed: 'crew',
  crew_meeting_point: 'crew',
  crew_poll: 'crew',
  crew_money: 'crew',
  crew_ride: 'crew',
  crew_nudge: 'crew',
  // Exists on every build since DC7 (useMobilePush.ts); 'updates' was the legacy fallback.
  set_reminder: 'set-reminders',
};

/** Time-sensitive types: a browser should show them soon or not at all. */
const URGENT_WEB_TYPES = new Set(['set_reminder', 'crew_sos', 'crew_nudge']);

/** Check if a stale token error code signals the device is no longer registered */
function isStaleTokenError(code: string) {
  return code.includes('not-registered') || code.includes('invalid-registration') || code.includes('invalid-argument');
}

/**
 * Resolve target user IDs for a festival, excluding specified IDs.
 * Shared by sendToOfflineUsers and sendSilentSync.
 */
async function resolveFestivalTargets(stores: SendStores, festivalId: string, excludeUserIds: string[]) {
  const festivalUserIds = stores.profiles.userIdsByFestival
    ? await stores.profiles.userIdsByFestival(festivalId)
    : (await stores.profiles.readAll())
        .filter((p) => p.festivalId === festivalId && p.userId)
        .map((p) => p.userId as string);
  const excludeSet = new Set(excludeUserIds);
  return festivalUserIds.filter((uid) => !excludeSet.has(uid));
}

/**
 * Build the send-path surface: { send, sendToOfflineUsers, sendSilentSync, markRead }.
 * Takes a resolved `messaging` client (may be null when FCM is not configured) plus
 * the shared deps from the composer.
 */
// Threshold for declaring a provider outage: if more than this fraction of
// sends in a batch fail (and at least one send was attempted), we emit a WARN
// and increment the outage counter. Benign zero-recipient / all-opt-out batches
// are never passed to sendBatch, so they never trigger this check.
const OUTAGE_ERROR_RATIO = 0.5;

export function createSendService({
  stores: looseStores,
  config,
  log,
  messaging: looseMessaging,
  retryQueue,
  apnsProvider,
  promMetrics,
  webPush = null,
}: SendDeps) {
  const stores = looseStores as SendStores;
  const messaging = looseMessaging as Messaging | null;
  // Direct APNs provider for iOS device tokens (raw APNs tokens that firebase-admin
  // cannot send). Guarded entirely by isApnsConfigured: when APNs is NOT configured
  // this stays null and iOS tokens are skipped (NOT deleted as stale).
  // `apnsProvider` may be injected for tests; otherwise resolved lazily from config.
  const apnsConfigured = isApnsConfigured(config);
  function getApns() {
    if (!apnsConfigured) return null;
    if (apnsProvider !== undefined) return apnsProvider; // DI (tests); null disables
    return getApnsProvider(config, log);
  }

  // Badge count management for iOS
  async function getUnreadCount(userId: string) {
    if (!stores.notificationCounts) return 1;
    try {
      const counts = await stores.notificationCounts.getByUser(userId);
      return counts.reduce((sum, c) => sum + (c.unreadUpdates || 0), 0) || 1;
    } catch {
      return 1;
    }
  }

  async function incrementUnread(userId: string, festivalId: string, _type: string) {
    if (!stores.notificationCounts) return;
    try {
      await stores.notificationCounts.increment(userId, festivalId, 'updates');
    } catch (err) {
      log.debug('incrementUnread failed', { userId, error: (err as Failure).message });
    }
  }

  // Delivery tracking
  async function logNotification({
    userId,
    type,
    title,
    body,
    data,
    status,
    platform,
    errorMessage,
  }: {
    userId: string;
    type: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown> | null;
    status?: string;
    platform?: string | null;
    errorMessage?: string | null;
  }) {
    if (!stores.notificationLog) return null;
    try {
      const id = crypto.randomUUID();
      // The log is keyed by recipient, so an SOS position stored here would outlive the
      // crew and the raiser's account. The privacy policy promises it does not.
      const { lat: _lat, lng: _lng, ...loggedData }: Record<string, unknown> = data || {};
      await stores.notificationLog.insert({
        id,
        userId,
        type,
        title: String(title || '').slice(0, MAX_TITLE_LENGTH),
        body: String(body || '').slice(0, MAX_BODY_LENGTH),
        dataJson: data ? JSON.stringify(loggedData) : null,
        status: status || 'sent',
        platform: platform || null,
        errorMessage: errorMessage || null,
      });
      return id;
    } catch (err) {
      log.debug('notification log failed', { error: (err as Failure).message });
      return null;
    }
  }

  // Count-then-log runs under a per-user lock so concurrent sends cannot both pass the cap.
  // shortcut: in-process only (one PM2 fork serves production); a second process needs a shared counter.
  const budgetLocks = new Map<string, Promise<void>>();
  async function withBudgetLocks<T>(userIds: string[], fn: () => Promise<T>): Promise<T> {
    const releases: (() => void)[] = [];
    try {
      // Sorted, so two batches that share users cannot wait on each other.
      for (const userId of [...new Set(userIds)].sort()) {
        const prev = budgetLocks.get(userId) ?? Promise.resolve();
        let release!: () => void;
        const tail = prev.then(() => new Promise<void>((resolve) => (release = resolve)));
        budgetLocks.set(userId, tail);
        await prev;
        releases.push(() => {
          release();
          if (budgetLocks.get(userId) === tail) budgetLocks.delete(userId);
        });
      }
      return await fn();
    } finally {
      for (const release of releases) release();
    }
  }

  /** Counted pushes in the last hour per user. A missing or failing count is 0: better a push than a drop. */
  async function recentPushCounts(userIds: string[]): Promise<Map<string, number>> {
    if (!stores.notificationLog?.countRecentPushes) return new Map();
    try {
      return await stores.notificationLog.countRecentPushes(userIds, [...PUSH_BUDGET_EXEMPT]);
    } catch (err) {
      log.warn('push budget count failed', { error: (err as Failure).message });
      return new Map();
    }
  }

  // Batched reads for the fan-out paths. Each falls back to the per-user read when a store
  // (a test double) lacks the batched method, so both paths read the same data.
  /** Prefs per user. A failed read throws, as notificationPrefs.get does. */
  async function prefsByUser(userIds: string[]): Promise<Map<string, Prefs | null | undefined>> {
    if (stores.notificationPrefs.getMany) return stores.notificationPrefs.getMany(userIds);
    const byUser = new Map<string, Prefs | null | undefined>();
    for (const userId of userIds) byUser.set(userId, await stores.notificationPrefs.get(userId));
    return byUser;
  }

  /** Device tokens per user, every requested user present. A failed read throws, as listByUser does. */
  async function tokensByUser(userIds: string[]): Promise<Map<string, Device[]>> {
    const byUser = new Map<string, Device[]>(userIds.map((userId) => [userId, []]));
    if (!stores.deviceTokens.listByUsers) {
      for (const userId of userIds) byUser.set(userId, await stores.deviceTokens.listByUser(userId));
      return byUser;
    }
    for (const device of await stores.deviceTokens.listByUsers(userIds)) byUser.get(device.userId)?.push(device);
    return byUser;
  }

  /** Badge count per user: the unread total, or 1 when it is zero, missing or unreadable (as getUnreadCount). */
  async function badgeCounts(userIds: string[]): Promise<Map<string, number>> {
    const byUser = new Map<string, number>();
    if (!stores.notificationCounts?.unreadTotals) {
      for (const userId of userIds) byUser.set(userId, await getUnreadCount(userId));
      return byUser;
    }
    let totals = new Map<string, number>();
    try {
      totals = await stores.notificationCounts.unreadTotals(userIds);
    } catch (err) {
      log.debug('unread totals failed', { error: (err as Failure).message });
    }
    for (const userId of userIds) byUser.set(userId, totals.get(userId) || 1);
    return byUser;
  }

  /** One inbox row per user per notification; 'held' when quiet hours or the budget stopped the push. */
  function logInboxRow({
    userId,
    type,
    safeTitle,
    safeBody,
    safeData,
    held,
  }: { userId: string; type: string; held: string | null } & PushContent) {
    return logNotification({
      userId,
      type,
      title: safeTitle,
      body: safeBody,
      data: safeData,
      status: held ? 'held' : 'inbox',
      platform: 'inbox',
    });
  }

  /**
   * Build a complete FCM message object for a single device.
   * Shared by send() and sendToOfflineUsers() to avoid duplication.
   */
  function buildFcmMessage({
    token,
    title,
    body,
    data,
    type,
    badgeCount,
    threadId,
    channelId = 'updates',
    category = 'CREW_UPDATE',
  }: {
    token: string;
    title: string;
    body: string;
    data: PushData;
    type: string;
    badgeCount: number;
    threadId?: string | null;
    channelId?: string;
    category?: string;
  }): FcmMessage {
    return {
      token,
      notification: { title, body },
      data: { type, ...data },
      android: {
        priority: 'high',
        notification: {
          channelId,
          tag: threadId || `update-${data.festivalId || ''}`,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: badgeCount,
            'mutable-content': 1,
            'thread-id': threadId || 'updates',
            category,
          },
        },
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      },
    };
  }

  /**
   * Build the APNs `aps` payload for an alert. Mirrors buildFcmMessage's
   * apns.payload.aps EXACTLY (sound/badge/mutable-content/thread-id/category),
   * plus the visible `alert` block — FCM injects title/body from `notification`,
   * but direct APNs requires them in the aps body. Custom data is sent as
   * sibling keys alongside `aps` (the standard APNs convention).
   */
  function buildApnsAlertPayload({
    title,
    body,
    data,
    type,
    badgeCount,
    threadId,
    category = 'CREW_UPDATE',
  }: {
    title: string;
    body: string;
    data: PushData;
    type: string;
    badgeCount: number;
    threadId?: string | null;
    category?: string;
  }) {
    return {
      aps: {
        alert: { title, body },
        sound: 'default',
        badge: badgeCount,
        'mutable-content': 1,
        'thread-id': threadId || 'updates',
        category,
      },
      type,
      ...data,
    };
  }

  /**
   * Send an alert to a single iOS device via direct APNs. Returns the same
   * { sent, stale } shape as sendToDevice so callers stay symmetric. Logs the
   * notification and never throws.
   */
  async function sendToIosDevice({
    apns,
    device,
    payload,
    opts,
    userId,
    type,
    safeTitle,
    safeBody,
    safeData,
  }: {
    apns: ApnsProvider;
    device: Device;
    payload: object;
    opts: ApnsOpts;
    userId: string;
    type: string;
  } & PushContent) {
    try {
      const result = await apns.send(device.token, payload, opts);
      await logNotification({
        userId,
        type,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        status: result.sent ? 'sent' : 'failed',
        platform: device.platform,
        errorMessage: result.sent ? null : result.error,
      });
      if (!result.sent) log.debug('apns send failed', { userId, error: result.error });
      return { sent: result.sent, stale: result.stale };
    } catch (e) {
      const error = e as Failure;
      log.debug('apns send threw', { userId, error: error.message });
      await logNotification({
        userId,
        type,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        status: 'failed',
        platform: device.platform,
        errorMessage: error.message,
      });
      return { sent: false, stale: false };
    }
  }

  /**
   * Send to one browser via Web Push. Same { sent, stale } shape as the iOS and
   * FCM paths. The click URL is the push's deepLink only when it points at our
   * own origin, else the home page. Logs the notification and never throws.
   */
  async function sendToWebDevice({
    device,
    userId,
    type,
    threadId,
    safeTitle,
    safeBody,
    safeData,
    retryQueue: deviceRetryQueue,
  }: { device: Device; userId: string; type: string; threadId?: string | null; retryQueue: RetryQueue } & PushContent) {
    const origin = appOrigin(config);
    const deepLink = safeData.deepLink;
    const url = typeof deepLink === 'string' && deepLink.startsWith(origin + '/') ? deepLink : origin + '/';
    const urgent = URGENT_WEB_TYPES.has(type);
    const sendOnce = () =>
      // Callers route a device here only when webPush is configured.
      (webPush as WebPushSender).send(
        device.token,
        { title: safeTitle, body: safeBody, url, tag: threadId || type },
        { ttl: urgent ? 3600 : 86400, urgency: urgent ? 'high' : 'normal' },
      );
    let result: WebPushResult;
    try {
      result = await sendOnce();
    } catch (error) {
      result = { sent: false, stale: false, error: (error as Failure).message };
    }
    if (!result.sent) log.debug('web push send failed', { userId, error: result.error });
    // Network errors, timeouts, 429 and 5xx are transient, as for FCM. The sender marks them retryable.
    if (!result.sent && !result.stale && result.retryable) {
      deviceRetryQueue.enqueue({
        userId,
        sendFn: async () => {
          const retried = await sendOnce();
          if (retried.sent) return;
          // The queue drops an entry whose error code says the subscription is gone.
          throw Object.assign(new Error(retried.error || 'web push failed'), { code: retried.stale ? 'not-registered' : '' });
        },
      });
    }
    await logNotification({
      userId,
      type,
      title: safeTitle,
      body: safeBody,
      data: safeData,
      status: result.sent ? 'sent' : 'failed',
      platform: 'web',
      errorMessage: result.sent ? null : result.error || (result.stale ? 'stale subscription' : null),
    });
    return { sent: !!result.sent, stale: !!result.stale };
  }

  /**
   * Handle sending to a single device — retry logic, stale token detection, logging.
   * Returns { sent: boolean, stale: boolean }.
   */
  async function sendToDevice({
    device,
    fcmMessage,
    userId,
    type,
    safeTitle,
    safeBody,
    safeData,
    retryQueue: deviceRetryQueue,
  }: {
    device: Device;
    fcmMessage: FcmMessage;
    userId: string;
    type: string;
    retryQueue: RetryQueue;
  } & PushContent) {
    // Callers route a device here only when FCM is configured.
    const fcm = messaging as Messaging;
    const sendStartTime = Date.now();
    try {
      await Promise.race([
        withRetry(() => fcm.send(fcmMessage), {
          maxAttempts: 2,
          baseDelay: 300,
          maxDelay: 2000,
          isRetryable: (err: Failure) => {
            const code = err.code || '';
            return err.message === 'FCM_TIMEOUT' || code.includes('unavailable') || code.includes('internal');
          },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('FCM_TIMEOUT')), 8000)),
      ]);
      await logNotification({
        userId,
        type,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        status: 'sent',
        platform: device.platform,
      });
      return { sent: true, stale: false };
    } catch (e) {
      const error = e as Failure;
      const code = error.code || '';
      const isTimeout = error.message === 'FCM_TIMEOUT' || Date.now() - sendStartTime > 5000;
      const stale = isStaleTokenError(code);

      // Enqueue transient failures for retry (timeouts, 5xx, unavailable)
      const isTransient = isTimeout || code.includes('unavailable') || code.includes('internal');
      if (isTransient && !code.includes('not-registered') && !code.includes('invalid-registration')) {
        const fcmMsg = {
          token: device.token,
          notification: { title: safeTitle, body: safeBody },
          data: { type, ...safeData },
        };
        deviceRetryQueue.enqueue({ userId, sendFn: () => fcm.send(fcmMsg) });
        // Never forward notification content to this external, operator-configured
        // webhook — title/body/data may carry GPS coords or a username (e.g.
        // crew_sos embeds the raiser's name in the title and lat/lng in data).
        // The in-process deviceRetryQueue above already re-sends the real payload;
        // this call only needs to tell the external system WHICH notification
        // type needs attention.
        postToWebhookRetry(device.token, { type }, 0);
      }

      log.debug('push send failed', { userId, platform: device.platform, error: error.message });
      await logNotification({
        userId,
        type,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        status: 'failed',
        platform: device.platform,
        errorMessage: error.message,
      });
      return { sent: false, stale };
    }
  }

  /** Route one user's device tokens to APNs, Web Push or FCM. Returns counts plus the tokens to unregister. */
  async function deliverToDevices({
    tokens,
    userId,
    type,
    threadId,
    channelId,
    category,
    badgeCount,
    safeTitle,
    safeBody,
    safeData,
  }: {
    tokens: Device[];
    userId: string;
    type: string;
    threadId?: string | null;
    channelId: string;
    category?: string;
    badgeCount: number;
  } & PushContent) {
    const apns = getApns();
    let sent = 0;
    let localCovered = 0;
    const staleTokens: string[] = [];

    for (const device of tokens) {
      if (!isValidDeviceToken(device)) {
        staleTokens.push(device.token);
        continue;
      }

      // The phone schedules this festival's set reminders on-device; a push would double them.
      // A reported cutoff limits the skip to reminders firing at or before it (the phone's 64-slot window); no cutoff skips the whole festival.
      const coversUntil = device.localRemindersCoversUntil == null ? null : Number(device.localRemindersCoversUntil);
      const fireAtMs = Number(safeData.fireAtMs);
      if (
        type === 'set_reminder' &&
        device.localRemindersFestivalId &&
        device.localRemindersFestivalId === safeData.festivalId &&
        (coversUntil === null || !Number.isFinite(fireAtMs) || fireAtMs <= coversUntil)
      ) {
        localCovered += 1;
        continue;
      }

      // iOS device tokens are RAW APNs tokens that firebase-admin cannot send.
      if (device.platform === 'ios') {
        if (!apns) {
          // APNs not configured: skip (counted as not-sent), do NOT unregister.
          log.debug('apns not configured — skipping ios token', { userId });
          continue;
        }
        const payload = buildApnsAlertPayload({
          title: safeTitle,
          body: safeBody,
          data: safeData,
          type,
          badgeCount,
          threadId,
          category,
        });
        const result = await sendToIosDevice({
          apns,
          device,
          payload,
          opts: { pushType: 'alert', priority: '10', collapseId: threadId },
          userId,
          type,
          safeTitle,
          safeBody,
          safeData,
        });
        if (result.sent) sent += 1;
        if (result.stale) staleTokens.push(device.token);
        continue;
      }

      // Browser PushSubscription → Web Push. FCM cannot deliver to it.
      if (device.platform === 'web') {
        if (!webPush) {
          // Web push not configured: skip, do NOT unregister — mirrors the iOS skip.
          log.debug('web push not configured — skipping web token', { userId });
          continue;
        }
        const result = await sendToWebDevice({ device, userId, type, threadId, safeTitle, safeBody, safeData, retryQueue });
        if (result.sent) sent += 1;
        if (result.stale) staleTokens.push(device.token);
        continue;
      }

      // Android (or unknown) → FCM path. Not configured: skip (counted as
      // not-sent), do NOT unregister — mirrors the iOS/APNs skip above.
      if (!messaging) {
        log.debug('fcm not configured — skipping non-ios token', { userId });
        continue;
      }
      const fcmMessage = buildFcmMessage({
        token: device.token,
        title: safeTitle,
        body: safeBody,
        data: safeData,
        type,
        badgeCount,
        threadId,
        channelId,
        category,
      });
      enforcePayloadSize(fcmMessage, log);

      const result = await sendToDevice({
        device,
        fcmMessage,
        userId,
        type,
        safeTitle,
        safeBody,
        safeData,
        retryQueue,
      });
      if (result.sent) sent += 1;
      if (result.stale) staleTokens.push(device.token);
    }
    return { sent, localCovered, staleTokens };
  }

  /** Decide whether quiet hours or the hourly budget hold this push, and log the inbox row. Returns the hold reason or null. */
  async function holdOrLogInbox({
    userId,
    type,
    isCritical,
    prefs,
    safeTitle,
    safeBody,
    safeData,
  }: { userId: string; type: string; isCritical: boolean; prefs?: Prefs | null } & PushContent) {
    const budgetCounted = !isCritical && !PUSH_BUDGET_EXEMPT.has(type);
    return withBudgetLocks(budgetCounted ? [userId] : [], async () => {
      let heldReason: string | null = null;
      if (!isCritical && !DND_EXEMPT_TYPES.has(type) && isInDndWindow(prefs)) heldReason = 'dnd_active';
      else if (budgetCounted) {
        const count = (await recentPushCounts([userId])).get(userId) ?? 0;
        if (count >= PUSH_BUDGET_PER_HOUR) heldReason = 'budget';
      }
      // One inbox row per user per notification, before quiet hours, the budget and the device check, so a held or undeliverable push still shows in the in-app inbox.
      // status 'held' means quiet hours or the hourly budget stopped the push; the push budget counts only 'inbox' rows.
      await logInboxRow({ userId, type, safeTitle, safeBody, safeData, held: heldReason });
      return heldReason;
    });
  }

  async function send({
    userId,
    type,
    title,
    body,
    data = {},
    threadId = null,
  }: {
    userId: string;
    type: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    threadId?: string | null;
  }) {
    if (!ALLOWED_NOTIFICATION_TYPES.has(type)) {
      log.warn('invalid notification type rejected', { type, userId });
      return { sent: 0, reason: 'invalid_type' };
    }

    const { safeTitle, safeBody, safeData } = enforcePayloadLimits(title, body, data);
    const isCritical = CRITICAL_TYPES.has(type);
    // DC7: critical types override channel; non-critical types may have a per-type
    // channel (e.g. crew_* → 'crew'); everything else falls back to 'updates'.
    const { channelId: criticalChannelId, category = 'CREW_UPDATE' } = CRITICAL_CHANNEL[type] || {};
    const channelId = criticalChannelId ?? TYPE_CHANNEL_MAP[type] ?? 'updates';
    const prefs = await stores.notificationPrefs.get(userId);
    const prefKey = PREF_MAP[type];
    // Safety-critical types (crew_sos) bypass the per-type opt-out and the DND
    // window — an emergency must reach people. prefKey is undefined for these
    // (omitted from PREF_MAP), but guard explicitly so intent is unmistakable.
    if (!isCritical && prefs && prefKey && !prefs[prefKey]) return { sent: 0, reason: 'user_disabled' };
    const held = await holdOrLogInbox({ userId, type, isCritical, prefs, safeTitle, safeBody, safeData });
    if (held) return { sent: 0, reason: held };

    // Bail only when NO transport exists, after the inbox row is written. FCM-less +
    // APNs-configured is a valid deploy: the per-device branch below routes iOS to APNs.
    if (!messaging && !getApns() && !webPush) return { sent: 0, reason: 'firebase_not_configured' };

    const tokens = await stores.deviceTokens.listByUser(userId);
    if (tokens.length === 0) return { sent: 0, reason: 'no_tokens' };

    const badgeCount = await getUnreadCount(userId);
    const { sent, localCovered, staleTokens } = await deliverToDevices({
      tokens,
      userId,
      type,
      threadId,
      channelId,
      category,
      badgeCount,
      safeTitle,
      safeBody,
      safeData,
    });

    if (sent > 0 && safeData.festivalId) {
      await incrementUnread(userId, safeData.festivalId, type);
    }

    // Clean up stale tokens (filter out null/undefined tokens that can't match DB rows)
    for (const staleToken of staleTokens) {
      if (staleToken) await stores.deviceTokens.unregister(staleToken, userId);
    }

    return { sent, localCovered, staleRemoved: staleTokens.length };
  }

  const MAX_PUSH_BATCH = 200;
  const FCM_BATCH_SIZE = 500;
  const INBOX_INSERT_CONCURRENCY = 20;

  async function sendBatch(messages: FcmMessage[]) {
    if (!messaging || messages.length === 0) return { successCount: 0, failureCount: 0, staleTokens: [] };
    const staleTokens: string[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < messages.length; i += FCM_BATCH_SIZE) {
      const batch = messages.slice(i, i + FCM_BATCH_SIZE);

      for (const msg of batch) {
        enforcePayloadSize(msg, log, 'batch');
      }

      try {
        const response = await messaging.sendEach(batch);
        response.responses.forEach((resp, idx) => {
          if (resp.success) {
            successCount++;
          } else {
            failureCount++;
            if (isStaleTokenError(resp.error?.code || '')) {
              staleTokens.push((batch[idx] as FcmMessage).token);
            }
          }
        });
      } catch (err) {
        log.warn('sendBatch: batch send failed', { batchSize: batch.length, error: (err as Failure).message });
        failureCount += batch.length;
      }
    }
    // Provider-outage signal: if errors dominate the batch (high failure ratio,
    // at least one send attempted) this is likely a FCM-side outage, not benign
    // per-user opt-outs (those are filtered before buildFcmMessage ever runs).
    const totalAttempted = successCount + failureCount;
    if (totalAttempted > 0 && failureCount / totalAttempted > OUTAGE_ERROR_RATIO) {
      log.warn('push-provider outage suspected: high FCM error ratio', {
        successCount,
        failureCount,
        total: totalAttempted,
        ratio: (failureCount / totalAttempted).toFixed(2),
      });
      try {
        promMetrics?.pushProviderOutageCounter?.inc({ provider: 'fcm' });
      } catch {
        /* ignore metric errors */
      }
    }

    return { successCount, failureCount, staleTokens };
  }
  /** Count-then-log for one batch under the budget locks: skips opted-out users, marks held users, writes the inbox rows. */
  async function logBatchInbox({
    batch,
    type,
    prefKey,
    safeTitle,
    safeBody,
    safeData,
  }: { batch: string[]; type: string; prefKey?: string } & PushContent) {
    return withBudgetLocks(PUSH_BUDGET_EXEMPT.has(type) ? [] : batch, async () => {
      const [prefsMap, pushCounts] = await Promise.all([
        prefsByUser(batch),
        PUSH_BUDGET_EXEMPT.has(type) ? new Map<string, number>() : recentPushCounts(batch),
      ]);

      const counted: { userId: string; held: string | null }[] = [];
      for (const userId of batch) {
        const prefs = prefsMap.get(userId);
        if (prefs && prefKey && !prefs[prefKey]) continue;
        const held = isInDndWindow(prefs)
          ? 'dnd_active'
          : (pushCounts.get(userId) ?? 0) >= PUSH_BUDGET_PER_HOUR
            ? 'budget'
            : null;
        counted.push({ userId, held });
      }

      // One inbox row per user per notification, before quiet hours, the budget and the device check, so a held or undeliverable push still shows in the in-app inbox.
      // The inserts run INBOX_INSERT_CONCURRENCY at a time in batch order, all before the device step.
      for (let i = 0; i < counted.length; i += INBOX_INSERT_CONCURRENCY) {
        await Promise.all(
          counted
            .slice(i, i + INBOX_INSERT_CONCURRENCY)
            .map(({ userId, held }) => logInboxRow({ userId, type, safeTitle, safeBody, safeData, held })),
        );
      }
      return counted;
    });
  }

  /** Sort the batch recipients' devices into FCM messages, per-device APNs sends and per-device Web Push sends. */
  function routeBatchDevices({
    recipients,
    tokensMap,
    badgeMap,
    type,
    threadId,
    channelId,
    safeTitle,
    safeBody,
    safeData,
  }: {
    recipients: { userId: string; held: string | null }[];
    tokensMap: Map<string, Device[]>;
    badgeMap: Map<string, number>;
    type: string;
    threadId?: string | null;
    channelId: string;
  } & PushContent) {
    const apns = getApns();
    const fcmMessages: FcmMessage[] = [];
    const tokenUserMap = new Map<string, string>();
    // iOS device tokens routed to per-device APNs (APNs has no multicast).
    const iosSends: { userId: string; device: Device; payload: object }[] = [];
    // Browser subscriptions routed to per-device Web Push (no multicast either).
    const webSends: { userId: string; device: Device }[] = [];

    for (const { userId, held } of recipients) {
      if (held) continue;

      const tokens = tokensMap.get(userId) ?? [];
      const badgeCount = badgeMap.get(userId) ?? 1;

      for (const device of tokens) {
        if (!isValidDeviceToken(device)) continue;

        if (device.platform === 'ios') {
          // APNs not configured → skip iOS token (do NOT unregister).
          if (!apns) continue;
          tokenUserMap.set(device.token, userId);
          iosSends.push({
            userId,
            device,
            payload: buildApnsAlertPayload({
              title: safeTitle,
              body: safeBody,
              data: safeData,
              type,
              badgeCount,
              threadId,
            }),
          });
          continue;
        }

        if (device.platform === 'web') {
          // Web push not configured → skip web token (do NOT unregister).
          if (!webPush) continue;
          tokenUserMap.set(device.token, userId);
          webSends.push({ userId, device });
          continue;
        }

        // Android → FCM batch. Not configured → skip. sendBatch would
        // no-op anyway, but skipping keeps the token out of tokenUserMap so we
        // don't incrementUnread for a push that was never delivered.
        if (!messaging) continue;
        tokenUserMap.set(device.token, userId);
        const msg = buildFcmMessage({
          token: device.token,
          title: safeTitle,
          body: safeBody,
          data: safeData,
          type,
          badgeCount,
          threadId,
          channelId,
        });
        enforcePayloadSize(msg, log, 'sendToOfflineUsers');
        fcmMessages.push(msg);
      }
    }
    return { fcmMessages, tokenUserMap, iosSends, webSends };
  }

  /** APNs provider-outage signal: same ratio check as FCM sendBatch. */
  function reportApnsOutage(apnsAttempted: number, apnsSent: number) {
    const apnsFailed = apnsAttempted - apnsSent;
    if (apnsAttempted > 0 && apnsFailed / apnsAttempted > OUTAGE_ERROR_RATIO) {
      log.warn('push-provider outage suspected: high APNs error ratio', {
        sent: apnsSent,
        failed: apnsFailed,
        total: apnsAttempted,
        ratio: (apnsFailed / apnsAttempted).toFixed(2),
      });
      try {
        promMetrics?.pushProviderOutageCounter?.inc({ provider: 'apns' });
      } catch {
        /* ignore metric errors */
      }
    }
  }

  /** Unregister dead tokens after the response path, so the request does not wait on it. */
  function unregisterStaleTokensLater(allStaleTokens: string[], tokenUserMap: Map<string, string>) {
    const staleTokensCopy = [...allStaleTokens];
    const tokenUserMapCopy = new Map(tokenUserMap);
    setImmediate(async () => {
      for (const t of staleTokensCopy) {
        try {
          const uid = tokenUserMapCopy.get(t);
          if (uid && t) await stores.deviceTokens.unregister(t, uid);
        } catch (err) {
          log.warn('stale token cleanup failed', { error: (err as Failure).message });
        }
      }
    });
  }

  async function sendToOfflineUsers({
    festivalId,
    type,
    title,
    body,
    data = {},
    excludeUserIds = [],
    userIds = null,
    topic = null,
    threadId = null,
  }: {
    festivalId: string;
    type: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    excludeUserIds?: string[];
    userIds?: string[] | null;
    topic?: string | null;
    threadId?: string | null;
  }) {
    if (!ALLOWED_NOTIFICATION_TYPES.has(type)) return { sent: 0, reason: 'invalid_type' };

    // An explicit recipient list (e.g. one crew) replaces the festival-wide audience.
    // The topic filter, preferences, quiet hours and MAX_PUSH_BATCH still apply below.
    const targetUserIds = Array.isArray(userIds)
      ? userIds.filter((uid) => uid && !(excludeUserIds || []).includes(uid))
      : await resolveFestivalTargets(stores, festivalId, excludeUserIds);

    // Filter out topic-unsubscribed users
    const VALID_TOPICS = new Set(['crew', 'schedule']);
    let topicUnsubscribed = new Set<string>();
    if (topic && VALID_TOPICS.has(topic) && stores.topicSubscriptions?.getUnsubscribedUsers) {
      topicUnsubscribed = await stores.topicSubscriptions.getUnsubscribedUsers(festivalId, topic);
    }
    const filteredIds = targetUserIds.filter((uid) => !topicUnsubscribed.has(uid));
    if (filteredIds.length === 0) return { sent: 0 };

    const batch = filteredIds.slice(0, MAX_PUSH_BATCH);
    if (filteredIds.length > MAX_PUSH_BATCH) {
      log.warn('sendToOfflineUsers: batch capped', { festivalId, total: filteredIds.length, capped: MAX_PUSH_BATCH });
    }

    const { safeTitle, safeBody, safeData } = enforcePayloadLimits(title, body, data);
    const prefKey = PREF_MAP[type];
    const channelId = TYPE_CHANNEL_MAP[type] ?? 'updates';
    const apns = getApns();

    // No push provider: still write the inbox rows, then stop before the device step.
    if (!messaging && !getApns() && !webPush) {
      await logBatchInbox({ batch, type, prefKey, safeTitle, safeBody, safeData });
      return { sent: 0 };
    }

    // Count-then-log runs under the users' budget locks so a concurrent send cannot pass the cap between them.
    const [recipients, tokensMap, badgeMap] = await Promise.all([
      logBatchInbox({ batch, type, prefKey, safeTitle, safeBody, safeData }),
      tokensByUser(batch),
      badgeCounts(batch),
    ]);

    const { fcmMessages, tokenUserMap, iosSends, webSends } = routeBatchDevices({
      recipients,
      tokensMap,
      badgeMap,
      type,
      threadId,
      channelId,
      safeTitle,
      safeBody,
      safeData,
    });

    if (fcmMessages.length === 0 && iosSends.length === 0 && webSends.length === 0) return { sent: 0 };

    const result =
      fcmMessages.length > 0
        ? await sendBatch(fcmMessages)
        : { successCount: 0, failureCount: 0, staleTokens: [] as string[] };

    // Per-device APNs sends for iOS (no multicast).
    const apnsStaleTokens: string[] = [];
    let apnsSent = 0;
    for (const { userId, device, payload } of iosSends) {
      const r = await sendToIosDevice({
        // iosSends is only filled when APNs is configured.
        apns: apns as ApnsProvider,
        device,
        payload,
        opts: { pushType: 'alert', priority: '10', collapseId: threadId },
        userId,
        type,
        safeTitle,
        safeBody,
        safeData,
      });
      if (r.sent) apnsSent += 1;
      if (r.stale) apnsStaleTokens.push(device.token);
    }

    // Per-device Web Push sends.
    const webStaleTokens: string[] = [];
    const webNotified = new Set<string>();
    let webSent = 0;
    for (const { userId, device } of webSends) {
      const r = await sendToWebDevice({ device, userId, type, threadId, safeTitle, safeBody, safeData, retryQueue });
      if (r.sent) {
        webSent += 1;
        webNotified.add(userId);
      }
      if (r.stale) webStaleTokens.push(device.token);
    }

    reportApnsOutage(iosSends.length, apnsSent);

    // Track unread counts for users who received notifications
    const notifiedUsers = new Set<string>();
    for (const msg of fcmMessages) {
      const uid = tokenUserMap.get(msg.token);
      if (uid) notifiedUsers.add(uid);
    }
    for (const { userId } of iosSends) {
      notifiedUsers.add(userId);
    }
    for (const uid of webNotified) notifiedUsers.add(uid);
    for (const uid of notifiedUsers) {
      if (safeData.festivalId) await incrementUnread(uid, safeData.festivalId, type);
    }

    // Clean up stale tokens (deferred to avoid blocking the request path)
    const allStaleTokens = [...result.staleTokens, ...apnsStaleTokens, ...webStaleTokens];
    if (allStaleTokens.length > 0) unregisterStaleTokensLater(allStaleTokens, tokenUserMap);

    log.info('sendToOfflineUsers: batch complete', {
      festivalId,
      type,
      messages: fcmMessages.length + iosSends.length + webSends.length,
      sent: result.successCount + apnsSent + webSent,
      failed: result.failureCount + (iosSends.length - apnsSent) + (webSends.length - webSent),
      stale: allStaleTokens.length,
    });

    return { sent: result.successCount + apnsSent + webSent };
  }

  // #30: Silent push for background data sync — data-only, no visible notification
  async function sendSilentSync({
    festivalId,
    syncType,
    excludeUserIds = [],
  }: {
    festivalId: string;
    syncType: string;
    excludeUserIds?: string[];
  }) {
    if (!messaging && !getApns()) return { sent: 0 };

    const allTargetIds = await resolveFestivalTargets(stores, festivalId, excludeUserIds);
    const targetUserIds = allTargetIds.slice(0, MAX_PUSH_BATCH);
    if (targetUserIds.length === 0) return { sent: 0 };
    if (allTargetIds.length > MAX_PUSH_BATCH) {
      log.warn('sendSilentSync: batch capped', {
        festivalId,
        syncType,
        total: allTargetIds.length,
        capped: MAX_PUSH_BATCH,
      });
    }

    const apns = getApns();
    let totalSent = 0;
    const tokensMap = await tokensByUser(targetUserIds);
    for (const [userId, tokens] of tokensMap) {
      for (const device of tokens) {
        if (!isValidDeviceToken(device)) continue;

        // iOS device tokens → direct APNs background push (content-available:1).
        if (device.platform === 'ios') {
          if (!apns) continue; // not configured → skip, do NOT unregister
          try {
            const result = await apns.send(
              device.token,
              {
                aps: { 'content-available': 1 },
                type: 'silent_sync',
                syncType,
                festivalId,
                timestamp: new Date().toISOString(),
              },
              { pushType: 'background', priority: '5' },
            );
            if (result.sent) totalSent += 1;
            if (result.stale) await stores.deviceTokens.unregister(device.token, userId);
          } catch (error) {
            log.debug('sendSilentSync: apns error', { userId, error: (error as Failure).message });
          }
          continue;
        }

        // A silent data push has no meaning for a browser.
        if (device.platform === 'web') continue;

        // Android → FCM path; skip when FCM is not configured.
        if (!messaging) continue;
        try {
          await messaging.send({
            token: device.token,
            data: { type: 'silent_sync', syncType, festivalId, timestamp: new Date().toISOString() },
            android: { priority: 'high' },
            apns: {
              payload: { aps: { 'content-available': 1 } },
              headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
            },
          });
          totalSent += 1;
        } catch (e) {
          const error = e as Failure;
          const code = error.code || '';
          if (code.includes('not-registered') || code.includes('invalid-registration')) {
            await stores.deviceTokens.unregister(device.token, userId);
          }
          log.debug('sendSilentSync: device error', { userId, platform: device.platform, error: error.message });
        }
      }
    }
    return { sent: totalSent };
  }

  // Mark notifications as read (badge reset)
  async function markRead(userId: string, festivalId: string) {
    if (!stores.notificationCounts) return;
    try {
      await stores.notificationCounts.reset(userId, festivalId);
    } catch (err) {
      log.debug('markRead failed', { userId, error: (err as Failure).message });
    }
  }

  return { send, sendToOfflineUsers, sendSilentSync, markRead };
}
