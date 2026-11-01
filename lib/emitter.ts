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

import { appLink } from './notifications/links.js';
import { buildSchedulePushes } from './schedule-diff.js';

const EVENT_VERSION = 1;
const SCHEDULE_PUSH_CHUNK = 20;

export function createSocketEmitter({ io, log, notificationService, buildAvatarUrl, _getUserById, stores, config }: any) {

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

    // Push notification for pick changes to offline crew-mates only, never the whole festival.
    if (notificationService?.isConfigured && typeof notificationService.sendToOfflineUsers === 'function' && changedFields.picks) {
      pushPicksToCrew(profile).catch((err: any) => log.warn('crew push failed', { error: err.message }));

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

  async function pushPicksToCrew(profile: any) {
    if (!profile.userId) return;
    const crews = await stores.crews.listByUserAndFestival(profile.userId, profile.festivalId);
    const membersByCrew = await stores.crews.getMembersForCrews(crews.map((crew: any) => crew.id));
    const userIds = [
      ...new Set([...membersByCrew.values()].flat().map((member: any) => member.userId)),
    ].filter((userId) => userId && userId !== profile.userId);
    if (userIds.length === 0) return;
    await notificationService.sendToOfflineUsers({
      festivalId: profile.festivalId,
      type: 'crew_update',
      // #29: topic for per-type filtering
      topic: 'crew',
      title: 'Crew Update',
      body: `${profile.name} updated their picks`,
      data: {
        festivalId: profile.festivalId,
        profileId: profile.id,
        deepLink: appLink(config, '/compare'),
      },
      // #32: Separate thread per festival for crew updates
      threadId: `crew-${profile.festivalId}`,
      userIds,
    });
  }

  function festivalUpdated({ festival }: any) {
    io.emit('festival:updated', { _v: EVENT_VERSION, id: festival.id });

    // No visible push here: scheduleChanged alerts only the people whose picks moved.
    if (notificationService?.isConfigured && typeof notificationService.sendSilentSync === 'function') {
      // #30: Silent push for background data sync
      notificationService.sendSilentSync({
        festivalId: festival.id,
        syncType: 'festival',
      }).catch((err: any) => log.warn('silent sync push failed', { error: err.message }));
    }
  }

  /** One alert per person who picked a set that moved or left the lineup. Never throws. */
  async function scheduleChanged({ festival, changes, pickersBySet }: any) {
    if (!notificationService?.isConfigured || typeof notificationService.send !== 'function') return;
    try {
      const muted: Set<string> =
        (await stores?.topicSubscriptions?.getUnsubscribedUsers?.(festival.id, 'schedule')) || new Set();
      const messages = buildSchedulePushes(festival.name, changes, pickersBySet).filter((m) => !muted.has(m.userId));
      for (let i = 0; i < messages.length; i += SCHEDULE_PUSH_CHUNK) {
        const results = await Promise.allSettled(
          messages.slice(i, i + SCHEDULE_PUSH_CHUNK).map(({ userId, title, body, setId }) =>
            notificationService.send({
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
            log.warn('schedule push failed', { festivalId: festival.id, error: result.reason?.message });
          }
        }
      }
    } catch (err: any) {
      log.warn('schedule push failed', { festivalId: festival?.id, error: err.message });
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
    scheduleChanged,
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
