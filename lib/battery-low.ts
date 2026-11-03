// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { MAX_SHARE_WINDOW_MS } from './live-location-cache.js';
import { logCrewActivity } from './db/stores/activity.js';

/**
 * The one-time "low battery" crew feed line for a live-location sharer.
 *
 * The relays (socket location:share / location:update, HTTP live-location)
 * call this after each fix. Battery only reaches the server when the sharer
 * turned "Show my battery level" on. The row holds a percentage and never a
 * position; its time is the row's created_at.
 *
 * A Redis SET NX key lives for the rest of the share window, so the line posts
 * at most once per window. A stop and restart inside that window posts nothing
 * more, on purpose. Without Redis there is no once-only guard, so nothing posts.
 */

/** The one-time crew line. The peer chip turns to "regroup" at LOW_BATTERY_THRESHOLD (20) in shared. */
export const BATTERY_LOW_PCT = 10;
const MIN_TTL_MS = 60_000;

export async function noteBatteryLevel(
  deps: { redis: any; stores: any; emitter: any; log?: any },
  fix: { crewId: string; userId: string; battery?: number; expiresAt?: string },
  now: number = Date.now(),
): Promise<boolean> {
  // Compare the shown percentage, so 10.4 posts "10%" and 10.6 (shown as 11%) posts nothing.
  const pct = typeof fix.battery === 'number' && Number.isFinite(fix.battery) ? Math.round(fix.battery) : NaN;
  if (!(pct <= BATTERY_LOW_PCT) || !deps.redis) return false;
  try {
    const exp = fix.expiresAt ? Date.parse(fix.expiresAt) : NaN;
    const ttl = Number.isFinite(exp)
      ? Math.min(MAX_SHARE_WINDOW_MS, Math.max(MIN_TTL_MS, exp - now))
      : MAX_SHARE_WINDOW_MS;
    const ok = await deps.redis.set(`loc:battlow:${fix.crewId}:${fix.userId}`, '1', 'PX', ttl, 'NX');
    if (ok !== 'OK') return false;
    await logCrewActivity(
      { stores: deps.stores, emitter: deps.emitter, log: deps.log },
      { crewId: fix.crewId, userId: fix.userId, type: 'battery-low', detail: `${pct}%` },
    );
    return true;
  } catch (err: any) {
    deps.log?.warn?.('battery-low check failed', { error: err?.message, crewId: fix.crewId });
    return false;
  }
}
