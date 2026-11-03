// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'crypto';
import https from 'https';
import { loadConfig } from '../config';

const config = loadConfig();

// External webhook for persistent FCM retry queue
export const FCM_RETRY_WEBHOOK_URL = config.FCM_RETRY_WEBHOOK_URL;

// HMAC key for hashing device tokens before transmitting to external webhook
export const WEBHOOK_TOKEN_HMAC_KEY = config.WEBHOOK_TOKEN_HMAC_KEY;

// M3 re-engagement triggers (after-festival growth loops): lineup_drop / crew_reformed / wrap_ready.
// All event-gated (never cron-spam), per-type opt-out, DND-respecting, deduped once-per-event-per-user.
export const ALLOWED_NOTIFICATION_TYPES = new Set([
  'crew_update',
  'schedule_change',
  'set_reminder',
  'lineup_drop',
  'crew_reformed',
  'wrap_ready',
  // Morning-after nudge to rate yesterday's picked sets (reengagement.ts sendRatePrompt).
  'rate_prompt',
  // T42: a festival's first set times are out. Shares the lineupDrops opt-out.
  'set_times_out',
  // Finer crew types. Each has its own opt-out (PREF_MAP) and routes to the Android 'crew' channel.
  'crew_meeting_point',
  'crew_poll',
  'crew_money',
  'crew_ride',
  // T52 "Looking for you" nudge (routes/crew-nudge.ts). Opt-out via PREF_MAP; skips quiet hours (send.ts).
  'crew_nudge',
  // Safety-critical crew SOS. Deliberately NOT added to PREF_MAP (send.ts) — an
  // emergency has no per-type opt-out and bypasses DND (see CRITICAL_TYPES).
  'crew_sos',
  // Admin announcement to everyone who joined a festival (lib/announcements.ts). Opt-out via scheduleChanges.
  'festival_announcement',
]);
export const MAX_TITLE_LENGTH = 100;
export const MAX_BODY_LENGTH = 200;
export const MAX_DATA_KEYS = 10;

// Hash device token with HMAC-SHA256 before transmitting to webhook
export function hashDeviceToken(token: any) {
  return crypto.createHmac('sha256', WEBHOOK_TOKEN_HMAC_KEY).update(String(token)).digest('hex');
}

// Fire-and-forget POST to FCM retry webhook
export function postToWebhookRetry(token: any, payload: any, attempt: any) {
  if (!FCM_RETRY_WEBHOOK_URL) return;
  try {
    const url = new URL(FCM_RETRY_WEBHOOK_URL);
    const body = JSON.stringify({ tokenHash: hashDeviceToken(token), payload, attempt: attempt || 0 });
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: config.WEBHOOK_RETRY_TIMEOUT_MS,
      },
      () => {},
    );
    req.on('error', () => {}); // fire-and-forget
    req.end(body);
  } catch {
    /* ignore webhook errors */
  }
}

/**
 * Clamp notification payload fields to their maximum allowed lengths.
 */
export function enforcePayloadLimits(title: any, body: any, data: any) {
  const safeTitle = String(title || '').slice(0, MAX_TITLE_LENGTH);
  const safeBody = String(body || '').slice(0, MAX_BODY_LENGTH);
  const safeData: Record<string, string> = {};
  let keyCount = 0;
  for (const [k, v] of Object.entries(data || {})) {
    if (keyCount >= MAX_DATA_KEYS) break;
    safeData[String(k).slice(0, 50)] = String(v).slice(0, 200);
    keyCount++;
  }
  return { safeTitle, safeBody, safeData };
}
