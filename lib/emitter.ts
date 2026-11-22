// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * SocketEmitter — centralized real-time broadcast + push notification layer.
 *
 * All Socket.IO emits and push notification triggers flow through here so both
 * HTTP routes and Socket.IO handlers produce identical events. TWA and future
 * mobile clients benefit from the same broadcast contract.
 *
 * Features:
 * - Event versioning (_v field) for backward compatibility with mobile apps
 * - Profile update batching (200ms debounce) to prevent broadcast storms
 * - Deep link payloads in push notifications for mobile app navigation
 */

import type { PresenceUser } from '../packages/shared/src/types/socket-events.js';
import type { createLogger } from './logger.js';
import type { AppConfig } from './config.js';
import type { createNotificationService } from './notifications/index.js';
import { appLink } from './notifications/links.js';
import { buildSchedulePushes } from './schedule-diff.js';

const EVENT_VERSION = 1;
const SCHEDULE_PUSH_CHUNK = 20;
/** A pick change sends at most one silent sync per festival per window (per process). */
export const SILENT_SYNC_COALESCE_MS = 60_000;

/** The slice of the Socket.IO `Server` the emitter uses; tests pass a fake. */
interface EmitterIo {
  emit(event: string, payload: unknown): unknown;
  to(room: string | string[]): { emit(event: string, payload: unknown): unknown };
}

/** The store methods the emitter calls; every use is guarded, so a partial store is valid. */
export interface EmitterStores {
  crews?: {
    listByUserAndFestival(userId: string, festivalId: string): Promise<{ id: string }[]>;
    getMembersForCrews(crewIds: string[]): Promise<Map<string, { userId: string }[]>>;
  };
  topicSubscriptions?: {
    getUnsubscribedUsers?(festivalId: string, topic: string): Promise<Iterable<string> | null | undefined>;
  };
}

type NotificationService = ReturnType<typeof createNotificationService>;

interface EmitterDeps {
  io: EmitterIo;
  log: ReturnType<typeof createLogger>;
  /** Optional in practice: tests and partial boots omit it, and every use is guarded. */
  notificationService?: Partial<NotificationService> | null;
  buildAvatarUrl: (user: unknown) => string | null;
  stores?: EmitterStores;
  config: AppConfig;
}

export interface EmitterProfile {
  id: string;
  festivalId: string;
  userId?: string;
  name: string;
  picks?: Record<string, unknown> | null;
  updatedAt?: string;
}

/** One coalesced `profile:updated`, held until the debounce timer fires. */
interface ProfileBatch {
  festivalId: string;
  profileId: string;
  userId?: string;
  name: string;
  avatarUrl: string | null;
  picks: Record<string, unknown>;
  interestsChanged: boolean;
  updatedAt: string;
  _batchedAt: number;
}

export function createSocketEmitter({ io, log, notificationService, buildAvatarUrl, stores, config }: EmitterDeps) {

  // Crew pick push digest — one push per author per festival per window.
  // shortcut: digest timers are per process, so with N PM2 instances a busy picker can trigger up to N pushes per window; move the dedupe to Redis if users report doubles.
  const CREW_PUSH_DIGEST_MS = 5 * 60 * 1000;
  const _crewPushTimers = new Map<string, NodeJS.Timeout>();
  const _crewPushPending = new Map<string, { name: string }>();

  async function _sendCrewPickPush(festivalId: string, userId: string, profileId: string, name: string) {
    if (!stores?.crews || typeof notificationService?.send !== 'function') return;
    const crews = await stores.crews.listByUserAndFestival(userId, festivalId);
    if (!crews?.length) return;
    const membersByCrew = await stores.crews.getMembersForCrews(crews.map((c: { id: string }) => c.id));
    const muted = new Set(
      (await stores.topicSubscriptions?.getUnsubscribedUsers?.(festivalId, 'crew')) || [],
    );
    const recipients = new Set<string>();
    for (const members of membersByCrew.values()) {
      for (const m of members) {
        if (m.userId !== userId && !muted.has(m.userId)) recipients.add(m.userId);
      }
    }
    await Promise.all([...recipients].map((uid) =>
      notificationService.send!({
        userId: uid,
        type: 'crew_update',
        title: 'Crew update',
        body: `${name} updated their picks.`,
        data: { festivalId, profileId, deepLink: appLink(config, '/compare') },
        threadId: `crew-${festivalId}`,
      }).catch((err: Error) => log.warn('crew push failed', { error: err.message })),
    ));
  }

  function queueCrewPickPush(profile: EmitterProfile) {
    if (_shuttingDown || !notificationService) return;
    const key = `${profile.festivalId}:${profile.userId}`;
    const pending = _crewPushPending.get(key);
    if (pending) {
      pending.name = profile.name;
      return;
    }
    _crewPushPending.set(key, { name: profile.name });
    const timer = setTimeout(() => {
      const latest = _crewPushPending.get(key);
      _crewPushTimers.delete(key);
      _crewPushPending.delete(key);
      if (!latest) return;
      _sendCrewPickPush(profile.festivalId, profile.userId!, profile.id, latest.name)
        .catch((err: Error) => log.warn('crew push failed', { error: err.message }));
    }, CREW_PUSH_DIGEST_MS);
    timer.unref?.();
    _crewPushTimers.set(key, timer);
  }

  // One trailing silent sync per festival per window; later pick changes inside the window ride along.
  // No excludeUserIds: with several authors in one window, excluding one of them is wrong.
  const _silentSyncTimers = new Map<string, NodeJS.Timeout>();

  function queueSilentSync(festivalId: string) {
    if (_shuttingDown || typeof notificationService?.sendSilentSync !== 'function' || _silentSyncTimers.has(festivalId)) return;
    const timer = setTimeout(() => {
      _silentSyncTimers.delete(festivalId);
      notificationService!.sendSilentSync!({ festivalId, syncType: 'profiles' })
        .catch((err: Error) => log.warn('silent sync push failed', { error: err.message }));
    }, SILENT_SYNC_COALESCE_MS);
    timer.unref?.();
    _silentSyncTimers.set(festivalId, timer);
  }

  // Profile update batching — coalesce rapid pick/status changes into a single broadcast
  const _profileBatchTimers = new Map<string, NodeJS.Timeout>();
  const _profileBatchPayloads = new Map<string, ProfileBatch>();
  const BATCH_DEBOUNCE_MS = 200;
  const MAX_BATCH_ENTRIES = 1000; // Safety cap on batch map size (#58)
  let _shuttingDown = false;

  function _flushProfileBatch(key: string): Promise<void> {
    _profileBatchTimers.delete(key);
    const payload = _profileBatchPayloads.get(key);
    _profileBatchPayloads.delete(key);
    if (!payload) return Promise.resolve();
    return _emitToAuthorCrews(payload);
  }

  // Picks reach only the author's own devices (user room) and crews on this
  // festival, never the whole festival room: other attendees see anonymous
  // counts on their next GET /profiles/:festivalId. The user room keeps the
  // offline queue's post-drain re-sync working for a crewless author.
  // shortcut: a socket sits in one crew room (its active crew), so a crew mate
  // viewing a different shared crew catches up on reload.
  async function _emitToAuthorCrews(payload: ProfileBatch) {
    if (!payload.userId) return;
    // A failed crew lookup still re-syncs the author's own devices.
    const crews = stores?.crews
      ? await stores.crews.listByUserAndFestival(payload.userId, payload.festivalId).catch((err: Error) => {
        log.warn('profile:updated crew lookup failed', { error: err.message });
        return [];
      })
      : [];
    const userRoom = 'user:' + payload.userId;
    const crewRooms = (crews || []).map((c: { id: string }) => 'crew:' + c.id);
    const body = {
      _v: EVENT_VERSION,
      festivalId: payload.festivalId,
      profileId: payload.profileId,
      name: payload.name,
      avatarUrl: payload.avatarUrl,
      picks: payload.picks,
      updatedAt: payload.updatedAt,
    };
    // Marks are private to their owner. Only the author's devices learn that they changed: a crew mate
    // cannot read them, so the flag would only force a reload and tell the crew someone marked an act.
    if (payload.interestsChanged !== true) {
      io.to([userRoom, ...crewRooms]).emit('profile:updated', { ...body, interestsChanged: false });
      return;
    }
    io.to(userRoom).emit('profile:updated', { ...body, interestsChanged: true });
    if (crewRooms.length > 0) io.to(crewRooms).emit('profile:updated', { ...body, interestsChanged: false });
  }

  function profileCreated({ festivalId, profile, user }: { festivalId: string; profile: { id: string; name: string }; user: unknown }) {
    io.to(festivalId).emit('profile:created', {
      _v: EVENT_VERSION,
      festivalId,
      profile: {
        id: profile.id,
        name: profile.name,
        avatarUrl: buildAvatarUrl(user),
      },
    });
  }

  function profileUpdated({ profile, user, changedFields = {} }: { profile: EmitterProfile; user: unknown; changedFields?: { interests?: boolean; picks?: boolean } }) {
    const key = `${profile.festivalId}:${profile.id}`;

    // Safety cap on batch map size (#58) — evict oldest if at capacity
    if (_profileBatchPayloads.size >= MAX_BATCH_ENTRIES) {
      const oldest = _profileBatchPayloads.keys().next().value;
      if (oldest) {
        if (_profileBatchTimers.has(oldest)) {
          clearTimeout(_profileBatchTimers.get(oldest));
          _profileBatchTimers.delete(oldest);
        }
        void _flushProfileBatch(oldest);
      }
    }

    // Merge into batch payload
    _profileBatchPayloads.set(key, {
      festivalId: profile.festivalId,
      profileId: profile.id,
      userId: profile.userId,
      name: profile.name,
      avatarUrl: buildAvatarUrl(user),
      picks: profile.picks || {},
      // Rapid writes merge into one broadcast, so a later pick write must not hide an earlier interest change.
      interestsChanged: changedFields.interests === true || _profileBatchPayloads.get(key)?.interestsChanged === true,
      updatedAt: profile.updatedAt || new Date().toISOString(),
      _batchedAt: Date.now(),
    });

    // Reset debounce timer (skip if shutting down — flushAll handles pending batches)
    if (_profileBatchTimers.has(key)) {
      clearTimeout(_profileBatchTimers.get(key));
    }
    if (!_shuttingDown) {
      _profileBatchTimers.set(key, setTimeout(() => void _flushProfileBatch(key), BATCH_DEBOUNCE_MS));
    }

    // Push notification for pick changes to offline crew
    if (changedFields.picks) {
      queueCrewPickPush(profile);

      // #30: Silent push for background data sync (no visible notification, so it needs a provider)
      if (notificationService?.isConfigured) queueSilentSync(profile.festivalId);
    }
  }

  function profileDeleted({ festivalId, profileId }: { festivalId: string; profileId: string }) {
    // Cancel any pending batch for this profile
    const key = `${festivalId}:${profileId}`;
    if (_profileBatchTimers.has(key)) {
      clearTimeout(_profileBatchTimers.get(key));
      _profileBatchTimers.delete(key);
      _profileBatchPayloads.delete(key);
    }
    io.to(festivalId).emit('profile:deleted', { _v: EVENT_VERSION, festivalId, profileId });
  }

  function festivalCreated({ id, name }: { id?: string; name: string }) {
    io.emit('festival:created', { _v: EVENT_VERSION, id, name });
  }

  function festivalUpdated({ festival }: { festival: { id: string; name?: string } }) {
    io.emit('festival:updated', { _v: EVENT_VERSION, id: festival.id });

    // No visible push here: scheduleChanged alerts only the people whose picks moved.
    if (notificationService?.isConfigured && typeof notificationService.sendSilentSync === 'function') {
      // #30: Silent push for background data sync
      notificationService.sendSilentSync({
        festivalId: festival.id,
        syncType: 'festival',
      }).catch((err: Error) => log.warn('silent sync push failed', { error: err.message }));
    }
  }

  /**
   * One alert per person who picked a set that moved or left the lineup, and one per person whose open
   * mark is on an act that was cancelled (`interestedByEntry`). Never throws. `ok` is false when the lookup failed or
   * every push failed (a provider outage), so a caller that must not lose the alert can hold it again.
   */
  async function scheduleChanged({ festival, changes, pickersBySet, interestedByEntry }: {
    festival: { id: string; name: string };
    changes: Parameters<typeof buildSchedulePushes>[1];
    pickersBySet: Parameters<typeof buildSchedulePushes>[2];
    interestedByEntry?: Parameters<typeof buildSchedulePushes>[3];
  }): Promise<{ ok: boolean }> {
    if (typeof notificationService?.send !== 'function') return { ok: true };
    try {
      let sent = 0;
      let failed = 0;
      const muted = new Set<string>(
        (await stores?.topicSubscriptions?.getUnsubscribedUsers?.(festival.id, 'schedule')) || [],
      );
      const messages = buildSchedulePushes(festival.name, changes, pickersBySet, interestedByEntry).filter((m) => !muted.has(m.userId));
      for (let i = 0; i < messages.length; i += SCHEDULE_PUSH_CHUNK) {
        const results = await Promise.allSettled(
          messages.slice(i, i + SCHEDULE_PUSH_CHUNK).map(({ userId, title, body, setId }) =>
            notificationService.send!({
              userId,
              type: 'schedule_change',
              title,
              body,
              data: {
                festivalId: festival.id,
                ...(setId ? { setId } : {}),
                deepLink: appLink(config, setId ? `/set/${setId}` : '/picks'),
              },
              threadId: `schedule-${festival.id}`,
            }),
          ),
        );
        for (const result of results) {
          if (result.status === 'rejected') {
            failed++;
            log.warn('schedule push failed', { festivalId: festival.id, error: result.reason?.message });
          } else sent++;
        }
      }
      return { ok: failed === 0 || sent > 0 };
    } catch (err) {
      log.warn('schedule push failed', { festivalId: festival?.id, error: (err as Error).message });
      return { ok: false };
    }
  }

  function festivalDeleted({ id }: { id: string }) {
    io.emit('festival:deleted', { _v: EVENT_VERSION, id });
  }



  function presenceUpdate({ festivalId, online }: { festivalId: string; online: (Omit<PresenceUser, 'username'> & { username?: string })[] }) {
    io.to(festivalId).emit('presence:update', { _v: EVENT_VERSION, online });
  }

  // Flush all pending batches (useful for graceful shutdown)
  // Resolves once every flushed batch has finished its crew lookup and emit.
  async function flushAll() {
    _shuttingDown = true;
    const pending: Promise<void>[] = [];
    for (const [key, timer] of _profileBatchTimers) {
      clearTimeout(timer);
      pending.push(_flushProfileBatch(key));
    }
    _profileBatchTimers.clear();
    _profileBatchPayloads.clear();
    for (const timer of _crewPushTimers.values()) clearTimeout(timer);
    _crewPushTimers.clear();
    _crewPushPending.clear();
    for (const timer of _silentSyncTimers.values()) clearTimeout(timer);
    _silentSyncTimers.clear();
    for (const r of await Promise.allSettled(pending)) {
      if (r.status === 'rejected') log.warn('profile:updated flush on shutdown failed', { error: r.reason?.message });
    }
  }

  function crewExpenseAdded({ crewId, expense }: { crewId: string; expense: Record<string, unknown> }) {
    io.to('crew:' + crewId).emit('crew:expense-added', { _v: EVENT_VERSION, crewId, expense });
  }
  function crewExpenseDeleted({ crewId, expenseId }: { crewId: string; expenseId: string }) {
    io.to('crew:' + crewId).emit('crew:expense-deleted', { _v: EVENT_VERSION, crewId, expenseId });
  }
  // An expense was edited, a payment confirmed or disputed, or the currency changed.
  function crewExpenseUpdated({ crewId, expense }: { crewId: string; expense?: Record<string, unknown> }) {
    io.to('crew:' + crewId).emit('crew:expense-updated', { _v: EVENT_VERSION, crewId, expense });
  }
  function crewActivityLogged({ crewId, item }: { crewId: string; item: Record<string, unknown> }) {
    io.to('crew:' + crewId).emit('crew:activity', { _v: EVENT_VERSION, crewId, item });
  }

  // Generic fan-out for events whose payload the caller already shaped; payloads go out unchanged (no _v added).
  function toCrew(crewId: string, event: string, payload: unknown) {
    io.to('crew:' + crewId).emit(event, payload);
  }
  function toRoom(room: string | string[], event: string, payload: unknown) {
    io.to(room).emit(event, payload);
  }
  function broadcast(event: string, payload: unknown) {
    io.emit(event, payload);
  }

  return {
    EVENT_VERSION,
    toCrew,
    toRoom,
    broadcast,
    profileCreated,
    profileUpdated,
    profileDeleted,
    festivalCreated,
    festivalUpdated,
    scheduleChanged,
    festivalDeleted,
    presenceUpdate,
    flushAll,
    crewExpenseAdded,
    crewExpenseDeleted,
    crewExpenseUpdated,
    crewActivityLogged,
  };
}

/** The emitter object routes receive on `deps.emitter` (see RouteDeps). */
export type SocketEmitter = ReturnType<typeof createSocketEmitter>;
