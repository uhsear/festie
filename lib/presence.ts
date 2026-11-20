/**
 * Socket presence management — tracks online users per festival room.
 * Supports Redis-backed cross-worker presence with in-memory fallback.
 */
import type { Redis } from 'ioredis';
import type { DefaultEventsMap, Socket } from 'socket.io';

import type { createRedisPresenceStore } from './redis.js';
import type { createLogger } from './logger.js';
import type { AppState } from './types/app-context.js';

/** Per-socket state the realtime handlers keep on `socket.data`. */
export interface SocketData {
  connectionId?: string;
  userId?: string | null;
  username?: string | null;
  festivalId?: string | null;
  profileId?: string | null;
  userSessionToken?: string | null;
  crewId?: string;
  sharingCrewId?: string;
  sharingUserId?: string | null;
  sharingSince?: number;
  sharingUntil?: number;
  crewMembershipCheckedAt?: number;
  crewMembershipUpdateCount?: number;
}

/** A connected socket; `authenticated` is set once it has joined a festival room. */
export type RealtimeSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData> & {
  authenticated?: boolean;
};

/** What revocation needs from a socket: a local `Socket` or a `RemoteSocket` from `fetchSockets()`. */
type RevocableSocket = {
  id: string;
  data: SocketData;
  leave(room: string): unknown;
  disconnect(close?: boolean): unknown;
  emit(event: string, ...args: unknown[]): unknown;
};

/** The slice of the Socket.IO `Server` that presence uses; tests pass a fake. */
export interface PresenceIo {
  to(room: string): { emit(event: string, payload: unknown): unknown };
  of(namespace: string): {
    fetchSockets?: () => Promise<RevocableSocket[]>;
    sockets: Map<string, RevocableSocket>;
  };
}

/** What crew-room eviction needs from the Socket.IO `Server`. */
export interface CrewEvictionIo {
  in(room: string): { fetchSockets(): Promise<RevocableSocket[]> };
}

/** Drops the streaming-path membership cache so a later re-join re-checks. */
export function resetCrewMembershipCache(data: SocketData) {
  delete data.crewMembershipCheckedAt;
  delete data.crewMembershipUpdateCount;
}

const CREW_EVICTION_TIMEOUT_MS = 3_000;

/**
 * Force sockets out of `crew:${crewId}` on every instance behind the adapter and clear their
 * sharing stamps. With `userId`, only that user's sockets leave and each is told
 * `crew:access-revoked`; without it every socket leaves (the caller emits `crew:deleted`).
 * `s.data.crewId` is kept on purpose so a stray location:share is rejected NOT_A_MEMBER.
 * Bounded because fetchSockets() can hang for a Redis outage. Throws on failure.
 */
export async function evictCrewRoomSockets(io: CrewEvictionIo, crewId: string, userId?: string) {
  const room = `crew:${crewId}`;
  let timer: NodeJS.Timeout | undefined;
  const sockets = await Promise.race([
    io.in(room).fetchSockets(),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('fetchSockets timed out')), CREW_EVICTION_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  for (const s of sockets) {
    if (userId && s.data?.userId !== userId) continue;
    if (userId) s.emit('crew:access-revoked', { crewId });
    if (userId || s.data?.sharingCrewId === crewId) delete s.data.sharingCrewId;
    resetCrewMembershipCache(s.data);
    s.leave(room);
  }
}

type Log = ReturnType<typeof createLogger>;
type AvatarBuilder = (user: { avatarKey?: string | null; avatarVersion?: string | number | null; [key: string]: unknown } | null | undefined) => string | null;
type PresenceStore = NonNullable<ReturnType<typeof createRedisPresenceStore>>;

interface PresenceDeps {
  state: Pick<AppState, 'onlineUsers'>;
  redisPresence: PresenceStore | null;
  redis: Redis | null;
  log: Log;
  // shortcut: stores is the loosely typed Record<string, any> bag from createAppContext; type it per store once that bag is.
  stores: Record<string, any>;
  buildAvatarUrl: AvatarBuilder;
}

export function createPresenceManager({ state, redisPresence, redis, log, stores, buildAvatarUrl }: PresenceDeps) {
  function removeSocketPresence(socket: RevocableSocket) {
    const festivalId = socket.data?.festivalId;
    if (!festivalId) return null;
    const room = state.onlineUsers.get(festivalId);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) state.onlineUsers.delete(festivalId);
    }
    if (redisPresence) {
      redisPresence.setOffline(festivalId, socket.id).catch((err: Error) => {
        log.debug('redis presence setOffline failed', { error: err.message });
      });
    }
    log.info('presence: user left', { festivalId, socketId: socket.id, userId: socket.data?.userId });
    socket.data.festivalId = null;
    return festivalId;
  }

  // shortcut: state.onlineUsers is per process, so each instance counts only its own sockets; read counts from the Redis presence path if the app scales out.
  async function setSocketPresence(festivalId: string, userId: string, username: string, socketId: string) {
    if (!state.onlineUsers.has(festivalId)) {
      state.onlineUsers.set(festivalId, new Map());
    }
    state.onlineUsers.get(festivalId)!.set(socketId, { userId, username });
    log.info('presence: user joined', { festivalId, userId, username, socketId });
    if (redisPresence) {
      await redisPresence.setOnline(festivalId, userId, username, socketId);
    }
  }

  async function getPresenceList(festivalId: string) {
    if (redisPresence) {
      try {
        const entries = await redisPresence.getOnline(festivalId);
        const usersById = await stores.users.getByIds([...new Set(entries.map((e: { userId: string }) => e.userId))]);
        return entries.map(({ userId, username }: { userId: string; username: string }) => ({
          userId,
          username,
          avatarUrl: buildAvatarUrl(usersById.get(userId)),
        }));
      } catch (err) {
        log.debug('redis presence getOnline failed, using local', { error: (err as Error).message });
      }
    }
    const room = state.onlineUsers.get(festivalId);
    if (!room) return [];
    const seen = new Set<string>();
    const entries: { userId: string; username: string }[] = [];
    for (const { userId, username } of room.values()) {
      if (seen.has(userId)) continue;
      seen.add(userId);
      entries.push({ userId, username });
    }
    const usersById = await stores.users.getByIds([...seen]);
    return entries.map(({ userId, username }) => ({ userId, username, avatarUrl: buildAvatarUrl(usersById.get(userId)) }));
  }

  const _presenceDebounce = new Map<string, NodeJS.Timeout>();

  // Well inside the 120s Redis TTL so a connected socket never ages out.
  const HEARTBEAT_MS = 40_000;
  const _heartbeat = redisPresence?.heartbeat
    ? setInterval(() => {
        for (const [festivalId, room] of state.onlineUsers) {
          const sockets = [...room].map(([socketId, { userId, username }]) => ({ socketId, userId, username }));
          redisPresence.heartbeat(festivalId, sockets).catch((err: Error) => {
            log.debug('redis presence heartbeat failed', { error: err.message });
          });
        }
      }, HEARTBEAT_MS)
    : null;
  _heartbeat?.unref();
  function emitPresence(festivalId: string, io: PresenceIo) {
    if (_presenceDebounce.has(festivalId)) clearTimeout(_presenceDebounce.get(festivalId));
    _presenceDebounce.set(
      festivalId,
      setTimeout(async () => {
        _presenceDebounce.delete(festivalId);
        try {
          const online = await getPresenceList(festivalId);
          if (redisPresence) {
            redisPresence.refresh(festivalId).catch((err: Error) => {
              log.warn('redis presence refresh failed', { festivalId, error: err.message });
            });
          }
          io.to(festivalId).emit('presence:update', { online });
        } catch (err) {
          log.warn('emitPresence failed', { festivalId, error: (err as Error).message });
        }
      }, 200),
    );
  }

  function clearPresenceTimers() {
    for (const timer of _presenceDebounce.values()) clearTimeout(timer);
    _presenceDebounce.clear();
    if (_heartbeat) clearInterval(_heartbeat);
  }

  async function emitProfileIdentity(user: { id: string; username: string; displayName?: string | null }, io: PresenceIo) {
    const avatarUrl = buildAvatarUrl(user);
    const profiles = await stores.profiles.getByUserId(user.id);
    const festivals = new Set<string>();
    for (const profile of profiles) {
      festivals.add(profile.festivalId);
      io.to(profile.festivalId).emit('profile:identity', {
        festivalId: profile.festivalId,
        profileId: profile.id,
        username: user.username,
        name: user.displayName || null,
        avatarUrl,
      });
    }
    for (const festivalId of festivals) emitPresence(festivalId, io);
  }

  function clearSocketSession(socket: { data: SocketData }) {
    socket.data.userId = null;
    socket.data.username = null;
    socket.data.festivalId = null;
    socket.data.profileId = null;
    socket.data.userSessionToken = null;
  }

  function leaveFestivalRealtime(socket: RevocableSocket, io: PresenceIo, presenceTargets: Set<string> | null = null) {
    const festivalId = removeSocketPresence(socket);
    if (!festivalId) return null;
    if (presenceTargets) presenceTargets.add(festivalId);
    socket.leave(festivalId);
    socket.data.profileId = null;
    return festivalId;
  }

  function disconnectSocket(socket: RevocableSocket, io: PresenceIo, presenceTargets: Set<string> | null = null) {
    leaveFestivalRealtime(socket, io, presenceTargets);
    // The disconnect handler needs the sharer's id after the session is cleared.
    if (socket.data.sharingCrewId) socket.data.sharingUserId = socket.data.userId;
    clearSocketSession(socket);
    socket.disconnect(true);
  }

  // Revocation must reach sockets on every process behind the adapter. fetchSockets() can hang
  // while Redis is down, so bound it and fall back to this process's sockets.
  async function fetchRevocationSockets(io: PresenceIo): Promise<RevocableSocket[]> {
    const nsp = io.of('/');
    if (typeof nsp.fetchSockets !== 'function') return Array.from(nsp.sockets.values());
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        nsp.fetchSockets(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('fetchSockets timed out')), 2000);
        }),
      ]);
    } catch (err) {
      log.warn('presence: fetchSockets failed, revoking local sockets only', { error: (err as Error).message });
      return Array.from(nsp.sockets.values());
    } finally {
      clearTimeout(timer);
    }
  }

  async function disconnectUserSockets(userId: string, io: PresenceIo, exceptToken: string | null = null) {
    const presenceTargets = new Set<string>();
    for (const socket of await fetchRevocationSockets(io)) {
      if (socket.data?.userId !== userId) continue;
      if (exceptToken && socket.data?.userSessionToken === exceptToken) continue;
      disconnectSocket(socket, io, presenceTargets);
    }
    if (presenceTargets.size > 0)
      log.info('presence: disconnected all sockets for user', { userId, festivals: [...presenceTargets] });
    for (const festivalId of presenceTargets) emitPresence(festivalId, io);
  }

  async function disconnectSessionTokens(tokens: (string | null | undefined)[] | null | undefined, io: PresenceIo) {
    const tokenSet = new Set((tokens || []).filter(Boolean));
    if (tokenSet.size === 0) return;
    const presenceTargets = new Set<string>();
    for (const socket of await fetchRevocationSockets(io)) {
      if (!tokenSet.has(socket.data?.userSessionToken)) continue;
      disconnectSocket(socket, io, presenceTargets);
    }
    for (const festivalId of presenceTargets) emitPresence(festivalId, io);
  }

  async function removeFestivalSockets(festivalId: string, io: PresenceIo) {
    const presenceTargets = new Set<string>();
    for (const socket of await fetchRevocationSockets(io)) {
      if (socket.data?.festivalId !== festivalId) continue;
      leaveFestivalRealtime(socket, io, presenceTargets);
      socket.emit('festival:access-revoked', { festivalId });
    }
    state.onlineUsers.delete(festivalId);
    if (redisPresence && redis) {
      redis.del(`presence:${festivalId}`).catch((err: Error) => {
        log.warn('redis presence delete failed', { festivalId, error: err.message });
      });
    }
    for (const targetFestivalId of presenceTargets) emitPresence(targetFestivalId, io);
  }

  async function removeProfileSockets(profile: { id?: string; userId?: string; festivalId?: string } | null | undefined, io: PresenceIo) {
    if (!profile?.userId || !profile?.festivalId) return;
    const presenceTargets = new Set<string>();
    for (const socket of await fetchRevocationSockets(io)) {
      if (socket.data?.userId !== profile.userId || socket.data?.festivalId !== profile.festivalId) continue;
      leaveFestivalRealtime(socket, io, presenceTargets);
      socket.emit('festival:access-revoked', { festivalId: profile.festivalId, profileId: profile.id });
    }
    for (const festivalId of presenceTargets) emitPresence(festivalId, io);
  }

  return {
    removeSocketPresence,
    setSocketPresence,
    getPresenceList,
    emitPresence,
    clearPresenceTimers,
    emitProfileIdentity,
    clearSocketSession,
    leaveFestivalRealtime,
    disconnectSocket,
    disconnectUserSockets,
    disconnectSessionTokens,
    removeFestivalSockets,
    removeProfileSockets,
    fetchRevocationSockets,
  };
}
