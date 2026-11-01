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

const EVENT_VERSION = 1;

export function createSocketEmitter({ io, log, notificationService, buildAvatarUrl, _getUserById, stores }: any) {

  // Crew pick push digest — one push per author per festival per window.
  // shortcut: digest timers are per process, so with N PM2 instances a busy picker can trigger up to N pushes per window; move the dedupe to Redis if users report doubles.
  const CREW_PUSH_DIGEST_MS = 5 * 60 * 1000;
  const _crewPushTimers = new Map();
  const _crewPushPending = new Map();

  async function _sendCrewPickPush(festivalId: any, userId: any, profileId: any, name: any) {
    if (!stores?.crews || typeof notificationService?.send !== 'function') return;
    const crews = await stores.crews.listByUserAndFestival(userId, festivalId);
    if (!crews?.length) return;
    const membersByCrew = await stores.crews.getMembersForCrews(crews.map((c: any) => c.id));
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
      notificationService.send({
        userId: uid,
        type: 'crew_update',
        title: 'Crew update',
        body: `${name} updated their picks.`,
        data: { festivalId, profileId, deepLink: 'festie://crew-compare' },
        threadId: `crew-${festivalId}`,
      }).catch((err: any) => log.warn('crew push failed', { error: err.message })),
    ));
  }

  function queueCrewPickPush(profile: any) {
    if (_shuttingDown || !notificationService?.isConfigured) return;
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
      _sendCrewPickPush(profile.festivalId, profile.userId, profile.id, latest.name)
        .catch((err: any) => log.warn('crew push failed', { error: err.message }));
    }, CREW_PUSH_DIGEST_MS);
    timer.unref?.();
    _crewPushTimers.set(key, timer);
  }

  // Profile update batching — coalesce rapid pick/status changes into a single broadcast
  const _profileBatchTimers = new Map();
  const _profileBatchPayloads = new Map();
  const BATCH_DEBOUNCE_MS = 200;
  const MAX_BATCH_ENTRIES = 1000; // Safety cap on batch map size (#58)
  let _shuttingDown = false;

  function _flushProfileBatch(key: any) {
    _profileBatchTimers.delete(key);
    const payload = _profileBatchPayloads.get(key);
    _profileBatchPayloads.delete(key);
    if (!payload) return;
    io.to(payload.festivalId).emit('profile:updated', {
      _v: EVENT_VERSION,
      festivalId: payload.festivalId,
      profileId: payload.profileId,
      name: payload.name,
      avatarUrl: payload.avatarUrl,
      picks: payload.picks,
      updatedAt: payload.updatedAt,
    });
  }

  function profileCreated({ festivalId, profile, user }: any) {
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

  function profileUpdated({ profile, user, changedFields = {} }: any) {
    const key = `${profile.festivalId}:${profile.id}`;

    // Safety cap on batch map size (#58) — evict oldest if at capacity
    if (_profileBatchPayloads.size >= MAX_BATCH_ENTRIES) {
      const oldest = _profileBatchPayloads.keys().next().value;
      if (oldest) {
        if (_profileBatchTimers.has(oldest)) {
          clearTimeout(_profileBatchTimers.get(oldest));
          _profileBatchTimers.delete(oldest);
        }
        _flushProfileBatch(oldest);
      }
    }

    // Merge into batch payload
    _profileBatchPayloads.set(key, {
      festivalId: profile.festivalId,
      profileId: profile.id,
      name: profile.name,
      avatarUrl: buildAvatarUrl(user),
      picks: profile.picks || {},
      updatedAt: profile.updatedAt || new Date().toISOString(),
      _batchedAt: Date.now(),
    });

    // Reset debounce timer (skip if shutting down — flushAll handles pending batches)
    if (_profileBatchTimers.has(key)) {
      clearTimeout(_profileBatchTimers.get(key));
    }
    if (!_shuttingDown) {
      _profileBatchTimers.set(key, setTimeout(() => _flushProfileBatch(key), BATCH_DEBOUNCE_MS));
    }

    // Push notification for pick changes to offline crew
    if (notificationService?.isConfigured && changedFields.picks) {
      queueCrewPickPush(profile);

      // #30: Silent push for background data sync (no visible notification)
      notificationService.sendSilentSync?.({
        festivalId: profile.festivalId,
        syncType: 'profiles',
        excludeUserIds: [profile.userId],
      }).catch((err: any) => log.warn('silent sync push failed', { error: err.message }));
    }
  }

  function profileDeleted({ festivalId, profileId }: any) {
    // Cancel any pending batch for this profile
    const key = `${festivalId}:${profileId}`;
    if (_profileBatchTimers.has(key)) {
      clearTimeout(_profileBatchTimers.get(key));
      _profileBatchTimers.delete(key);
      _profileBatchPayloads.delete(key);
    }
    io.to(festivalId).emit('profile:deleted', { _v: EVENT_VERSION, festivalId, profileId });
  }

  function festivalCreated({ id, name }: any) {
    io.emit('festival:created', { _v: EVENT_VERSION, id, name });
  }

  function festivalUpdated({ festival }: any) {
    io.emit('festival:updated', { _v: EVENT_VERSION, id: festival.id });

    if (notificationService?.isConfigured && typeof notificationService.sendToOfflineUsers === 'function') {
      notificationService.sendToOfflineUsers({
        festivalId: festival.id,
        type: 'schedule_change',
        // #29: topic for per-type filtering
        topic: 'schedule',
        title: 'Schedule Updated',
        body: `${festival.name} schedule has been updated`,
        data: {
          festivalId: festival.id,
          deepLink: `rave://festival/${festival.id}`,
        },
        // #32: Separate thread per festival for schedule updates
        threadId: `schedule-${festival.id}`,
      }).catch((err: any) => log.warn('schedule push failed', { error: err.message }));

      // #30: Silent push for background data sync
      notificationService.sendSilentSync?.({
        festivalId: festival.id,
        syncType: 'festival',
      }).catch((err: any) => log.warn('silent sync push failed', { error: err.message }));
    }
  }

  function festivalDeleted({ id }: any) {
    io.emit('festival:deleted', { _v: EVENT_VERSION, id });
  }



  function presenceUpdate({ festivalId, online }: any) {
    io.to(festivalId).emit('presence:update', { _v: EVENT_VERSION, online });
  }

  // Flush all pending batches (useful for graceful shutdown)
  function flushAll() {
    _shuttingDown = true;
    for (const [key, timer] of _profileBatchTimers) {
      clearTimeout(timer);
      _flushProfileBatch(key);
    }
    _profileBatchTimers.clear();
    _profileBatchPayloads.clear();
    for (const timer of _crewPushTimers.values()) clearTimeout(timer);
    _crewPushTimers.clear();
    _crewPushPending.clear();
  }

  function crewExpenseAdded({ crewId, expense }: any) {
    io.to('crew:' + crewId).emit('crew:expense-added', { _v: EVENT_VERSION, crewId, expense });
  }
  function crewExpenseDeleted({ crewId, expenseId }: any) {
    io.to('crew:' + crewId).emit('crew:expense-deleted', { _v: EVENT_VERSION, crewId, expenseId });
  }
  function crewActivityLogged({ crewId, item }: any) {
    io.to('crew:' + crewId).emit('crew:activity', { _v: EVENT_VERSION, crewId, item });
  }

  return {
    EVENT_VERSION,
    profileCreated,
    profileUpdated,
    profileDeleted,
    festivalCreated,
    festivalUpdated,
    festivalDeleted,
    presenceUpdate,
    flushAll,
    crewExpenseAdded,
    crewExpenseDeleted,
    crewActivityLogged,
  };
}

/** The emitter object routes receive on `deps.emitter` (see RouteDeps). */
export type SocketEmitter = ReturnType<typeof createSocketEmitter>;
