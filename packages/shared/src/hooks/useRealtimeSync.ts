import { useCallback, useEffect, useMemo } from 'react';
import type { Socket } from '../services/socket';
import { useUIStore } from '../stores/uiStore';
import { useFestivalDataStore } from '../stores/festivalDataStore';
import { useCrewStore } from '../stores/crewStore';
import { useNotificationPrefsStore } from '../stores/notificationPrefsStore';
import type {
  ProfileUpdatedPayload,
  ProfileDeletedPayload,
  FestivalIdPayload,
  PresenceUpdatePayload,
  CrewUpdatedPayload,
  CrewMemberEventPayload,
  CrewStatusUpdatedPayload,
} from '../types/socket-events';

const RECONNECT_FESTIVAL_RELOAD_GAP_MS = 60_000;

export interface UseRealtimeStoreSyncOptions {
  socket: Socket | null;
  /**
   * Emit `join:festival` on connect (and now, if already connected). Web leaves
   * this off because useSocket owns the festival room there; mobile builds its
   * own socket and sets it.
   */
  joinFestival?: boolean;
}

export interface UseRealtimeStoreSyncReturn {
  /** Debounced re-read of festival, profiles and crews, for a foreground return. */
  backfill: () => void;
}

// Coalesces bursty socket events into one store reload per key (300ms trailing).
function createReloaders() {
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  const schedule = (key: string, fn: () => void, delay = 300) => {
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      delete timers[key];
      fn();
    }, delay);
  };

  const reloadProfiles = () => {
    const festivalId = useFestivalDataStore.getState().currentFestivalId;
    if (!festivalId) return;
    schedule(`profiles:${festivalId}`, () => {
      useFestivalDataStore
        .getState()
        .loadProfiles(festivalId)
        .catch(() => {});
    });
  };

  const reloadFestival = () => {
    const festivalId = useFestivalDataStore.getState().currentFestivalId;
    if (!festivalId) return;
    schedule(`festival:${festivalId}`, () => {
      useFestivalDataStore
        .getState()
        .selectFestival(festivalId)
        .catch(() => {});
    });
  };

  const reloadCrews = (crewId?: string) => {
    schedule('crews', () => {
      useCrewStore
        .getState()
        .loadCrews()
        .catch(() => {});
      const activeId = useCrewStore.getState().activeCrew?.id;
      const targetId = crewId || activeId;
      if (targetId && targetId === activeId) {
        useCrewStore
          .getState()
          .selectCrew(targetId)
          .catch(() => {});
      }
    });
  };

  const cancelAll = () => {
    for (const k of Object.keys(timers)) {
      clearTimeout(timers[k]);
      delete timers[k];
    }
  };

  return { reloadProfiles, reloadFestival, reloadCrews, cancelAll };
}

/**
 * Bridge Socket.IO festival/profile/crew events to the shared stores. One owner
 * for web and mobile; each event has one source of truth:
 *   - pick:* / note:saved / profile:* -> festivalDataStore (patch in place, else reload)
 *   - crew:updated / crew:member-* -> crewStore reload; crew:status-updated patches it
 *   - festival:updated (current festival only) / festival:set-* -> full festival reload
 *   - presence:update -> uiStore (no refetch)
 * Crew sub-feature, live-location and revocation events live in their own hooks.
 */
export function useRealtimeStoreSync({
  socket,
  joinFestival = false,
}: UseRealtimeStoreSyncOptions): UseRealtimeStoreSyncReturn {
  const reloaders = useMemo(createReloaders, []);
  const backfill = useCallback(() => {
    reloaders.reloadFestival();
    reloaders.reloadProfiles();
    reloaders.reloadCrews();
    useNotificationPrefsStore.getState().syncTimeZone();
  }, [reloaders]);

  // Browser foreground return (native apps call `backfill` from AppState): re-pin quiet hours to the device zone.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') useNotificationPrefsStore.getState().syncTimeZone();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const { reloadProfiles, reloadFestival, reloadCrews, cancelAll } = reloaders;
    const { setConnected, setOnlineUsers } = useUIStore.getState();

    // Patch a single profile's picks in place from the socket payload (which
    // carries the full picks map); fall back to a full /profiles refetch only
    // when the profile isn't loaded yet (a brand-new joiner).
    const patchOrReload = (data: ProfileUpdatedPayload) => {
      const patched = useFestivalDataStore.getState().applyProfilePatch({
        profileId: data?.profileId,
        picks: data?.picks,
        interestsChanged: data?.interestsChanged,
      });
      if (!patched) reloadProfiles();
    };

    const handlePickUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);
    const handlePickRemoved = (_data: ProfileDeletedPayload) => reloadProfiles();
    // note:saved carries no notes (notes are per-viewer): full reload.
    const handleNoteSaved = (_data: ProfileUpdatedPayload) => reloadProfiles();
    // Legacy event name kept during transition (server still emits picks:updated).
    const handlePicksUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);

    const handleProfileUpdated = (data: ProfileUpdatedPayload) => patchOrReload(data);
    const handleProfileJoined = (_data: ProfileUpdatedPayload) => reloadProfiles();
    const handleProfileLeft = (_data: ProfileDeletedPayload) => reloadProfiles();

    const handleCrewUpdated = (data: CrewUpdatedPayload) => reloadCrews(data?.crewId ?? data?.id);
    const handleCrewMemberAdded = (data: CrewMemberEventPayload) => reloadCrews(data?.crewId);
    const handleCrewMemberRemoved = (data: CrewMemberEventPayload) => reloadCrews(data?.crewId);

    // A crewmate's last-synced status changed. Apply it only for the open crew so a
    // background crew never mutates the visible list; the store is last-write-wins.
    const handleCrewStatusUpdated = (data: CrewStatusUpdatedPayload) => {
      const row = data?.status;
      if (!row) return;
      const activeId = useCrewStore.getState().activeCrew?.id ?? null;
      if (!activeId || row.crew_id !== activeId) return;
      useCrewStore.getState().applyStatusUpdate(row);
    };

    const handleFestivalUpdated = (data: FestivalIdPayload) => {
      if (data?.id === useFestivalDataStore.getState().currentFestivalId) reloadFestival();
    };
    const handleSetAdded = (_data: FestivalIdPayload) => reloadFestival();
    const handleSetUpdated = (_data: FestivalIdPayload) => reloadFestival();

    const handlePresenceUpdate = (data: PresenceUpdatePayload) => {
      if (data.festivalId && data.festivalId !== useFestivalDataStore.getState().currentFestivalId) return;
      if (data.online) {
        setOnlineUsers(
          data.online.map((u) => ({ id: u.userId, name: u.username, avatar: u.avatarUrl, status: 'online' as const })),
        );
      }
    };

    const emitJoinFestival = () => {
      const festivalId = useFestivalDataStore.getState().currentFestivalId;
      if (joinFestival && festivalId) socket.emit('join:festival', festivalId, { _v: 1 }, () => {});
    };

    // Events sent while the socket was down are lost (the server keeps no
    // buffer), so a reconnect re-reads picks and crews. The full festival reload
    // is the heaviest call and lineup edits are rare: only after a long gap.
    let connectedBefore = socket.connected;
    let disconnectedAt: number | null = null;
    const handleConnect = () => {
      setConnected(true);
      emitJoinFestival();
      if (connectedBefore) {
        reloadProfiles();
        reloadCrews();
        if (disconnectedAt !== null && Date.now() - disconnectedAt >= RECONNECT_FESTIVAL_RELOAD_GAP_MS) {
          reloadFestival();
        }
      }
      connectedBefore = true;
      disconnectedAt = null;
    };

    const handleDisconnect = () => {
      setConnected(false);
      disconnectedAt ??= Date.now();
    };

    socket.on('pick:updated', handlePickUpdated);
    socket.on('pick:removed', handlePickRemoved);
    socket.on('note:saved', handleNoteSaved);
    socket.on('picks:updated', handlePicksUpdated);
    socket.on('profile:updated', handleProfileUpdated);
    socket.on('profile:joined', handleProfileJoined);
    socket.on('profile:left', handleProfileLeft);
    socket.on('crew:updated', handleCrewUpdated);
    socket.on('crew:member-joined', handleCrewMemberAdded);
    socket.on('crew:member-left', handleCrewMemberRemoved);
    socket.on('crew:status-updated', handleCrewStatusUpdated);
    socket.on('festival:updated', handleFestivalUpdated);
    socket.on('festival:set-added', handleSetAdded);
    socket.on('festival:set-updated', handleSetUpdated);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    // The socket may already be connected, in which case 'connect' will not fire again.
    if (socket.connected) emitJoinFestival();

    return () => {
      socket.off('pick:updated', handlePickUpdated);
      socket.off('pick:removed', handlePickRemoved);
      socket.off('note:saved', handleNoteSaved);
      socket.off('picks:updated', handlePicksUpdated);
      socket.off('profile:updated', handleProfileUpdated);
      socket.off('profile:joined', handleProfileJoined);
      socket.off('profile:left', handleProfileLeft);
      socket.off('crew:updated', handleCrewUpdated);
      socket.off('crew:member-joined', handleCrewMemberAdded);
      socket.off('crew:member-left', handleCrewMemberRemoved);
      socket.off('crew:status-updated', handleCrewStatusUpdated);
      socket.off('festival:updated', handleFestivalUpdated);
      socket.off('festival:set-added', handleSetAdded);
      socket.off('festival:set-updated', handleSetUpdated);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      // Cancel pending debounced reloads so none fire after teardown.
      cancelAll();
    };
  }, [socket, joinFestival, reloaders]);

  return { backfill };
}
