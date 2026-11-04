// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * useLiveLocationPublisher — platform-agnostic live-location publisher.
 *
 * Given a connected socket, an active crewId, and an INJECTED geolocation
 * watcher (navigator.geolocation.watchPosition on web; Location.watchPositionAsync
 * on mobile), this hook:
 *   1. emits `location:share` on enable (server sets sharingCrewId),
 *   2. starts the injected watcher,
 *   3. throttles fixes via shouldPublishLocation and emits `location:update`,
 *   4. auto-stops at `expiresAt` (an absolute end time), else after `durationMs`,
 *      else after MAX_SESSION_MS (forgotten sharing can't run forever),
 *   5. emits `location:stop` + stops the watcher on disable / unmount / teardown.
 *
 * The actual GPS source is injected so this stays free of platform deps. All
 * coordinate state flows through the non-persisted liveLocationStore — nothing
 * touches disk.
 */

import { useEffect } from 'react';
import type { Socket } from '../services/socket';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { shouldPublishLocation } from '../utils/liveLocation';
import { LIVE_LOCATION } from '../constants/config';

/** A single GPS fix as the injected watcher reports it. */
export interface GeoFix {
  lat: number;
  lng: number;
  accuracy?: number;
  /** GPS course/heading in degrees clockwise from north (peers render a travel arrow). */
  heading?: number;
  speed?: number;
  /**
   * Phase 4C: device battery % (0–100) at fix time. OPTIONAL — the web adapter
   * may read the (non-standard) Battery API; the mobile adapter leaves this
   * undefined until a native build adds expo-battery (see its TODO). When absent
   * the peer popup simply omits the battery chip.
   */
  battery?: number;
  /**
   * Peer low-power flag (#5): the device is in battery-saver / low-power mode at
   * fix time. OPTIONAL — the mobile adapter reads it from expo-battery; absent on
   * web / when unavailable, in which case the peer popup omits the low-power cue.
   */
  lowPower?: boolean;
  /** ISO timestamp at fix time. Defaults to now if the watcher omits it. */
  capturedAt?: string;
}

/**
 * The injected geolocation source. Called once on start; must invoke `onFix` for
 * every new position and return a teardown function that stops watching.
 */
export type GeoWatcher = (onFix: (fix: GeoFix) => void, onError?: (err: unknown) => void) => () => void;

export interface UseLiveLocationPublisherOptions {
  /** A connected (or connecting) socket. */
  socket: Socket | null;
  /** The crew to share to, or null. */
  crewId: string | null;
  /** Master on/off — OFF by default; the UI flips this on explicit opt-in. */
  enabled: boolean;
  /** Injected platform geolocation watcher (navigator / expo-location). */
  watchPosition: GeoWatcher;
  /**
   * Explicit time-box for this session in ms (the user's chosen duration). When
   * omitted, falls back to MAX_SESSION_MS. Sharing auto-stops after this elapses
   * even if the app stays foregrounded — no silent indefinite sharing.
   */
  durationMs?: number;
  /**
   * Absolute ISO end time. Takes precedence over `durationMs`. A time already in
   * the past calls onAutoStop and emits nothing.
   */
  expiresAt?: string;
  /**
   * Whether to relay battery and low-power state. `false` strips both from every
   * emit (the sharer did not opt in); undefined keeps the fix as the watcher gave it.
   */
  shareBattery?: boolean;
  /** Called when sharing auto-stops (hit the session time-box) so UI can update. */
  onAutoStop?: () => void;
  /** Called if the geolocation source errors (permission revoked, etc.). */
  onError?: (err: unknown) => void;
  /**
   * Called when the server rejects `location:share` (NOT_A_MEMBER,
   * NOT_IN_CREW_ROOM, TOO_MANY_SHARING_SOCKETS, FEATURE_DISABLED, ...). By the
   * time this fires the hook has already rolled back the optimistic sharing
   * state and torn down the GPS watcher; the caller only needs to update its
   * own UI. Deliberately NOT followed by a `location:stop` emit — the server
   * never granted this share, so there is nothing server-side to stop.
   */
  onShareRejected?: (code?: string) => void;
}

export function useLiveLocationPublisher({
  socket,
  crewId,
  enabled,
  watchPosition,
  durationMs,
  expiresAt,
  shareBattery,
  onAutoStop,
  onError,
  onShareRejected,
}: UseLiveLocationPublisherOptions): void {
  useEffect(() => {
    if (!enabled || !socket || !crewId) return;

    const store = useLiveLocationStore;
    let stopped = false;

    // Phase 4C: the share is time-boxed (durationMs, or MAX_SESSION_MS). Compute
    // the absolute expiry ONCE at session start and relay it on every emit so
    // peers can render a "sharing ends in Nm" countdown. A reconnect re-uses the
    // same expiry (the wall-clock deadline doesn't move).
    const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
    const hasAbsoluteEnd = Number.isFinite(expiresMs);
    const cap = hasAbsoluteEnd
      ? expiresMs - Date.now()
      : typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
        ? durationMs
        : LIVE_LOCATION.MAX_SESSION_MS;
    if (cap <= 0) {
      onAutoStop?.();
      return;
    }
    const sessionExpiresAt = hasAbsoluteEnd ? (expiresAt as string) : new Date(Date.now() + cap).toISOString();

    // 1. Declare intent to share. Send the first fix inline once we have it.
    store.getState().startSharing(crewId, sessionExpiresAt);
    // Not connected yet: the server rejects the share until the socket is in the crew room, so
    // skip the first emit and let the connect handler send it from the join ack.
    if (socket.connected) socket.emit('location:share', { _v: 1, crewId, expiresAt: sessionExpiresAt }, handleShareAck);

    // Re-announce on reconnect: the server keeps the share grant on
    // per-connection state (socket.data.sharingCrewId), so a disconnect/
    // reconnect silently kills sharing — every location:update is rejected
    // NOT_SHARING until we re-emit the intent. The server only accepts the share
    // once the socket is in the crew room, and useCrewRealtime's own join:crew
    // races this listener, so join (idempotent) and share from its ack.
    const onReconnect = () => {
      if (stopped) return;
      socket.emit('join:crew', { _v: 1, crewId }, () => {
        if (!stopped) socket.emit('location:share', { _v: 1, crewId, expiresAt: sessionExpiresAt }, handleShareAck);
      });
    };
    socket.on('connect', onReconnect);

    // 2. Start watching. Each fix is throttled before publishing.
    const teardownWatcher = watchPosition(
      (fix) => {
        if (stopped) return;
        const now = Date.now();
        const { lastSentCoord, lastSentAt } = store.getState();
        const next = { lat: fix.lat, lng: fix.lng };
        if (!shouldPublishLocation(lastSentCoord, next, lastSentAt, now)) return;

        socket.emit('location:update', {
          _v: 1,
          crewId,
          lat: fix.lat,
          lng: fix.lng,
          accuracy: fix.accuracy,
          heading: fix.heading,
          speed: fix.speed,
          // Phase 4C: relay battery (when a source supplies it) + the fixed
          // share-window expiry so peers can render direction/battery/countdown.
          // TODO(expo-battery): mobile fix.battery is undefined until a native
          // build adds expo-battery; this passes it through with no native read.
          battery: shareBattery === false ? undefined : fix.battery,
          // Peer low-power flag (#5): relay the sharer's battery-saver state (when
          // a source supplies it) so peers see a low-power cue next to the battery
          // chip. Optional — undefined on web / when unavailable; pure pass-through.
          lowPower: shareBattery === false ? undefined : fix.lowPower,
          expiresAt: sessionExpiresAt,
          capturedAt: fix.capturedAt ?? new Date(now).toISOString(),
        });
        store.getState().recordSent(next, now);
      },
      (err) => {
        onError?.(err);
      },
    );

    // 4. Hard session cap: auto-stop at the chosen time-box (the same `cap`
    //    used above to derive sessionExpiresAt) so the timer and the countdown
    //    peers see always agree.
    const sessionTimer = setTimeout(() => {
      stop();
      onAutoStop?.();
    }, cap);

    // Local (non-network) teardown shared by stop() and a rejected-share ack:
    // stops the timer/listener/watcher and rolls back the optimistic store
    // write. Split out so a rejection (never granted server-side) can clean
    // up WITHOUT stop()'s location:stop emit below — the server never granted
    // the share, so there is nothing server-side to stop. (The handler is now
    // gated on admission to the named crew, so an emit here would simply be
    // refused; skipping it keeps the pointless round-trip off the path.)
    function teardownLocal() {
      if (stopped) return;
      stopped = true;
      clearTimeout(sessionTimer);
      socket!.off('connect', onReconnect);
      try {
        teardownWatcher();
      } catch {
        /* watcher already torn down */
      }
      store.getState().stopSharing();
    }

    // Ack handler for `location:share` (both the initial emit above and the
    // reconnect re-announce): the server can reject after we've already
    // optimistically started sharing. Roll the optimistic state back and let
    // the caller know — otherwise every location:update keeps coming back
    // NOT_SHARING while the UI still claims we're sharing. Guarded on
    // `!stopped` so a late/stale ack arriving after a normal stop (unmount,
    // auto-stop, manual toggle-off) is a no-op.
    function handleShareAck(response: { ok: boolean; code?: string }) {
      if (response.ok || stopped) return;
      teardownLocal();
      onShareRejected?.(response.code);
    }

    function stop() {
      if (stopped) return;
      // 5. Tell the server + peers we stopped, then run the same local
      // teardown a rejected share uses.
      if (socket && socket.connected) socket.emit('location:stop', { _v: 1, crewId: crewId as string });
      teardownLocal();
    }

    return stop;
    // crewId / enabled / socket / durationMs / expiresAt / shareBattery identity changes re-run the effect
    // (cleanup stops the old session). watchPosition is assumed stable by the
    // caller. onAutoStop / onError are read lazily so they need not be stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, crewId, enabled, durationMs, expiresAt, shareBattery]);
}
