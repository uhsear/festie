// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Check-in timers: "If I don't tap I'm OK by then, tell my crew."
 *
 * The timer runs on the server because the phone may be dead or out of reach,
 * which is the point. State lives in Redis only (no migration):
 *   checkin:<crewId>:<userId>  string, JSON timer, PX = minutes + 1h
 *   checkin:due                sorted set, member `<crewId>|<userId>`, score = dueAt ms
 *   checkin:warn               sorted set, same member, score = dueAt - 5 min
 * Keys are unprefixed; the ioredis client applies REDIS_PREFIX.
 *
 * Privacy: the timer holds one coarse position (4 decimals, ~11m), the same
 * exception an SOS makes, until the timer ends plus one hour.
 */

import { readLivePosition } from './live-location-cache.js';
import { appLink } from './notifications/links.js';
import { coarse } from './sos-raise.js';

const WARN_BEFORE_MS = 5 * 60_000;
const KEY_GRACE_MS = 60 * 60_000;
const DUE_KEY = 'checkin:due';
const WARN_KEY = 'checkin:warn';
const BATCH = 50;

const timerKey = (crewId: string, userId: string) => `checkin:${crewId}:${userId}`;
const memberOf = (crewId: string, userId: string) => `${crewId}|${userId}`;

export interface CheckinPosition {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt: string;
}

interface StoredCheckin {
  crewId: string;
  userId: string;
  username: string;
  minutes: number;
  dueAt: number;
  position?: CheckinPosition;
}

async function readTimer(redis: any, crewId: string, userId: string): Promise<StoredCheckin | null> {
  const raw = await redis.get(timerKey(crewId, userId));
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

/** Start (or restart) a timer. Returns `{ dueAt }` (ms), or `null` when Redis is missing or fails. */
export async function startCheckin(
  redis: any,
  {
    crewId,
    userId,
    username,
    minutes,
    position,
    now = Date.now(),
  }: {
    crewId: string;
    userId: string;
    username: string;
    minutes: number;
    position?: CheckinPosition;
    now?: number;
  },
): Promise<{ dueAt: number } | null> {
  if (!redis) return null;
  const dueAt = now + minutes * 60_000;
  const timer: StoredCheckin = { crewId, userId, username, minutes, dueAt, ...(position ? { position } : {}) };
  const member = memberOf(crewId, userId);
  try {
    const results = await redis
      .multi()
      .set(timerKey(crewId, userId), JSON.stringify(timer), 'PX', minutes * 60_000 + KEY_GRACE_MS)
      .zadd(DUE_KEY, dueAt, member)
      .zadd(WARN_KEY, dueAt - WARN_BEFORE_MS, member)
      .exec();
    // ioredis reports per-command failures inside the results, not by throwing.
    if (!results || results.some(([err]: [unknown]) => err)) return null;
    return { dueAt };
  } catch {
    return null;
  }
}

/** Cancel a timer ("I'm OK"). Returns `true` when a timer existed. */
export async function clearCheckin(redis: any, crewId: string, userId: string): Promise<boolean> {
  if (!redis) return false;
  const member = memberOf(crewId, userId);
  const removed = await redis.del(timerKey(crewId, userId));
  await redis.zrem(DUE_KEY, member);
  await redis.zrem(WARN_KEY, member);
  return removed > 0;
}

/** The caller's active timer as `{ dueAt (ms), minutes }`, or `null`. */
export async function getCheckin(
  redis: any,
  crewId: string,
  userId: string,
): Promise<{ dueAt: number; minutes: number } | null> {
  if (!redis) return null;
  const timer = await readTimer(redis, crewId, userId);
  return timer ? { dueAt: timer.dueAt, minutes: timer.minutes } : null;
}

function splitMember(member: string): [string, string] | null {
  const i = member.indexOf('|');
  return i > 0 ? [member.slice(0, i), member.slice(i + 1)] : null;
}

export function createCheckinScheduler({
  redis,
  stores,
  raiser,
  notificationService,
  log,
  config,
  intervalMs = 15_000,
}: any) {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function warn(member: string, now: number) {
    const ids = splitMember(member);
    if (!ids) return;
    const stored = await readTimer(redis, ids[0], ids[1]);
    if (!stored || !notificationService?.send) return;
    if (stored.dueAt - WARN_BEFORE_MS > now) {
      // Restarted between our ZRANGEBYSCORE and ZREM: put the new warning back.
      await redis.zadd(WARN_KEY, stored.dueAt - WARN_BEFORE_MS, member);
      return;
    }
    await notificationService.send({
      userId: stored.userId,
      // The safety type: bypasses quiet hours and the per-type opt-out.
      type: 'crew_sos',
      title: 'Check in with your crew',
      body: "Your check-in timer ends in 5 min. Open Festie and tap I'm OK.",
      data: { crewId: stored.crewId, deepLink: appLink(config, '/crew?tab=find') },
      threadId: `checkin-${stored.crewId}`,
    });
  }

  async function raiseMissed(stored: StoredCheckin, now: number) {
    const { crewId, userId } = stored;
    const live = await readLivePosition(redis, crewId, userId, now);
    const fix = live ?? stored.position;
    const position = fix
      ? { lat: coarse(fix.lat), lng: coarse(fix.lng), accuracy: fix.accuracy, capturedAt: fix.capturedAt }
      : undefined;
    await raiser.raise({
      crewId,
      userId,
      username: stored.username || 'A crew member',
      message: 'Missed a check-in timer.',
      position,
    });
  }

  async function fire(member: string, now: number) {
    const ids = splitMember(member);
    if (!ids) return;
    const [crewId, userId] = ids;
    try {
      const stored = await readTimer(redis, crewId, userId);
      if (!stored) return; // the user tapped I'm OK
      if (stored.dueAt > now) {
        // Restarted between our ZRANGEBYSCORE and ZREM: put the new timer back.
        await redis.zadd(DUE_KEY, stored.dueAt, member);
        return;
      }
      if (await stores.crews.getMember(crewId, userId)) await raiseMissed(stored, now);
    } catch (err) {
      // The ZREM claim already took the member out; re-queue it so the next tick
      // retries. The key's TTL (minutes + 1h) bounds the retries.
      await redis.zadd(DUE_KEY, now + intervalMs, member);
      throw err;
    }
    // Delete only after the raise, so a failure above leaves the timer to retry.
    await redis.del(timerKey(crewId, userId));
  }

  async function drain(key: string, now: number, handle: (member: string) => Promise<void>) {
    const due: string[] = await redis.zrangebyscore(key, '-inf', now, 'LIMIT', 0, BATCH);
    for (const member of due) {
      try {
        // Every PM2 worker runs this tick; ZREM returning 1 is the claim, so
        // exactly one worker handles each timer without leader election.
        if ((await redis.zrem(key, member)) !== 1) continue;
        await handle(member);
      } catch (err: any) {
        log.warn('checkin: timer handling failed', { error: err?.message, key, member });
      }
    }
  }

  async function tick(now: number = Date.now()) {
    if (!redis) return;
    try {
      await drain(WARN_KEY, now, (member) => warn(member, now));
      await drain(DUE_KEY, now, (member) => fire(member, now));
    } catch (err: any) {
      log.warn('checkin: tick failed', { error: err?.message });
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}
