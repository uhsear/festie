// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * useCrewRealtime — platform-agnostic wiring for crew sub-feature realtime.
 *
 * Registers all `crew:*` sub-feature socket listeners, runs each payload through
 * the pure router (crewEventRouter), and dispatches the resulting intent to an
 * injected `CrewRealtimeSink`. It owns the 300ms trailing debouncer (keyed) for
 * the reload-style intents and, when `joinRoom` is set, emits `join:crew` /
 * `leave:crew` keyed on the active crew id (mirrors mobile's room lifecycle).
 *
 * It does NOT own the socket connection — the caller supplies a connected (or
 * connecting) socket. Mobile keeps connecting via useRealtimeSync; web supplies
 * its own socket. This separation lets web use a TanStack-Query-backed sink and
 * mobile use the crewStore sink without duplicating the routing/guard logic.
 */

import { useEffect } from 'react';
import type { Socket } from '../services/socket';
import { useLiveLocationStore } from '../stores/liveLocationStore';
import { useAuthStore } from '../stores/authStore';
import {
  routeHomeBaseUpdated,
  routeMeetingPointUpsert,
  routeMeetingPointRemoved,
  routePollCreated,
  routePollVoted,
  routePollClosed,
  routeExpensesChanged,
  routePackingChanged,
  routeRidesChanged,
  routeActivityLogged,
  routeLocationPeerUpdate,
  routeLocationPeerStopped,
  routeSosRaised,
  routeSosCleared,
} from '../realtime/crewEventRouter';
import type { CrewRealtimeSink } from '../realtime/crewRealtimeSink';
import type {
  CrewHomeBaseUpdatedPayload,
  CrewMeetingPointPayload,
  CrewMeetingPointRemovedPayload,
  CrewPollCreatedPayload,
  CrewPollVotedPayload,
  CrewPollClosedPayload,
  CrewExpensePayload,
  CrewExpenseDeletedPayload,
  CrewExpenseUpdatedPayload,
  CrewPackingChangedPayload,
  CrewRidesChangedPayload,
  CrewActivityPayload,
  LocationPeerUpdatePayload,
  LocationPeerStoppedPayload,
  SosRaisedPayload,
  SosClearedPayload,
  SosSeenPayload,
} from '../types/socket-events';

export interface UseCrewRealtimeOptions {
  /** A socket from the caller. The hook registers/cleans up listeners on it. */
  socket: Socket | null;
  /**
   * Resolves the currently-active crew id (or null). Read live on every event
   * so guards reflect the latest crew even between renders. Should be stable.
   */
  getActiveCrewId: () => string | null;
  /** Where routed intents land (crewStore adapter, Query invalidation, etc.). */
  sink: CrewRealtimeSink;
  /**
   * When true (default), emit join:crew on connect / active-crew change and
   * leave:crew on cleanup / change. Set false if the caller manages rooms.
   */
  joinRoom?: boolean;
}

const DEBOUNCE_MS = 300;

export function useCrewRealtime({ socket, getActiveCrewId, sink, joinRoom = true }: UseCrewRealtimeOptions): void {
  // Re-run when the socket identity or the active crew id changes so we leave
  // the old crew room and join the new one. getActiveCrewId is read both for
  // the dependency snapshot and live inside handlers.
  const activeCrewId = getActiveCrewId();

  useEffect(() => {
    if (!socket) return;

    // ── Keyed trailing debouncer (300ms) ───────────────────────────────────
    const timers: Record<string, ReturnType<typeof setTimeout>> = {};
    const schedule = (key: string, fn: () => void) => {
      if (timers[key]) clearTimeout(timers[key]);
      timers[key] = setTimeout(() => {
        delete timers[key];
        fn();
      }, DEBOUNCE_MS);
    };

    // ── Handlers: route -> (debounce for reloads) -> sink ───────────────────
    const handleHomeBaseUpdated = (data: CrewHomeBaseUpdatedPayload) => {
      const intent = routeHomeBaseUpdated(data, getActiveCrewId());
      if (intent) {
        sink.onHomeBaseUpdated(intent.crewId, {
          location: intent.location,
          time: intent.time,
        });
      }
    };

    const handleMeetingPointUpsert = (data: CrewMeetingPointPayload) => {
      const intent = routeMeetingPointUpsert(data, getActiveCrewId());
      if (intent) sink.onMeetingPointUpsert(intent.crewId, intent.meetingPoint);
    };

    const handleMeetingPointRemoved = (data: CrewMeetingPointRemovedPayload) => {
      const intent = routeMeetingPointRemoved(data, getActiveCrewId());
      if (intent) sink.onMeetingPointRemoved(intent.crewId, intent.mpId);
    };

    const handlePollCreated = (data: CrewPollCreatedPayload) => {
      const intent = routePollCreated(data, getActiveCrewId());
      if (!intent) return;
      // Reload-style: the payload lacks the full poll shape. Debounce so a burst
      // coalesces, keyed by crew so distinct crews don't clobber each other.
      schedule(`crew-polls:${intent.crewId}`, () => {
        sink.onPollCreated(intent.crewId, {
          pollId: intent.pollId,
          question: intent.question,
          options: intent.options,
          createdBy: intent.createdBy,
        });
      });
    };

    const handlePollVoted = (data: CrewPollVotedPayload) => {
      const intent = routePollVoted(data, getActiveCrewId());
      if (intent) {
        sink.onPollVoted(intent.crewId, intent.pollId, intent.userId, intent.optionIndexes);
      }
    };

    const handlePollClosed = (data: CrewPollClosedPayload) => {
      const intent = routePollClosed(data, getActiveCrewId());
      if (intent) sink.onPollClosed(intent.crewId, intent.pollId);
    };

    const handleExpensesChanged = (data: CrewExpensePayload | CrewExpenseDeletedPayload | CrewExpenseUpdatedPayload) => {
      const intent = routeExpensesChanged(data, getActiveCrewId());
      if (!intent) return;
      schedule(`crew-expenses:${intent.crewId}`, () => {
        sink.onExpensesChanged(intent.crewId);
      });
    };

    const handlePackingChanged = (data: CrewPackingChangedPayload) => {
      const intent = routePackingChanged(data, getActiveCrewId());
      if (!intent) return;
      schedule(`crew-packing:${intent.crewId}`, () => {
        sink.onPackingChanged(intent.crewId);
      });
    };

    const handleRidesChanged = (data: CrewRidesChangedPayload) => {
      const intent = routeRidesChanged(data, getActiveCrewId());
      if (!intent) return;
      schedule(`crew-rides:${intent.crewId}`, () => {
        sink.onRidesChanged(intent.crewId);
      });
    };

    const handleActivityLogged = (data: CrewActivityPayload) => {
      const intent = routeActivityLogged(data, getActiveCrewId());
      if (!intent) return;
      schedule(`crew-activity:${intent.crewId}`, () => {
        sink.onActivityLogged(intent.crewId);
      });
    };

    // ── Live Location + SOS handlers (applied IMMEDIATELY — full payloads, no
    // debounce; the 300ms debounce is only for reload-style intents above). ───
    const handleLocationPeerUpdate = (data: LocationPeerUpdatePayload) => {
      const intent = routeLocationPeerUpdate(data, getActiveCrewId(), useAuthStore.getState().user?.id ?? null);
      if (intent) sink.onLocationPeerUpdate(intent.crewId, intent.peer);
    };

    const handleLocationPeerStopped = (data: LocationPeerStoppedPayload) => {
      const intent = routeLocationPeerStopped(data, getActiveCrewId());
      if (intent) sink.onLocationPeerStopped(intent.crewId, intent.userId, intent.reason);
    };

    const handleSosRaised = (data: SosRaisedPayload) => {
      const intent = routeSosRaised(data, getActiveCrewId());
      if (intent) sink.onSosRaised(intent.crewId, intent.sos);
    };

    const handleSosCleared = (data: SosClearedPayload) => {
      const intent = routeSosCleared(data, getActiveCrewId());
      if (intent) sink.onSosCleared(intent.crewId, intent.userId, intent.clearedBy);
    };

    // Written straight to the store: no app sink needs to change for seen-by.
    const handleSosSeen = (data: SosSeenPayload) => {
      if (data.crewId !== getActiveCrewId()) return;
      useLiveLocationStore.getState().applySosSeen(data.raiserId, data.seenBy);
    };

    // ── Register listeners ──────────────────────────────────────────────────
    socket.on('crew:home-base-updated', handleHomeBaseUpdated);
    socket.on('crew:meeting-point-created', handleMeetingPointUpsert);
    socket.on('crew:meeting-point-updated', handleMeetingPointUpsert);
    socket.on('crew:meeting-point-removed', handleMeetingPointRemoved);
    socket.on('crew:poll-created', handlePollCreated);
    socket.on('crew:poll-voted', handlePollVoted);
    socket.on('crew:poll-closed', handlePollClosed);
    socket.on('crew:expense-added', handleExpensesChanged);
    socket.on('crew:expense-deleted', handleExpensesChanged);
    socket.on('crew:expense-updated', handleExpensesChanged);
    socket.on('crew:packing-created', handlePackingChanged);
    socket.on('crew:packing-updated', handlePackingChanged);
    socket.on('crew:packing-deleted', handlePackingChanged);
    socket.on('crew:ride-created', handleRidesChanged);
    socket.on('crew:ride-updated', handleRidesChanged);
    socket.on('crew:ride-deleted', handleRidesChanged);
    socket.on('crew:activity', handleActivityLogged);
    socket.on('location:peer-update', handleLocationPeerUpdate);
    socket.on('location:peer-stopped', handleLocationPeerStopped);
    socket.on('sos:raised', handleSosRaised);
    socket.on('sos:cleared', handleSosCleared);
    socket.on('sos:seen', handleSosSeen);

    // ── Crew room lifecycle ─────────────────────────────────────────────────
    // Join on connect AND immediately (the socket may already be connected when
    // this effect runs, in which case 'connect' won't fire again).
    const joinId = getActiveCrewId();
    const handleConnect = () => {
      if (!joinRoom) return;
      const id = getActiveCrewId();
      if (id) {
        socket.emit('join:crew', { _v: 1, crewId: id }, () => {});
        sink.onSosResync?.(id);
      }
    };
    socket.on('connect', handleConnect);
    if (joinRoom && joinId && socket.connected) {
      socket.emit('join:crew', { _v: 1, crewId: joinId }, () => {});
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    return () => {
      socket.off('crew:home-base-updated', handleHomeBaseUpdated);
      socket.off('crew:meeting-point-created', handleMeetingPointUpsert);
      socket.off('crew:meeting-point-updated', handleMeetingPointUpsert);
      socket.off('crew:meeting-point-removed', handleMeetingPointRemoved);
      socket.off('crew:poll-created', handlePollCreated);
      socket.off('crew:poll-voted', handlePollVoted);
      socket.off('crew:poll-closed', handlePollClosed);
      socket.off('crew:expense-added', handleExpensesChanged);
      socket.off('crew:expense-deleted', handleExpensesChanged);
      socket.off('crew:expense-updated', handleExpensesChanged);
      socket.off('crew:packing-created', handlePackingChanged);
      socket.off('crew:packing-updated', handlePackingChanged);
      socket.off('crew:packing-deleted', handlePackingChanged);
      socket.off('crew:ride-created', handleRidesChanged);
      socket.off('crew:ride-updated', handleRidesChanged);
      socket.off('crew:ride-deleted', handleRidesChanged);
      socket.off('crew:activity', handleActivityLogged);
      socket.off('location:peer-update', handleLocationPeerUpdate);
      socket.off('location:peer-stopped', handleLocationPeerStopped);
      socket.off('sos:raised', handleSosRaised);
      socket.off('sos:cleared', handleSosCleared);
      socket.off('sos:seen', handleSosSeen);
      socket.off('connect', handleConnect);

      // Cancel pending debounced reloads.
      for (const k of Object.keys(timers)) {
        clearTimeout(timers[k]);
        delete timers[k];
      }

      // Leave the room we joined (no-op if not connected/joined).
      if (joinRoom && joinId && socket.connected) {
        socket.emit('leave:crew', { _v: 1, crewId: joinId });
      }
    };
    // activeCrewId is intentionally a dependency: it changes -> we leave the old
    // crew room (cleanup) and join the new one (effect body). getActiveCrewId /
    // sink are assumed stable by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, activeCrewId, joinRoom]);
}
