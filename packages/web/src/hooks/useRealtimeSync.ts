import { useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { useNavigate } from '@tanstack/react-router';
import { useSocket } from '@festie/shared/hooks/useSocket';
import { useCrewRealtime } from '@festie/shared/hooks/useCrewRealtime';
import { useRealtimeStoreSync } from '@festie/shared/hooks/useRealtimeSync';
import { useRevocationRealtime } from '@festie/shared/hooks';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useToast } from '../lib/toastContext';
import { useCrewQuerySink } from './useCrewQuerySink';

export interface UseRealtimeSyncReturn {
  connected: boolean;
  /** The single shared socket, exposed so feature UIs (Live Location) can emit. */
  socket: Socket | null;
}

/**
 * Bridge Socket.IO events to local state. Each event has ONE source of
 * truth — either Zustand (when the data is mirrored in a store) or
 * TanStack Query (for data not modeled in Zustand). We previously
 * invalidated both for every event, causing double-fetches.
 *
 * Source-of-truth decisions:
 *   - pick:updated / pick:removed / note:saved  -> festivalStore.loadProfiles
 *   - profile:updated / profile:joined / profile:left -> festivalStore.loadProfiles
 *   - crew:updated / crew:member-joined / crew:member-left -> crewStore
 *   - festival:updated (only for the current festival id) / festival:set-added /
 *       festival:set-updated -> festivalStore.selectFestival (full reload of festival + sets + stages)
 *   - presence:update -> uiStore (no refetch; not returned, so the shell does not
 *       re-render on each join or leave)
 *
 * Bursty events (festival/set bulk edits, rapid pick toggles) are
 * debounced with a 300ms trailing guard so we issue one reload per burst.
 */
export function useRealtimeSync(): UseRealtimeSyncReturn {
  const currentFestivalId = useFestivalStore((state) => state.currentFestivalId);
  const connected = useUIStore((state) => state.connected);

  const { socket } = useSocket(currentFestivalId || undefined);

  // ── Crew sub-feature realtime (unconditional; matches mobile) ────────────
  // Web crew tabs are TanStack-Query backed, so the sink invalidates query keys
  // (home base is the exception — it applies to the crewStore). Resolve the
  // active crew live so guards reflect the latest open crew.
  // Crew realtime + Live Location/SOS have no build-time switch. The off-lever
  // is server-side: LIVE_LOCATION_ENABLED / SOS_ENABLED in lib/config.ts (both
  // default ON) disable the feature for every client without a rebuild.
  const crewSink = useCrewQuerySink();
  const getActiveCrewId = useCallback(() => useCrewStore.getState().activeCrew?.id ?? null, []);
  useCrewRealtime({
    socket,
    getActiveCrewId,
    sink: crewSink,
    joinRoom: true,
  });

  // ── Authorization revocation ─────────────────────────────────────────────
  // session:revoked / crew:access-revoked / crew:member-kicked. State teardown
  // lives in @festie/shared; only the navigation is web-specific.
  const navigate = useNavigate();
  const { toast } = useToast();
  useRevocationRealtime({
    socket,
    onSessionRevoked: () => {
      void navigate({ to: '/login' });
    },
    onCrewNotice: ({ message }) => toast(message, 'info'),
  });

  useRealtimeStoreSync({ socket });

  return {
    connected,
    socket,
  };
}
