import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { useRouter } from 'expo-router';
import { createSocket, createAuthErrorHandler } from '@festie/shared/services';
import { API_ORIGIN } from '../lib/apiOrigin';
// Import the Socket type from the shared barrel (which re-exports it) rather
// than from 'socket.io-client' directly: socket.io-client is a dependency of
// @festie/shared, not of packages/mobile, so a direct import resolves locally
// (hoisted) but fails the CI mobile typecheck (TS2307) where mobile deps aren't
// installed.
import type { Socket } from '@festie/shared/services';
import {
  useAuthStore,
  useUIStore,
  useFestivalDataStore,
  useCrewStore,
  useLiveLocationStore,
} from '@festie/shared/stores';
import { useCrewRealtime, useRealtimeStoreSync, useRevocationRealtime } from '@festie/shared/hooks';
// createStoreSink lives in @festie/shared's realtime module, re-exported by the
// package root barrel (src/index.ts). There is no dedicated `./realtime` subpath
// export, so it is imported from the bare '@festie/shared' entry, which the
// package `exports` map resolves. It is the package itself (not a transitive
// dep), so it is safe for the mobile typecheck and the Metro bundle.
import { createStoreSink } from '@festie/shared';
import { setLiveSocket, useLiveSocket } from '../lib/liveSocket';

export interface UseRealtimeSyncReturn {
  connected: boolean;
}

/**
 * Mobile real-time sync hook. Mirrors the web `useRealtimeSync` behavior but
 * adds React Native AppState lifecycle management:
 * - Connects when a festival is selected and user is authenticated
 * - Disconnects when the app moves to background
 * - Reconnects when the app returns to foreground
 * - Disconnects on logout (userToken becomes null)
 *
 * Socket events flow into the shared Zustand stores (festivalDataStore,
 * crewStore, uiStore) so the rest of the app reacts automatically.
 * festival:updated reloads only when its id is the current festival. Presence
 * fills uiStore but is not returned, so the tab layout does not re-render on it.
 */
export function useRealtimeSync(): UseRealtimeSyncReturn {
  const socketRef = useRef<Socket | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState as AppStateStatus);

  const userToken = useAuthStore((s) => s.userToken);
  const currentFestivalId = useFestivalDataStore((s) => s.currentFestivalId);
  // Active crew drives which crew:* room we join; re-run the effect on change
  // so we leave the old room and join the new one (crew sub-feature events are
  // scoped to the `crew:${crewId}` room server-side).
  const activeCrewId = useCrewStore((s) => s.activeCrew?.id ?? null);
  const connected = useUIStore((s) => s.connected);
  const setConnected = useUIStore((s) => s.setConnected);

  // ── Crew sub-feature + Live Location/SOS realtime ────────────────────────
  // Delegate crew:* / location:* / sos:* socket routing to the shared hook (the
  // same one web consumes) instead of hand-rolling ~160 lines here. It reads the
  // socket this hook owns — published via setLiveSocket, read back via
  // useLiveSocket — registers its own crew:*/location:*/sos:* listeners, runs
  // each payload through the pure router + crew guards, and (joinRoom) owns the
  // join/leave:crew emits. Mobile keeps only what the shared hook does NOT own:
  // socket construction/teardown, AppState lifecycle, join/leave:festival,
  // presence, picks/profiles/festival reloads, and the liveLocationStore crew
  // scoping in the effect below (setActiveCrew) — the sole reset of peer/SOS
  // state on a crew switch, which neither the shared hook nor the sink performs.
  const liveSocket = useLiveSocket();
  const getActiveCrewId = useCallback(() => useCrewStore.getState().activeCrew?.id ?? null, []);
  const crewSink = useMemo(() => createStoreSink(useCrewStore, useLiveLocationStore), []);
  useCrewRealtime({ socket: liveSocket, getActiveCrewId, sink: crewSink, joinRoom: true });

  // ── Authorization revocation ────────────────────────────────────────────
  // session:revoked / crew:access-revoked / crew:member-kicked. State teardown
  // lives in @festie/shared; only the route-out is mobile-specific (mirrors the
  // account screen's sign-out, which also router.replace's to the auth stack).
  const router = useRouter();
  useRevocationRealtime({
    socket: liveSocket,
    onSessionRevoked: () => router.replace('/(auth)/login'),
    onCrewNotice: ({ title, message }) => Alert.alert(title, message),
  });

  // Festival/profile/crew/presence events and the reconnect re-read live in the shared hook;
  // it also owns join:festival here (mobile has no useSocket) and exposes the foreground backfill.
  const { backfill } = useRealtimeStoreSync({ socket: liveSocket, joinFestival: true });

  // ── Socket connection lifecycle ─────────────────────────────────────────
  useEffect(() => {
    // Keep the ephemeral live-location store scoped to the active crew so peer/
    // SOS guards (and the publisher) target the right crew. A crew change resets
    // peers + SOS + any in-flight sharing (no silent cross-crew bleed).
    useLiveLocationStore.getState().setActiveCrew(useCrewStore.getState().activeCrew?.id ?? null);

    // Don't connect without auth or a selected festival.
    if (!userToken || !currentFestivalId) {
      // Tear down any existing socket from a previous render.
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      setLiveSocket(null);
      return;
    }

    const socket = createSocket(userToken, API_ORIGIN, createAuthErrorHandler(() => socketRef.current, useAuthStore.getState));
    socketRef.current = socket;
    // Expose this socket to the Live Location publisher (crew screen) which emits
    // location:* on it. Cleared on teardown so a torn-down socket isn't reused.
    setLiveSocket(socket);

    // ── AppState lifecycle (background / foreground) ───────────────────
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextAppState;

      if (nextAppState === 'active' && prev.match(/inactive|background/)) {
        // Returning to foreground — reconnect if disconnected.
        if (!socket.active) {
          socket.connect();
        }
        // FOREGROUND BACKFILL: the socket was disconnected while backgrounded, so
        // any festival/pick/crew events emitted meanwhile were missed.
        backfill();
      } else if (nextAppState.match(/inactive|background/) && prev === 'active') {
        // Going to background — disconnect to save battery / bandwidth. A socket
        // mid-reconnect is not `connected` but is still `active`: stop it too, or
        // socket.io keeps retrying in the background.
        // Foreground-only live location: stop sharing the moment we background.
        // The server also force-stops on the disconnect below; this explicit
        // stop is immediate + clears local sharing state so there's no ghost
        // marker and no silent re-share when we return (user must re-opt-in).
        // Local state clears even while reconnecting (socket not connected).
        const sharingCrewId = useLiveLocationStore.getState().sharingCrewId;
        if (sharingCrewId) {
          if (socket.connected) socket.emit('location:stop', { _v: 1, crewId: sharingCrewId });
          useLiveLocationStore.getState().stopSharing();
        }
        if (socket.connected) {
          const festivalId = useFestivalDataStore.getState().currentFestivalId;
          if (festivalId) {
            socket.emit('leave:festival');
          }
          const crewId = useCrewStore.getState().activeCrew?.id;
          if (crewId) {
            socket.emit('leave:crew', { _v: 1, crewId });
          }
        }
        socket.disconnect();
      }
    };

    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    // ── Cleanup ────────────────────────────────────────────────────────
    return () => {
      appStateSub.remove();

      // Stop any in-flight live-location sharing before tearing down the socket
      // (no ghost markers; server also auto-stops on disconnect).
      const sharingCrewId = useLiveLocationStore.getState().sharingCrewId;
      if (socket.connected && sharingCrewId) {
        socket.emit('location:stop', { _v: 1, crewId: sharingCrewId });
      }
      useLiveLocationStore.getState().stopSharing();

      // leave:crew on teardown is owned by useCrewRealtime (joinRoom: true).
      socket.disconnect();
      socketRef.current = null;
      setLiveSocket(null);
    };
  }, [userToken, currentFestivalId, activeCrewId, setConnected, backfill]);

  return { connected };
}
